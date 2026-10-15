// No network: exercise the installed SDK through its real request class and wx
// error wrappers. Only the final HTTP caller is replaced with an offline service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = path.resolve(__dirname, '../cloudfunctions/api/index.js');
const localRequire = createRequire(filename);
const cloud = localRequire('wx-server-sdk');
const caller = localRequire('@cloudbase/node-sdk/dist/utils/tcbapirequester');
const { EJSON } = localRequire('bson');
cloud.init({ env: 'sdk-transaction-offline-regression' });
const db = cloud.database();

function helpers() {
  const context = {
    exports: {}, require: name => name === 'wx-server-sdk' ? { init() {}, database: () => db } : localRequire(name),
    console, Date, Set,
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nexports.__sdk = { runTransaction, touchGuard, consumptionUsage, businessError, isTransactionConflict };', context, { filename });
  return context.exports.__sdk;
}

async function offline(options, callback) {
  const previous = caller.request;
  const state = { starts: 0, aborts: 0, commits: 0, callbacks: 0, injected: 0, calls: [], stored: new Map(), transactions: new Map(), used: options.used || 0 };
  const phaseMatches = params => {
    if (options.phase === 'get') return params.action === 'database.getDocument';
    if (options.phase === 'set') return params.action === 'database.modifyDocument' && params.merge === false;
    if (options.phase === 'update') return params.action === 'database.modifyDocument' && params.merge === true;
    return options.phase === 'commit' && params.action === 'database.commitTransaction';
  };
  caller.request = async ({ params }) => {
    const { action, transactionId, collectionName } = params;
    state.calls.push({ action, transactionId, collectionName });
    if (action === 'database.startTransaction') {
      const id = `offline-${++state.starts}`;
      state.transactions.set(id, new Map());
      return { transactionId: id };
    }
    if (action === 'database.abortTransaction') {
      state.aborts++;
      state.transactions.delete(transactionId);
      return {};
    }
    if (phaseMatches(params) && state.injected < (options.failures === undefined ? 1 : options.failures)) {
      state.injected++;
      if (options.onConflict) options.onConflict(state);
      const failure = options.failure || { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'database transaction conflict' };
      if (options.mode === 'throw') throw failure;
      return failure;
    }
    if (action === 'database.commitTransaction') {
      state.commits++;
      for (const [key, value] of state.transactions.get(transactionId)) state.stored.set(key, value);
      state.transactions.delete(transactionId);
      return {};
    }
    if (action === 'database.calculateDocument') {
      assert.equal(transactionId, undefined, 'installed count must omit transactionId');
      return { data: { total: state.used } };
    }
    assert(state.transactions.has(transactionId), `unexpected nontransactional request ${action}`);
    if (action === 'database.getDocument') {
      const id = EJSON.parse(params.query)._id;
      const stored = state.stored.get(`${collectionName}/${id}`) || { _id: id, revision: 0, used: 0 };
      return { data: { list: [EJSON.stringify(stored)] } };
    }
    if (action === 'database.modifyDocument') {
      const id = EJSON.parse(params.query)._id;
      const parsed = EJSON.parse(params.data);
      const patch = parsed.$set || parsed;
      const key = `${collectionName}/${id}`;
      state.transactions.get(transactionId).set(key, { ...(state.stored.get(key) || {}), ...patch, _id: id });
      return { data: { updated: 1 } };
    }
    if (action === 'database.insertDocument') {
      const row = EJSON.parse(params.data[0]);
      const id = row._id || `insert-${state.calls.length}`;
      state.transactions.get(transactionId).set(`${collectionName}/${id}`, { ...row, _id: id });
      return { data: { insertedIds: [id] } };
    }
    throw Error(`Unexpected offline SDK request: ${action}`);
  };
  try { return await callback(helpers(), state); }
  finally { caller.request = previous; }
}

for (const mode of ['return', 'throw']) {
  for (const phase of ['get', 'set', 'update', 'commit']) {
    test(`SDK ${phase} conflict (${mode} transport): retry entire transaction and commit effects once`, async () => {
      await offline({ phase, mode }, async (api, state) => {
        const result = await api.runTransaction(async t => {
          state.callbacks++;
          const guard = await api.touchGuard(t, 'consumption', 'm');
          if (phase === 'update') await guard.update({ data: { used: 1 } });
          await t.collection('audit_logs').add({ data: { actionType: 'regression-write' } });
          return { response: 'success' };
        });
        assert.equal(result.response, 'success');
        assert.equal(state.injected, 1);
        assert.equal(state.starts, 2);
        assert.equal(state.callbacks, 2);
        assert.equal(state.commits, 1);
        assert.equal(state.aborts, 1);
        assert.equal([...state.stored.keys()].filter(key => key.startsWith('audit_logs/')).length, 1);
        assert.equal(state.transactions.size, 0);
      });
    });
  }
}

for (const phase of ['set', 'commit']) {
test(`SDK repeated ${phase} conflict: four total attempts, four rollbacks, no stacked inner retries or effects`, async () => {
  await offline({ phase, failures: Infinity }, async (api, state) => {
    await assert.rejects(api.runTransaction(async t => {
      state.callbacks++;
      await t.collection('audit_logs').add({ data: { actionType: 'never-committed' } });
      await api.touchGuard(t, 'consumption', 'm');
    }), error => api.isTransactionConflict(error));
    assert.equal(state.starts, 4);
    assert.equal(state.callbacks, 4);
    assert.equal(state.aborts, 4);
    assert.equal(state.commits, 0);
    assert.equal(state.stored.size, 0);
  });
});
}

test('SDK wrapped transaction-conflict text without database prefix still retries', async () => {
  await offline({ phase: 'set', failure: { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'transaction conflict' } }, async (api, state) => {
    await api.runTransaction(async t => { state.callbacks++; await api.touchGuard(t, 'consumption', 'm'); });
    assert.equal(state.starts, 2);
    assert.equal(state.callbacks, 2);
    assert.equal(state.aborts, 1);
    assert.equal(state.commits, 1);
  });
});

for (const failure of [
  { code: 'DATABASE_REQUEST_FAILED', message: 'permission denied' },
  { code: 'DATABASE_PERMISSION_DENIED', message: 'permission denied' },
  { code: 'DATABASE_REQUEST_FAILED', message: 'transaction temporarily unavailable' },
]) {
  test(`SDK document non-conflict ${failure.code}/${failure.message}: propagate after one rollback`, async () => {
    await offline({ phase: 'set', failures: Infinity, failure }, async (api, state) => {
      await assert.rejects(api.runTransaction(async t => {
        state.callbacks++;
        await api.touchGuard(t, 'consumption', 'm');
      }), /permission denied|transaction temporarily unavailable/);
      assert.equal(state.starts, 1);
      assert.equal(state.callbacks, 1);
      assert.equal(state.aborts, 1);
      assert.equal(state.commits, 0);
    });
  });
}

test('business error code remains intact and never triggers retry', async () => {
  await offline({ phase: 'none' }, async (api, state) => {
    await assert.rejects(api.runTransaction(async t => {
      state.callbacks++;
      await api.touchGuard(t, 'consumption', 'm');
      throw api.businessError('已超过本周录入上限，必须填写特别录入原因', 'CONSUMPTION_LIMIT_REACHED');
    }), error => error.code === 'CONSUMPTION_LIMIT_REACHED');
    assert.equal(state.starts, 1);
    assert.equal(state.aborts, 1);
    assert.equal(state.stored.size, 0);
  });
});

test('SDK conflict recovery rereads usage and returns the quota business error instead of a generic wrapper', async () => {
  await offline({ phase: 'update', used: 0, onConflict: state => { state.used = 1; } }, async (api, state) => {
    const usageReads = [];
    await assert.rejects(api.runTransaction(async t => {
      state.callbacks++;
      const guard = await api.touchGuard(t, 'consumption', 'm');
      const usage = await api.consumptionUsage('m', { consumptionLimit: { period: 'week', resetDay: 1, resetHour: 4, maxCount: 1 } });
      usageReads.push(usage.used);
      if (usage.used >= usage.max) throw api.businessError('录入上限，需要特别原因', 'CONSUMPTION_LIMIT_REACHED');
      await guard.update({ data: { used: usage.used + 1 } });
      await t.collection('audit_logs').add({ data: { actionType: 'must-not-commit' } });
    }), error => error.code === 'CONSUMPTION_LIMIT_REACHED' && /特别原因/.test(error.message));
    assert.deepEqual(usageReads, [0, 1]);
    assert.equal(state.starts, 2);
    assert.equal(state.callbacks, 2);
    assert.equal(state.aborts, 2);
    assert.equal(state.commits, 0);
    assert.equal(state.stored.size, 0);
  });
});

test('message-only fallback accepts this SDK documented conflict wrappers and rejects broad or conflicting classifications', async () => {
  await offline({ phase: 'none' }, async api => {
    const isConflict = api.isTransactionConflict;
    assert.equal(isConflict({ code: 'DATABASE_TRANSACTION_CONFLICT', message: 'opaque service text' }), true);
    assert.equal(isConflict({ errCode: -501001, message: 'document.get:fail -501001 resource system error. database transaction conflict' }), true);
    assert.equal(isConflict({ errCode: -501001, message: 'document.set:fail -501001 resource system error. DATABASE_TRANSACTION_CONFLICT: database transaction conflict' }), true);
    assert.equal(isConflict({ errCode: -501001, message: 'document.set:fail -501001 resource system error. transaction conflict' }), true);
    for (const error of [
      { code: 'CONSUMPTION_LIMIT_REACHED', message: 'database transaction conflict' },
      { code: 'PERMISSION_DENIED', errCode: -501001, message: 'database transaction conflict' },
      { errCode: -501001, message: 'document.get:fail timeout during transaction' },
      { errCode: -501001, message: 'document.set:fail database transaction conflict may have happened' },
      { errCode: -501001, message: 'document.update:fail transaction temporarily unavailable' },
      { errCode: -501001, message: 'document.get:fail -501001 resource system error. transaction timeout' },
      { errCode: -501001, message: 'document.get:fail -501001 resource system error. not a transaction conflict' },
      { message: 'database transaction conflict' },
    ]) assert.equal(isConflict(error), false, JSON.stringify(error));
  });
});
