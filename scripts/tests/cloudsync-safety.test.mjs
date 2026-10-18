/* Session/storage regressions for the real cloudsync module; all data and fetches stay in memory.
 * node scripts/tests/cloudsync-safety.test.mjs
 * Reproduce the two original defects without changing the checkout:
 * git show 8679e8ad:src/scripts/lang/cloudsync.js | CLOUDSYNC_BASELINE_STDIN=1 CLOUDSYNC_TEST_FILTER='in-flight GET|local word write' node scripts/tests/cloudsync-safety.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/scripts/lang/cloudsync.js', ROOT);
const source = (process.env.CLOUDSYNC_BASELINE_STDIN === '1'
  ? readFileSync(0, 'utf8')
  : readFileSync(SRC, 'utf8')).replace("'./synccore.js'", JSON.stringify(new URL('synccore.js', SRC).href));
const CK = 'yzzn-cloud', BK = 'yzzn-cloud-base', RK = 'yzzn-cloud-recovery';
const WORDS = 'yzzn-en-words', STATS = 'yzzn-en-stats', DAY = '2026-10-18';
const A = { token: 'synthetic-session-a', uid: '1111111111111111', owner: '1111111111111111', u: 'a', ownerName: 'a', lastSync: 7 };
const B = { token: 'synthetic-session-b', uid: '2222222222222222', owner: '2222222222222222', u: 'b', ownerName: 'b', lastSync: 9 };
const word = (w, mt = 1) => ({ w, def: w, mt });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const decode = body => { const b = JSON.parse(body); return { ...b, keys: b.z ? JSON.parse(gunzipSync(Buffer.from(b.z, 'base64'))) : b.keys }; };
const savedGlobals = new Map(['localStorage', 'fetch', 'window', 'document', 'location', 'confirm', 'CompressionStream', 'DecompressionStream'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
let serial = 0;

class MemStorage {
  values = new Map();
  fail = null;
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { if (this.fail?.('get', k)) throw new Error('storage read blocked'); return this.values.get(k) ?? null; }
  setItem(k, v) { if (this.fail?.('set', k, String(v))) throw new DOMException('synthetic quota failure', 'QuotaExceededError'); this.values.set(k, String(v)); }
  removeItem(k) { if (this.fail?.('remove', k)) throw new Error('storage removal blocked'); this.values.delete(k); }
}
async function fresh(initial = {}) {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.location;
  globalThis.confirm = () => true;
  const ls = globalThis.localStorage = new MemStorage();
  for (const [k, v] of Object.entries({ [CK]: A, ...initial })) ls.setItem(k, JSON.stringify(v));
  const cs = (await import('data:text/javascript;base64,' + Buffer.from(source + '\n// isolated case ' + (++serial)).toString('base64'))).__test;
  return { ls, cs, get: k => JSON.parse(ls.getItem(k)), set: (k, v) => ls.setItem(k, JSON.stringify(v)) };
}
function transport(initial) {
  let remote = initial;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ method: init.method, auth: init.headers.authorization });
    if (init.method === 'GET') return reply(remote);
    const b = decode(init.body);
    remote = { fmt: 2, v: b.v, keys: b.keys };
    return reply({ v: b.v });
  };
  return { calls, puts: () => calls.filter(c => c.method === 'PUT').length, remote: () => remote };
}
const fixture = () => fresh({ [STATS]: { [DAY]: 12 }, [WORDS]: [word('local')], [BK]: { uid: A.uid, v: 'v10', keys: { [STATS]: { [DAY]: 10 } } } });
const remote = () => ({ fmt: 2, v: 'v13', keys: { [WORDS]: [word('remote', 2)], [STATS]: { [DAY]: 13 } } });
const cases = [];
const scenario = (name, fn) => cases.push([name, fn]);

scenario('in-flight GET cannot mix accounts or commit as the new account', async () => {
  const d = await fresh();
  const gate = deferred(), calls = [];
  globalThis.fetch = async (url, init) => { calls.push(init); return init.method === 'GET' ? gate.promise : reply({ v: 'unexpected-put' }); };
  const pending = d.cs.fullSync({ silent: true });
  d.cs.setCloud(B); d.set(WORDS, [word('b-private')]); d.set(BK, { uid: B.uid, v: 'b-base', keys: {} });
  const before = new Map(d.ls.values);
  gate.resolve(reply({ fmt: 2, v: 'a-base', keys: { [WORDS]: [word('a-private')] } }));
  assert.equal((await pending).ok, false);
  assert.equal(calls.length, 1, 'old GET must never lead to a PUT for either account');
  assert.equal(calls[0].headers.authorization, 'Bearer ' + A.token);
  assert.deepEqual(d.ls.values, before);
});

scenario('switch during response.json also cancels the old response', async () => {
  const d = await fresh(), entered = deferred(), body = deferred();
  let puts = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'PUT') { puts++; return reply({}); }
    return { ok: true, status: 200, json: () => { entered.resolve(); return body.promise; } };
  };
  const pending = d.cs.fullSync({ silent: true });
  await entered.promise;
  d.cs.setCloud(B); d.set(WORDS, [word('b')]);
  body.resolve({ fmt: 2, v: 'a', keys: { [WORDS]: [word('a')] } });
  assert.equal((await pending).ok, false);
  assert.equal(puts, 0);
  assert.deepEqual(d.get(WORDS), [word('b')]);
});

scenario('switch during compression cannot apply or upload the old snapshot', async () => {
  const d = await fresh({ [WORDS]: [word('local')] }), entered = deferred(), gate = deferred();
  globalThis.CompressionStream = class { constructor() { return new TransformStream({ async transform(chunk, ctl) { entered.resolve(); await gate.promise; ctl.enqueue(chunk); } }); } };
  const net = transport({ fmt: 2, v: 'a', keys: {} });
  const pending = d.cs.fullSync({ silent: true });
  await entered.promise;
  d.cs.setCloud(B); d.set(WORDS, [word('b')]);
  const before = new Map(d.ls.values);
  gate.resolve();
  assert.equal((await pending).ok, false);
  assert.equal(net.puts(), 0);
  assert.deepEqual(d.ls.values, before);
});

scenario('late PUT success cannot confirm the new account baseline or lastSync', async () => {
  const d = await fresh({ [WORDS]: [word('local')] }), entered = deferred(), gate = deferred();
  let putToken;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') return reply({ fmt: 2, v: 'a', keys: {} });
    putToken = init.headers.authorization; entered.resolve(); return gate.promise;
  };
  const pending = d.cs.fullSync({ silent: true });
  await entered.promise;
  d.cs.setCloud(B); d.set(BK, { uid: B.uid, v: 'b', keys: {} });
  const before = new Map(d.ls.values);
  gate.resolve(reply({ v: 'old-confirmation' }));
  assert.equal((await pending).ok, false);
  assert.equal(putToken, 'Bearer ' + A.token);
  assert.deepEqual(d.ls.values, before);
  assert.equal(d.cs.getCloud().lastSync, B.lastSync);
});

scenario('late 401 cannot clear a newer session, even when the same token is restored', async () => {
  const d = await fresh(), gate = deferred();
  globalThis.fetch = async () => gate.promise;
  const pending = d.cs.fullSync({ silent: true });
  d.cs.logout(); d.cs.setCloud(A);
  gate.resolve(reply({ error: 'expired' }, 401));
  assert.equal((await pending).ok, false);
  assert.equal(d.cs.getCloud().token, A.token);
  assert.equal(d.get(CK).token, A.token);
});

for (const [method, status] of [['logoutAll', 200], ['logoutAll', 401], ['deleteAccount', 200]]) {
  scenario('late ' + method + ' ' + status + ' cannot erase the new account', async () => {
    const d = await fresh(), gate = deferred();
    let sentToken;
    globalThis.fetch = async (url, init) => { sentToken = init.headers.authorization; return gate.promise; };
    const pending = method === 'deleteAccount' ? d.cs.deleteAccount('synthetic-password') : d.cs.logoutAll();
    d.cs.setCloud(B); d.set(BK, { uid: B.uid, v: 'b', keys: {} });
    const before = new Map(d.ls.values);
    gate.resolve(reply({ ok: status === 200 }, status));
    await pending;
    assert.equal(sentToken, 'Bearer ' + A.token);
    assert.equal(d.cs.getCloud().token, B.token);
    assert.deepEqual(d.ls.values, before);
  });
}

scenario('only the most recently started login may establish a session', async () => {
  const d = await fresh({ [CK]: {} }), a = deferred(), b = deferred();
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') return reply({ fmt: 2, v: 'b', keys: {} });
    return JSON.parse(init.body).u === 'a' ? a.promise : b.promise;
  };
  const oldLogin = d.cs.auth('login', 'a', 'synthetic-password');
  const newLogin = d.cs.auth('login', 'b', 'synthetic-password');
  b.resolve(reply(B)); await newLogin;
  a.resolve(reply(A));
  assert.equal((await oldLogin).ok, false);
  assert.equal(d.cs.getCloud().token, B.token);
});

scenario('logout also cancels an in-flight login', async () => {
  const d = await fresh({ [CK]: {} }), gate = deferred();
  globalThis.fetch = async () => gate.promise;
  const pending = d.cs.auth('login', 'a', 'synthetic-password');
  d.cs.logout(); gate.resolve(reply(A));
  assert.equal((await pending).ok, false);
  assert.equal(d.cs.getCloud().token, '');
});

scenario('another tab changing persisted CK invalidates the old in-memory session', async () => {
  const d = await fresh(), gate = deferred();
  let puts = 0;
  globalThis.fetch = async (url, init) => { if (init.method === 'PUT') { puts++; return reply({}); } return gate.promise; };
  const pending = d.cs.fullSync({ silent: true });
  d.set(CK, B); d.set(WORDS, [word('b')]);
  const before = new Map(d.ls.values);
  gate.resolve(reply({ fmt: 2, v: 'a', keys: { [WORDS]: [word('a')] } }));
  assert.equal((await pending).ok, false);
  assert.equal(puts, 0);
  assert.deepEqual(d.ls.values, before);
});

scenario('stale-tab logout cannot overwrite the current owner or silently claim their local data', async () => {
  const d = await fresh();
  d.set(CK, B); d.set(WORDS, [word('b-private')]);
  const before = new Map(d.ls.values);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (url.endsWith('/api/auth/login')) return reply(A);
    return reply({ fmt: 2, v: 'empty', keys: {} });
  };
  d.cs.logout();
  assert.deepEqual(d.ls.values, before, 'the stale tab must never write A over B in CK');
  assert.equal((await d.cs.auth('login', 'a', 'synthetic-password')).ok, false);
  assert.equal(calls.length, 0, 'the stale page must reload before changing the current account');
  assert.deepEqual(d.ls.values, before);
});

scenario('sync notification reentry cannot continue the old account PUT', async () => {
  const d = await fresh({ [WORDS]: [word('local')] });
  globalThis.window = new EventTarget();
  const net = transport({ fmt: 2, v: 'a', keys: { [WORDS]: [word('remote')] } });
  window.addEventListener('yzzn-sync-applied', () => { d.cs.setCloud(B); d.set(WORDS, [word('b')]); d.set(BK, { uid: B.uid, v: 'b', keys: {} }); });
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(net.puts(), 0);
  assert.deepEqual(d.get(WORDS), [word('b')]);
  assert.equal(d.get(BK).uid, B.uid);
  assert.equal(d.cs.getCloud().lastSync, B.lastSync);
});

scenario('a stale request does not block the new account synchronization', async () => {
  const d = await fresh(), gate = deferred();
  globalThis.fetch = async (url, init) => init.headers.authorization === 'Bearer ' + A.token
    ? gate.promise : reply({ fmt: 2, v: 'b', keys: {} });
  const old = d.cs.fullSync({ silent: true });
  d.cs.setCloud(B);
  const current = await d.cs.fullSync({ silent: true });
  gate.resolve(reply({ fmt: 2, v: 'a', keys: {} }));
  assert.equal((await old).ok, false);
  assert.equal(current.ok, true);
  assert.equal(d.get(BK).uid, B.uid);
});

scenario('local word write failure cannot report successful sync', async () => {
  const d = await fresh(), before = new Map(d.ls.values);
  const net = transport({ fmt: 2, v: 'a', keys: { [WORDS]: [word('remote')] } });
  d.ls.fail = (op, key) => op === 'set' && key === WORDS;
  const result = await d.cs.fullSync({ silent: true });
  assert.equal(result.ok, false);
  assert.equal(net.puts(), 0);
  assert.equal(d.cs.getCloud().lastSync, A.lastSync);
  assert.deepEqual(d.ls.values, before);
});

for (const failedKey of [WORDS, BK]) {
  scenario('partial counter apply rolls back when ' + failedKey + ' fails and retry does not double-count', async () => {
    const d = await fixture(), before = new Map(d.ls.values);
    const net = transport(remote());
    let rejected = false;
    d.ls.fail = (op, key) => { if (!rejected && op === 'set' && key === failedKey) { rejected = true; return true; } return false; };
    assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
    assert.equal(net.puts(), 0);
    assert.deepEqual(d.ls.values, before);
    d.ls.fail = null;
    assert.equal((await d.cs.fullSync({ silent: true })).ok, true);
    assert.equal(d.get(STATS)[DAY], 15);
    assert.equal(net.remote().keys[STATS][DAY], 15);
  });
}

scenario('failed removeItem rolls back preceding data and metadata writes', async () => {
  const game = 'yzzn-ja-game', meta = 'yzzn-sync-meta';
  const d = await fresh({ [STATS]: { [DAY]: 12 }, [game]: { stars: { 0: 2 } }, [BK]: { uid: A.uid, v: 'v10', keys: { [STATS]: { [DAY]: 10 } } } });
  const before = new Map(d.ls.values);
  const net = transport({ fmt: 2, v: 'v13', keys: { [STATS]: { [DAY]: 13 }, [meta]: { del: {}, wipe: { [game]: Date.now() } } } });
  d.ls.fail = (op, key) => op === 'remove' && key === game;
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(net.puts(), 0);
  assert.deepEqual(d.ls.values, before);
});

scenario('journal or pending-baseline write failure prevents the PUT', async () => {
  for (const failedKey of [RK, BK]) {
    const d = await fixture(), before = new Map(d.ls.values), net = transport(remote());
    d.ls.fail = (op, key) => op === 'set' && key === failedKey;
    assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
    assert.equal(net.puts(), 0);
    assert.deepEqual(d.ls.values, before);
  }
});

for (const failedKey of [BK, CK]) {
  scenario('successful PUT with failed ' + failedKey + ' confirmation retains pending state for a safe retry', async () => {
    const d = await fixture(), net = transport(remote());
    d.ls.fail = (op, key) => op === 'set' && key === failedKey && net.puts() > 0;
    assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
    assert.equal(net.puts(), 1);
    assert.equal(d.cs.getCloud().lastSync, A.lastSync);
    assert.equal(d.get(CK).lastSync, A.lastSync);
    d.ls.fail = null;
    assert.equal((await d.cs.fullSync({ silent: true })).ok, true);
    assert.equal(d.get(STATS)[DAY], 15);
    assert.equal(net.puts(), 1, 'the already accepted PUT must not be counted or sent again');
    assert.equal(d.get(RK), null);
  });
}

scenario('no-PUT completion with CK failure rolls back local data and baseline', async () => {
  const d = await fresh(), before = new Map(d.ls.values);
  const net = transport({ fmt: 2, v: 'a', keys: { [WORDS]: [word('remote')] } });
  d.ls.fail = (op, key) => op === 'set' && key === CK;
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(net.puts(), 0);
  assert.equal(d.cs.getCloud().lastSync, A.lastSync);
  assert.deepEqual(d.ls.values, before);
});

scenario('unfinished rollback survives a module reload and is restored before any new merge', async () => {
  const d = await fixture(), beforeStats = d.ls.getItem(STATS), net = transport(remote());
  let rollbackBlocked = false;
  d.ls.fail = (op, key, value) => {
    if (op === 'set' && key === BK) { rollbackBlocked = true; return true; }
    return rollbackBlocked && op === 'set' && key === STATS && value === beforeStats;
  };
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(net.puts(), 0);
  const journal = d.get(RK);
  assert.ok(journal, 'a failed rollback must retain its durable recovery record');
  assert.ok(!JSON.stringify(journal).includes(A.token), 'recovery records must not duplicate session tokens');
  const beforeRetry = net.calls.length;
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(net.calls.length, beforeRetry, 'do not fetch or merge while rollback is blocked');
  d.ls.fail = null;
  const reloaded = (await import('data:text/javascript;base64,' + Buffer.from(source + '\n// recovered module ' + (++serial)).toString('base64'))).__test;
  assert.equal((await reloaded.fullSync({ silent: true })).ok, true);
  assert.equal(d.get(STATS)[DAY], 15);
  assert.equal(d.get(RK), null);
});

scenario('an A recovery journal may not overwrite data now owned by B', async () => {
  const d = await fixture(), net = transport(remote());
  let blocked = false;
  d.ls.fail = (op, key) => { if (op === 'set' && key === BK) { blocked = true; return true; } return blocked && op === 'set' && key === STATS; };
  await d.cs.fullSync({ silent: true });
  assert.ok(d.get(RK));
  d.ls.fail = null;
  d.set(CK, B); d.set(STATS, { [DAY]: 100 });
  const before = new Map(d.ls.values), calls = net.calls.length;
  const reloaded = (await import('data:text/javascript;base64,' + Buffer.from(source + '\n// foreign recovery ' + (++serial)).toString('base64'))).__test;
  assert.equal((await reloaded.fullSync({ silent: true })).ok, false);
  assert.deepEqual(d.ls.values, before);
  assert.equal(net.calls.length, calls);
});

async function leavePartialCounter(d) {
  let rollback = false;
  d.ls.fail = (op, key) => {
    if (op === 'set' && key === BK) { rollback = true; return true; }
    return rollback && op === 'remove' && key === STATS;
  };
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.equal(d.get(STATS)[DAY], 15);
  assert.ok(d.get(RK));
  d.ls.fail = null;
}

scenario('recovery preserves new learning after an interrupted rollback and explicitly pauses', async () => {
  const d = await fixture(), net = transport(remote());
  await leavePartialCounter(d);
  d.set(STATS, { [DAY]: 16 });
  const before = new Map(d.ls.values), calls = net.calls.length;
  assert.equal((await d.cs.fullSync({ silent: true })).ok, false);
  assert.deepEqual(d.ls.values, before, 'unrecorded edits must not be replaced by the journal before-image');
  assert.equal(net.calls.length, calls);
  assert.equal(net.puts(), 0);
});

scenario('successful deletion resolves its recovery journal before releasing the local owner', async () => {
  const d = await fixture();
  transport(remote());
  await leavePartialCounter(d);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/api/auth/delete')) return reply({ ok: true });
    if (url.endsWith('/api/auth/login')) return reply(B);
    if (init.method === 'PUT') return reply({ v: decode(init.body).v });
    return reply({ fmt: 2, v: 'b', keys: {} });
  };
  await d.cs.deleteAccount('synthetic-password');
  assert.equal(d.get(RK), null, 'a cleared owner must not strand its recovery journal');
  assert.equal(d.get(STATS)[DAY], 12);
  assert.equal(d.get(CK).token, '');
  assert.equal((await d.cs.auth('login', 'b', 'synthetic-password')).ok, true);
  assert.ok(calls.some(url => url.endsWith('/api/auth/login')));
  assert.equal(d.get(CK).owner, B.uid);
});

scenario('a journal created during account deletion keeps its owner if later learning conflicts with recovery', async () => {
  const d = await fixture(), gate = deferred();
  globalThis.fetch = async (url, init) => url.endsWith('/api/auth/delete') ? gate.promise : reply(remote());
  const deletion = d.cs.deleteAccount('synthetic-password');
  await leavePartialCounter(d);
  d.set(STATS, { [DAY]: 16 });
  const journal = d.ls.getItem(RK);
  gate.resolve(reply({ ok: true }));
  await deletion;
  assert.equal(d.get(CK).token, '');
  assert.equal(d.get(CK).owner, A.uid, 'preserve the recovery owner even though its remote account was deleted');
  assert.equal(d.get(CK).uid, A.uid);
  assert.equal(d.get(STATS)[DAY], 16);
  assert.equal(d.ls.getItem(RK), journal);
});

scenario('a journal appearing during another tab GET is recovered before computing its merge', async () => {
  const d = await fixture(), gate = deferred();
  const other = (await import('data:text/javascript;base64,' + Buffer.from(source + '\n// second tab ' + (++serial)).toString('base64'))).__test;
  let gets = 0;
  const puts = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') return ++gets === 1 ? gate.promise : reply(remote());
    const b = decode(init.body); puts.push(b.keys[STATS][DAY]); return reply({ v: b.v });
  };
  const old = d.cs.fullSync({ silent: true });
  await leavePartialCounter({ ...d, cs: other });
  gate.resolve(reply(remote()));
  assert.equal((await old).ok, true);
  assert.equal(d.get(STATS)[DAY], 15);
  assert.deepEqual(puts, [15], 'the partial 15 must never be merged again into a stale 18');
  assert.equal(d.get(RK), null);
});

const filter = process.env.CLOUDSYNC_TEST_FILTER ? new RegExp(process.env.CLOUDSYNC_TEST_FILTER) : null;
for (const [name, fn] of cases) {
  if (filter && !filter.test(name)) continue;
  await test(name, { timeout: 5000 }, async () => {
    try { await fn(); }
    finally { for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
  });
}
