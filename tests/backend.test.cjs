const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend, memoryDatabase } = require('./support-memory-db.cjs');

const succeeded = result => { assert.equal(result.ok, true, result.error); return result.data; };
const failed = (result, pattern) => { assert.equal(result.ok, false, JSON.stringify(result)); if (pattern) assert.match(result.error, pattern); return result; };
const member = (h, id = 'm') => h.rows('members').find(m => m._id === id);
const active = h => h.rows('event_registrations').filter(r => r.status === 'registered');
const review = (id, extra = {}) => ({ _id: id, memberId: 'm', platform: 'xiaohongshu', status: 'pending', createdAt: new Date('2026-10-15T01:00:00Z'), ...extra });
const event = (extra = {}) => ({ _id: 'e', status: 'published', capacity: 1, title: 'Competition', ...extra });
const consume = (extra = {}) => ({ memberId: 'm', tierId: 'tier_4h', ...extra });

test('memory DB: failed transactions roll back, conflicts retry against a new snapshot, count reads live data', async () => {
  const h = memoryDatabase();
  h.seed('values', [{ _id: 'one', n: 0 }]);
  let reads = 0;
  await Promise.all([1, 2].map(() => h.db.runTransaction(async t => {
    const { data } = await t.collection('values').doc('one').get();
    reads++;
    await t.collection('values').doc('one').update({ data: { n: data.n + 1 } });
  })));
  assert.equal(h.rows('values')[0].n, 2);
  assert.equal(h.stats.conflicts, 1);
  assert.equal(reads, 3);
  await assert.rejects(h.db.runTransaction(async t => {
    await t.collection('values').add({ data: { _id: 'rolled-back', n: 3 } });
    throw Error('stop');
  }), /stop/);
  assert.equal(h.rows('values').length, 1);
  const t = await h.db.startTransaction();
  await h.db.collection('values').add({ data: { _id: 'after-snapshot', n: 4 } });
  assert.equal((await t.collection('values').get()).data.length, 1);
  assert.equal((await t.collection('values').limit(1).count()).total, 2);
  await t.rollback();
});

test('config: transient read errors never replace existing administrator settings', async () => {
  const h = loadBackend();
  const before = h.rows('configs');
  h.inject({ collection: 'configs', operation: 'get', error: Error('transient timeout') });
  failed(await h.call('getConfig'), /timeout/);
  assert.deepEqual(h.rows('configs'), before);
});

test('config: missing config initializes once under concurrent requests', async () => {
  const h = loadBackend();
  await h.db.collection('configs').doc('default').remove();
  const results = await Promise.all([h.call('getConfig'), h.call('getConfig')]);
  results.forEach(succeeded);
  assert.equal(h.rows('configs').length, 1);
  assert.equal(h.rows('configs')[0]._id, 'default');
});

test('config: losing initialization race rereads the winner without overwriting its admins', async () => {
  const h = loadBackend();
  await h.db.collection('configs').doc('default').remove();
  h.inject({ collection: 'configs', operation: 'add', effect: async () => {
    await h.db.collection('configs').doc('default').set({ data: { admins: ['kept'], superAdmins: ['owner'] } });
  } });
  succeeded(await h.call('getConfig'));
  assert.deepEqual(h.rows('configs')[0].admins, ['kept']);
  assert.deepEqual(h.rows('configs')[0].superAdmins, ['owner']);
});

test('config: initialization permission errors are not treated as duplicate-create recovery', async () => {
  const h = loadBackend();
  await h.db.collection('configs').doc('default').remove();
  h.inject({ collection: 'configs', operation: 'add', error: Error('permission denied') });
  failed(await h.call('getConfig'), /permission denied/);
  assert.equal(h.rows('configs').length, 0);
});

test('redemption: two requests of eight against ten permit only one and leave one ledger/audit', async () => {
  const h = loadBackend();
  const results = await Promise.all([1, 2].map(() => h.call('redeemPoints', { memberId: 'm', points: 8, item: 'voucher' })));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  failed(results.find(r => !r.ok), /积分不足/);
  assert.equal(member(h).points, 2);
  assert.equal(member(h).growth, 10);
  assert.equal(h.rows('point_entries').length, 1);
  assert.equal(h.rows('audit_logs').length, 1);
  assert(h.stats.conflicts > 0, 'requests must actually contend');
});

test('redemption: audit failure rolls back the balance and ledger', async () => {
  const h = loadBackend();
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('redeemPoints', { memberId: 'm', points: 8, item: 'voucher' }), /audit unavailable/);
  assert.equal(member(h).points, 10);
  assert.equal(h.rows('point_entries').length, 0);
  assert.equal(h.rows('audit_logs').length, 0);
});

test('review: concurrent approvals of one application award only once', async () => {
  const h = loadBackend();
  h.seed('review_submissions', [review('r')]);
  const results = await Promise.all([1, 2].map(() => h.call('reviewAction', { id: 'r', subAction: 'approve' })));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(member(h).points, 13);
  assert.equal(h.rows('review_submissions')[0].status, 'approved');
  assert.equal(h.rows('point_entries').length, 1);
  assert.equal(h.rows('audit_logs').length, 1);
});

test('review: concurrent approve/reject cannot leave rejected state with awarded points', async () => {
  const h = loadBackend();
  h.seed('review_submissions', [review('r')]);
  const results = await Promise.all([
    h.call('reviewAction', { id: 'r', subAction: 'approve' }),
    h.call('reviewAction', { id: 'r', subAction: 'reject', reason: 'invalid' }),
  ]);
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  const approved = h.rows('review_submissions')[0].status === 'approved';
  assert.equal(member(h).points, approved ? 13 : 10);
  assert.equal(h.rows('point_entries').length, approved ? 1 : 0);
  assert.equal(h.rows('audit_logs').length, 1);
});

test('review: distinct applications contend for one regular slot; remaining requires special reason', async () => {
  const h = loadBackend();
  h.seed('review_submissions', [review('r1'), review('r2')]);
  const results = await Promise.all(['r1', 'r2'].map(id => h.call('reviewAction', { id, subAction: 'approve' })));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  const pending = h.rows('review_submissions').find(r => r.status === 'pending');
  assert(pending);
  assert.equal(member(h).points, 13);
  succeeded(await h.call('reviewAction', { id: pending._id, subAction: 'approve', specialReason: 'approved exception' }));
  assert.equal(member(h).points, 16);
  assert.equal(h.rows('review_submissions').filter(r => r.isSpecial).length, 1);
});

test('review: historical approvals consume quota and audit failure rolls approval back', async () => {
  const h = loadBackend();
  h.seed('review_submissions', [review('old', { status: 'approved' }), review('r')]);
  failed(await h.call('reviewAction', { id: 'r', subAction: 'approve' }), /上限/);
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('reviewAction', { id: 'r', subAction: 'approve', specialReason: 'exception' }), /audit unavailable/);
  assert.equal(h.rows('review_submissions').find(r => r._id === 'r').status, 'pending');
  assert.equal(member(h).points, 10);
  assert.equal(h.rows('point_entries').length, 0);
});

test('review: earlier-period history does not consume the current slot and rule changes do not erase current approvals', async () => {
  const h = loadBackend();
  h.seed('review_submissions', [
    review('past-month', { status: 'approved', createdAt: new Date('2026-09-30T03:00:00Z') }),
    review('r1'), review('r2'),
  ]);
  succeeded(await h.call('reviewAction', { id: 'r1', subAction: 'approve' }));
  h.config({ reviewBonuses: [{ platform: 'xiaohongshu', name: '小红书', points: 4, period: 'week', maxCount: 1 }] });
  const result = failed(await h.call('reviewAction', { id: 'r2', subAction: 'approve' }), /上限/);
  assert.equal(result.code, 'REVIEW_LIMIT_REACHED');
  assert.equal(member(h).points, 13);
  assert.equal(h.rows('review_submissions').find(r => r._id === 'r2').status, 'pending');
});

test('consumption: concurrent final slot cannot produce two ordinary entries', async () => {
  const h = loadBackend();
  h.config({ consumptionLimit: { period: 'week', resetDay: 1, resetHour: 4, maxCount: 1 } });
  const results = await Promise.all([1, 2].map(() => h.call('createConsumption', consume())));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(results.find(r => !r.ok).code, 'CONSUMPTION_LIMIT_REACHED');
  assert.equal(h.rows('consumption_records').length, 1);
  assert.equal(h.rows('point_entries').length, 1);
  succeeded(await h.call('createConsumption', consume({ specialReason: 'staff exception' })));
  assert.equal(h.rows('consumption_records').filter(r => r.isSpecial).length, 1);
  assert.equal(member(h).points, 14);
});

test('consumption: history and rule edits retain usage, while old-period entries do not count', async () => {
  const h = loadBackend();
  h.config({ consumptionLimit: { period: 'week', resetDay: 1, resetHour: 4, maxCount: 2 } });
  h.seed('consumption_records', [
    { _id: 'old', memberId: 'm', createdAt: new Date('2026-10-01T08:00:00Z') },
    { _id: 'this-period', memberId: 'm', createdAt: new Date('2026-10-14T08:00:00Z'), isSpecial: true },
  ]);
  succeeded(await h.call('createConsumption', consume()));
  h.config({ consumptionLimit: { period: 'week', resetDay: 0, resetHour: 2, maxCount: 2 } });
  failed(await h.call('createConsumption', consume()), /上限/);
  assert.equal(h.rows('consumption_records').length, 3);
  assert.equal(member(h).points, 12);
});

test('consumption: failed audit leaves neither record nor points and does not spend quota', async () => {
  const h = loadBackend();
  h.config({ consumptionLimit: { period: 'week', resetDay: 1, resetHour: 4, maxCount: 1 } });
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('createConsumption', consume()), /audit unavailable/);
  assert.equal(h.rows('consumption_records').length, 0);
  assert.equal(member(h).points, 10);
  succeeded(await h.call('createConsumption', consume()));
  assert.equal(h.rows('consumption_records')[0].isSpecial, false);
});

test('registration: different members race for the last place, cancellation releases and allows reentry', async () => {
  const h = loadBackend();
  h.seed('events', [event()]);
  const results = await Promise.all(['member', 'member2'].map(actor => h.call('registerEvent', { id: 'e' }, actor)));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(active(h).length, 1);
  const registration = active(h)[0];
  const actor = registration.memberId === 'm' ? 'member' : 'member2';
  succeeded(await h.call('cancelEventRegistration', { id: registration._id }, actor));
  assert.equal(active(h).length, 0);
  failed(await h.call('cancelEventRegistration', { id: registration._id }, actor));
  succeeded(await h.call('registerEvent', { id: 'e' }, actor));
  assert.equal(active(h).length, 1);
});

test('registration: same member concurrent requests occupy at most one place', async () => {
  const h = loadBackend();
  h.seed('events', [event({ capacity: 10 })]);
  await Promise.all([1, 2].map(() => h.call('registerEvent', { id: 'e' }, 'member')));
  assert.equal(active(h).length, 1);
  succeeded(await h.call('registerEvent', { id: 'e' }, 'member2'));
  assert.equal(active(h).length, 2);
  const list = succeeded(await h.call('getEvent', { id: 'e' }, 'member'));
  assert.equal(list.event.registrationCount, 2);
});

test('registration: historical occupancy counts, admin bypasses capacity/deadline, removal frees exactly once', async () => {
  const h = loadBackend();
  h.seed('events', [event()]);
  h.seed('event_registrations', [{ _id: 'legacy', eventId: 'e', memberId: 'm', status: 'registered', createdAt: new Date() }]);
  failed(await h.call('registerEvent', { id: 'e' }, 'member2'), /名额/);
  succeeded(await h.call('removeEventRegistration', { id: 'legacy' }));
  failed(await h.call('removeEventRegistration', { id: 'legacy' }));
  succeeded(await h.call('registerEvent', { id: 'e' }, 'member2'));
  h.seed('events', [event({ registerDeadline: new Date('2026-01-01T00:00:00Z') })]);
  succeeded(await h.call('addEventRegistration', { eventId: 'e', memberId: 'm' }));
  assert.equal(active(h).length, 2);
  failed(await h.call('addEventRegistration', { eventId: 'e', memberId: 'm' }));
  assert.equal(active(h).length, 2);
});

test('registration: admin audit failures roll back registration and capacity', async () => {
  const h = loadBackend();
  h.seed('events', [event()]);
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('addEventRegistration', { eventId: 'e', memberId: 'm' }), /audit unavailable/);
  assert.equal(active(h).length, 0);
  succeeded(await h.call('registerEvent', { id: 'e' }, 'member2'));
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('removeEventRegistration', { id: active(h)[0]._id }), /audit unavailable/);
  assert.equal(active(h).length, 1);
});

test('registration: concurrent cancel/remove release one place, and a fresh member can fill it', async () => {
  const h = loadBackend();
  h.seed('events', [event()]);
  const registration = succeeded(await h.call('registerEvent', { id: 'e' }, 'member'));
  const results = await Promise.all([
    h.call('cancelEventRegistration', { id: registration.id }, 'member'),
    h.call('removeEventRegistration', { id: registration.id }),
  ]);
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(active(h).length, 0);
  const next = succeeded(await h.call('registerEvent', { id: 'e' }, 'member2'));
  assert.equal(next.registrationCount, 1);
  assert.equal(active(h).length, 1);
});

test('registration: unavailable events retain safe placeholders and do not expose draft titles or covers', async () => {
  const h = loadBackend();
  h.seed('events', [event({ status: 'draft', title: 'Secret draft', images: ['cloud://secret'], contentMarkdown: 'Secret body' })]);
  h.seed('event_registrations', [
    { _id: 'draft-reg', eventId: 'e', memberId: 'm', status: 'registered' },
    { _id: 'missing-reg', eventId: 'missing', memberId: 'm', status: 'registered' },
  ]);
  const result = succeeded(await h.call('listMyEventRegistrations', {}, 'member'));
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.unavailable, true);
    assert.equal(item.title, '赛事暂不可用');
    assert.equal(item.cover, '');
    assert.equal(item.contentMarkdown, undefined);
  }
  failed(await h.call('getEvent', { id: 'e' }, 'member'), /不存在/);
});

test('event honor: a conflict after the first award retries without duplicating response items or persisted awards', async () => {
  const h = loadBackend();
  h.seed('events', [event()]);
  h.seed('event_registrations', ['m', 'm2'].map(id => ({ _id: `reg-${id}`, eventId: 'e', memberId: id, status: 'registered' })));
  h.inject({ collection: 'members', operation: 'get', id: 'm2', error: Object.assign(Error('database transaction conflict'), { code: 'DATABASE_TRANSACTION_CONFLICT' }) });
  const result = succeeded(await h.call('awardEventHonor', { eventId: 'e', items: [{ memberId: 'm', honor: 3 }, { memberId: 'm2', honor: 5 }] }));
  assert.equal(result.count, 2);
  assert.equal(result.awarded.length, 2);
  assert.equal(new Set(result.awarded.map(item => item.memberId)).size, 2);
  assert.equal(member(h).honor, 3);
  assert.equal(member(h, 'm2').honor, 5);
  assert.equal(h.rows('honor_entries').length, 2);
  assert.equal(h.rows('audit_logs').length, 2);
  assert.equal(h.stats.rollbacks, 1);
});

test('rename: one-time entitlement is consumed atomically under concurrent requests', async () => {
  const h = loadBackend();
  const results = await Promise.all(['alpha1', 'beta11'].map(accountName => h.call('renameAccountName', { accountName }, 'member')));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(member(h).accountNameChanged, true);
  assert.equal(h.rows('audit_logs').length, 1);
});

test('rename: unique name conflict leaves loser entitlement and audit unchanged', async () => {
  const h = loadBackend();
  const results = await Promise.all(['member', 'member2'].map(actor => h.call('renameAccountName', { accountName: 'shared1' }, actor)));
  assert.equal(results.filter(r => r.ok).length, 1, JSON.stringify(results));
  assert.equal(h.rows('members').filter(m => m.accountName === 'shared1').length, 1);
  assert.equal(h.rows('members').filter(m => m.accountNameChanged).length, 1);
  assert.equal(h.rows('audit_logs').length, 1);
});

test('rename: audit failure preserves old name and unused entitlement', async () => {
  const h = loadBackend();
  h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
  failed(await h.call('renameAccountName', { accountName: 'newname1' }, 'member'), /audit unavailable/);
  assert.equal(member(h).accountName, 'member1');
  assert.equal(member(h).accountNameChanged, false);
  assert.equal(h.rows('audit_logs').length, 0);
});

test('login: unique-openid create contention rereads winner and preserves legacy member IDs', async () => {
  const h = loadBackend();
  const results = await Promise.all([1, 2].map(() => h.call('login', {}, 'new-member')));
  results.forEach(succeeded);
  assert.equal(h.rows('members').filter(m => m.openid === 'new-member').length, 1);
  assert.equal(results[0].data.member.id, results[1].data.member.id);
  assert.equal(succeeded(await h.call('login', {}, 'member')).member.id, 'm');
  assert.equal(member(h).points, 10);
});

test('login: unknown create failures remain failures rather than inventing a member', async () => {
  const h = loadBackend();
  h.inject({ collection: 'members', operation: 'add', error: Error('permission denied') });
  failed(await h.call('login', {}, 'new-member'), /permission denied/);
  assert.equal(h.rows('members').filter(m => m.openid === 'new-member').length, 0);
});

for (const [action, payload] of [
  ['saveAdmins', { admins: ['new-admin'] }],
  ['saveSuperConfig', { config: { storeInfo: { name: 'New name', contact: 'New contact' } } }],
]) {
  test(`${action}: config and audit commit together; audit error rolls update back`, async () => {
    const h = loadBackend();
    const before = h.rows('configs');
    h.inject({ collection: 'audit_logs', operation: 'add', error: Error('audit unavailable') });
    failed(await h.call(action, payload, 'super'), /audit unavailable/);
    assert.deepEqual(h.rows('configs'), before);
    assert.equal(h.rows('audit_logs').length, 0);
    succeeded(await h.call(action, payload, 'super'));
    assert.equal(h.rows('audit_logs').length, 1);
    if (action === 'saveAdmins') assert.deepEqual(h.rows('configs')[0].admins, payload.admins);
    else assert.equal(h.rows('configs')[0].storeInfo.name, 'New name');
  });
}

test('review lists: processed filtering precedes stable pagination and pending total is real', async () => {
  const h = loadBackend();
  const newer = Array.from({ length: 55 }, (_, i) => review(`pending-${i}`, { createdAt: new Date('2026-10-15T03:00:00Z') }));
  const older = Array.from({ length: 5 }, (_, i) => review(`processed-${i}`, { status: i % 2 ? 'rejected' : 'approved', createdAt: new Date('2026-10-01T03:00:00Z') }));
  h.seed('review_submissions', [...newer, ...older]);
  const p1 = succeeded(await h.call('listReviewSubmissions', { status: 'processed', page: 1, pageSize: 2 }));
  const p2 = succeeded(await h.call('listReviewSubmissions', { status: 'processed', page: 2, pageSize: 2 }));
  const p3 = succeeded(await h.call('listReviewSubmissions', { status: 'processed', page: 3, pageSize: 2 }));
  assert.equal(p1.total, 5);
  assert.equal(new Set([...p1.items, ...p2.items, ...p3.items].map(r => r._id)).size, 5);
  assert(p1.items.every(r => r.status !== 'pending'));
  const pending = succeeded(await h.call('listReviewSubmissions', { status: 'pending', page: 1, pageSize: 2 }));
  assert.equal(pending.total, 55);
  assert.equal(pending.items.length, 2);
});

test('audit filters: every increase combination appears under each relevant balance', async () => {
  const h = loadBackend();
  const fields = ['points_increase', 'growth_increase', 'honor_increase'];
  const rows = [];
  for (let mask = 1; mask < 8; mask++) rows.push({ _id: `log-${mask}`, changeType: fields.filter((_, i) => mask & (1 << i)).join('+'), createdAt: new Date() });
  h.seed('audit_logs', rows);
  for (const field of fields) {
    const result = succeeded(await h.call('listAuditLogs', { changeType: field }));
    assert.equal(result.total, 4, field);
    assert(result.items.every(r => r.changeType.split('+').includes(field)), field);
  }
});

test('permission boundaries remain enforced for ordinary/admin actors', async () => {
  const h = loadBackend();
  failed(await h.call('redeemPoints', { memberId: 'm', points: 1, item: 'x' }, 'member'), /管理员权限/);
  failed(await h.call('saveAdmins', { admins: ['member'] }, 'admin'), /超级管理员权限/);
  failed(await h.call('saveSuperConfig', { config: { superAdmins: ['attacker'] } }, 'super'), /没有需要更新/);
  const publicConfig = succeeded(await h.call('getConfig', {}, 'member'));
  assert.equal('admins' in publicConfig, false);
  assert.equal('superAdmins' in publicConfig, false);
  assert.equal(member(h).points, 10);
});

test('periods: every configured weekday chooses the latest China reset, including year/month boundaries', () => {
  const h = loadBackend();
  const periodStart = h.internals.periodStart;
  for (let resetDay = 0; resetDay < 7; resetDay++) {
    const at = new Date('2026-01-01T02:00:00+08:00');
    const start = periodStart({ period: 'week', resetDay, resetHour: 4 }, at);
    assert(start <= at, `future start for weekday ${resetDay}`);
    assert(at - start < 7 * 24 * 60 * 60 * 1000);
    const local = new Date(+start + 8 * 60 * 60 * 1000);
    assert.equal(local.getUTCDay(), resetDay);
    assert.equal(local.getUTCHours(), 4);
  }
  assert.equal(periodStart({ period: 'week', resetDay: 1, resetHour: 4 }, new Date('2026-10-12T02:00:00+08:00')).toISOString(), '2026-10-04T20:00:00.000Z');
  assert.equal(periodStart({ period: 'week', resetDay: 1, resetHour: 4 }, new Date('2026-10-12T04:00:00+08:00')).toISOString(), '2026-10-11T20:00:00.000Z');
  assert.equal(periodStart({ period: 'month', resetHour: 4 }, new Date('2026-01-01T02:00:00+08:00')).toISOString(), '2025-11-30T20:00:00.000Z');
  assert.equal(periodStart({ period: 'month', resetHour: 4 }, new Date('2026-01-01T04:00:00+08:00')).toISOString(), '2025-12-31T20:00:00.000Z');
});
