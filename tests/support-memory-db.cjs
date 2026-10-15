// Deliberately models the SDK's transaction snapshot and live (non-transactional)
// query.count(). This is a local business-invariant test double, not a cloud DB.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const clone = value => structuredClone(value);
const error = (message, code) => Object.assign(new Error(message), { code });

function memoryDatabase({ uniqueMembers = ['openid', 'accountName'] } = {}) {
  let store = new Map();
  let sequence = 0;
  const versions = new Map();
  const faults = [];
  const stats = { conflicts: 0, commits: 0, rollbacks: 0, transactionalCounts: 0 };
  const key = (collection, id) => JSON.stringify([collection, id]);
  const ensure = (s, name) => { if (!s.has(name)) s.set(name, new Map()); return s.get(name); };
  const command = {};
  for (const op of ['gte', 'gt', 'lte', 'lt', 'eq', 'neq', 'in', 'nin']) {
    command[op] = value => ({ __op: op, value });
  }
  command.or = conditions => ({ __op: 'or', value: conditions });
  command.and = conditions => ({ __op: 'and', value: conditions });
  command.inc = value => ({ __op: 'inc', value });
  const matches = (row, query) => {
    if (query.__op === 'or') return query.value.some(q => matches(row, q));
    if (query.__op === 'and') return query.value.every(q => matches(row, q));
    return Object.entries(query).every(([field, wanted]) => {
      const got = row[field];
      if (wanted instanceof RegExp) return wanted.test(got);
      if (!wanted || !wanted.__op) return got === wanted || (got instanceof Date && wanted instanceof Date && +got === +wanted);
      switch (wanted.__op) {
        case 'gte': return got >= wanted.value;
        case 'gt': return got > wanted.value;
        case 'lte': return got <= wanted.value;
        case 'lt': return got < wanted.value;
        case 'eq': return got === wanted.value;
        case 'neq': return got !== wanted.value;
        case 'in': return wanted.value.includes(got);
        case 'nin': return !wanted.value.includes(got);
        default: throw Error(`Unsupported command ${wanted.__op}`);
      }
    });
  };
  function validateUnique(candidate) {
    const members = [...ensure(candidate, 'members').values()];
    for (const field of uniqueMembers) {
      const seen = new Set();
      for (const member of members) {
        if (member[field] === undefined) continue;
        if (seen.has(member[field])) throw error(`duplicate key members.${field}`, 'DATABASE_DUPLICATE_KEY');
        seen.add(member[field]);
      }
    }
  }
  async function fault(collection, operation, id, transaction) {
    const found = faults.find(f => f.collection === collection && f.operation === operation && (f.id === undefined || f.id === id));
    if (!found) return;
    if (found.times !== Infinity && --found.times === 0) faults.splice(faults.indexOf(found), 1);
    if (found.effect) await found.effect({ collection, operation, id, transaction });
    if (found.error) throw found.error;
  }
  function reference(name, transaction, filter = {}, options = {}) {
    const current = () => transaction ? transaction.snapshot : store;
    const read = id => {
      if (transaction) transaction.reads.add(key(name, id));
      return ensure(current(), name).get(id);
    };
    const write = (id, row) => {
      if (transaction) {
        transaction.reads.add(key(name, id));
        transaction.writes.set(key(name, id), row === undefined ? undefined : clone(row));
        if (row === undefined) ensure(transaction.snapshot, name).delete(id);
        else ensure(transaction.snapshot, name).set(id, clone(row));
      } else {
        const candidate = clone(store);
        if (row === undefined) ensure(candidate, name).delete(id);
        else ensure(candidate, name).set(id, clone(row));
        validateUnique(candidate);
        store = candidate;
        versions.set(key(name, id), (versions.get(key(name, id)) || 0) + 1);
      }
    };
    function rows(source, paginate) {
      let values = [...ensure(source, name).values()].filter(r => matches(r, filter));
      if (options.order) values.sort((a, b) => {
        for (const [field, direction] of options.order) {
          const compare = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
          if (compare) return direction === 'desc' ? -compare : compare;
        }
        return 0;
      });
      return paginate ? values.slice(options.skip || 0, (options.skip || 0) + (options.limit === undefined ? 100 : options.limit)) : values;
    }
    return {
      where: query => reference(name, transaction, query, options),
      orderBy: (field, direction) => reference(name, transaction, filter, { ...options, order: [...(options.order || []), [field, direction]] }),
      skip: skip => reference(name, transaction, filter, { ...options, skip }),
      limit: limit => reference(name, transaction, filter, { ...options, limit }),
      async count() {
        await fault(name, 'count', undefined, transaction);
        if (transaction) stats.transactionalCounts++;
        // Installed SDK Query.count() omits transactionId and ignores limit/skip.
        return { total: rows(store, false).length };
      },
      async get() {
        await fault(name, 'query', undefined, transaction);
        const values = rows(current(), true);
        if (transaction) values.forEach(row => transaction.reads.add(key(name, row._id)));
        return { data: clone(values) };
      },
      async add({ data }) {
        const id = data._id || `auto_${++sequence}`;
        await fault(name, 'add', id, transaction);
        if (read(id)) throw error('duplicate key _id', 'DATABASE_DUPLICATE_KEY');
        write(id, { ...data, _id: id });
        return { _id: id };
      },
      async remove() {
        const values = rows(current(), false);
        for (const row of values) write(row._id, undefined);
        return { stats: { removed: values.length } };
      },
      doc(id) {
        return {
          async get() {
            await fault(name, 'get', id, transaction);
            const row = read(id);
            if (!row) throw error(`document with _id ${id} does not exist`, 'DOCUMENT_NOT_FOUND');
            return { data: clone(row) };
          },
          async update({ data }) {
            await fault(name, 'update', id, transaction);
            const row = read(id);
            if (!row) throw error(`document with _id ${id} does not exist`, 'DOCUMENT_NOT_FOUND');
            const patch = {};
            for (const [field, value] of Object.entries(data)) patch[field] = value && value.__op === 'inc' ? (row[field] || 0) + value.value : value;
            write(id, { ...row, ...patch });
            return { stats: { updated: 1 } };
          },
          async set({ data }) {
            await fault(name, 'set', id, transaction);
            write(id, { ...data, _id: id });
            return { _id: id };
          },
          async remove() {
            await fault(name, 'remove', id, transaction);
            write(id, undefined);
            return { stats: { removed: 1 } };
          },
        };
      },
    };
  }
  const db = {
    command,
    collection: name => reference(name),
    async createCollection(name) { ensure(store, name); },
    async startTransaction() {
      const transaction = { snapshot: clone(store), versions: new Map(versions), reads: new Set(), writes: new Map(), finished: false };
      transaction.collection = name => reference(name, transaction);
      transaction.rollback = async () => { if (!transaction.finished) stats.rollbacks++; transaction.finished = true; };
      transaction.commit = async () => {
        for (const k of transaction.reads) {
          if ((versions.get(k) || 0) !== (transaction.versions.get(k) || 0)) {
            stats.conflicts++;
            throw error('database transaction conflict', 'DATABASE_TRANSACTION_CONFLICT');
          }
        }
        const candidate = clone(store);
        for (const [k, row] of transaction.writes) {
          const [name, id] = JSON.parse(k);
          if (row === undefined) ensure(candidate, name).delete(id);
          else ensure(candidate, name).set(id, clone(row));
        }
        validateUnique(candidate);
        store = candidate;
        for (const k of transaction.writes.keys()) versions.set(k, (versions.get(k) || 0) + 1);
        transaction.finished = true;
        stats.commits++;
      };
      return transaction;
    },
    async runTransaction(callback, retries = 3) {
      for (let attempt = 0; ; attempt++) {
        const transaction = await db.startTransaction();
        try {
          const result = await callback(transaction);
          await transaction.commit();
          return result;
        } catch (e) {
          await transaction.rollback();
          if (e.code === 'DATABASE_TRANSACTION_CONFLICT' && attempt < retries) continue;
          throw e;
        }
      }
    },
  };
  return {
    db, stats,
    seed(name, rows) { ensure(store, name); for (const row of rows) { ensure(store, name).set(row._id, clone(row)); versions.set(key(name, row._id), (versions.get(key(name, row._id)) || 0) + 1); } },
    rows(name) { return clone([...ensure(store, name).values()]); },
    inject(spec) { faults.push({ times: 1, ...spec }); },
  };
}

function loadBackend(options = {}) {
  const memory = memoryDatabase(options);
  const filename = path.resolve(__dirname, '../cloudfunctions/api/index.js');
  const localRequire = createRequire(filename);
  let openid = 'admin';
  const cloud = { init() {}, database: () => memory.db, getWXContext: () => ({ OPENID: openid }) };
  const NativeDate = Date;
  const fixed = options.at === undefined ? '2026-10-15T08:00:00.000Z' : options.at;
  class TestDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return new NativeDate(fixed).getTime(); }
  }
  const sandbox = { exports: {}, require: name => name === 'wx-server-sdk' ? cloud : localRequire(name), console, Date: TestDate, Set };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nexports.__test = { DEFAULT_CONFIG, periodStart, loadConfig };', sandbox, { filename });
  const config = clone(sandbox.exports.__test.DEFAULT_CONFIG);
  memory.seed('configs', [{ ...config, _id: 'default', admins: ['admin'], superAdmins: ['super'] }]);
  memory.seed('members', [
    { _id: 'm', openid: 'member', accountName: 'member1', accountNameChanged: false, nickname: 'M', points: 10, growth: 10, honor: 0, level: 'bronze', levelName: '青铜' },
    { _id: 'm2', openid: 'member2', accountName: 'member2', accountNameChanged: false, nickname: 'M2', points: 10, growth: 10, honor: 0 },
    { _id: 'a', openid: 'admin', accountName: 'admin1', nickname: 'A', points: 0, growth: 0, honor: 0 },
  ]);
  return {
    ...memory, internals: sandbox.exports.__test,
    async call(action, payload = {}, actor = 'admin') { openid = actor; return sandbox.exports.main({ ...payload, action }); },
    config(patch) { const current = memory.rows('configs')[0]; memory.seed('configs', [{ ...current, ...clone(patch) }]); },
  };
}
module.exports = { memoryDatabase, loadBackend };
