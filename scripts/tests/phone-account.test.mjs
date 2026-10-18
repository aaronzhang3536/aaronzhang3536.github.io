import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

const coreSource = fs.readFileSync(new URL('../../public/account/core.js', import.meta.url), 'utf8');
const storageSource = fs.readFileSync(new URL('../../public/account/storage.js', import.meta.url), 'utf8');
class Disk {
  data = new Map(); fail = false;
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { if (this.fail) throw new Error('QuotaExceededError'); this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
}
function boot(disk = new Disk(), api = 'https://frame.example/api/v1') {
  const events = [], listeners = {};
  const ctx = { localStorage: disk, URL, console, crypto: webcrypto, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, Event: class { constructor(type) { this.type = type; } }, location: { reload() {} } };
  ctx.window = ctx; ctx.WOF_CONFIG = { app: 'within-one-frame', api, auth: 'https://accounts.example/api/v1' };
  ctx.dispatchEvent = e => { events.push(e); for (const fn of listeners[e.type] || []) fn(e); };
  ctx.addEventListener = (type, fn) => (listeners[type] ||= []).push(fn);
  vm.createContext(ctx); vm.runInContext(coreSource, ctx); vm.runInContext(storageSource, ctx);
  return { ctx, a: ctx.WOFAccount, storage: ctx.WOFStorage, core: ctx.WOFCore, disk, events };
}
function login(env, uid) {
  env.disk.setItem(env.a.sessionKey, JSON.stringify({ uid, token: 'test-' + uid, username: 'user-' + uid }));
  return boot(env.disk, env.a.config.api);
}

test('cloud whitelist excludes secrets and unrelated personal inputs', () => {
  const { core } = boot();
  for (const key of ['yzzn-en-cfg', 'yzzn-cloud', 'yzzn-wx-live', 'yzzn-uke-cfg', 'birth', 'chat', '__proto__']) assert.equal(core.syncKey(key), false);
  for (const key of ['yzzn-en-words', 'yzzn-ja-dojo', 'wof:bookmarks', 'yzzn-uke-plan', 'babel-manual', 'yzzn-arc-jig20', 'yzzn-arc-rhythm-hell']) assert.equal(!!core.syncKey(key), true);
});
test('guest legacy data stays available without being copied to a new user', () => {
  const env = boot(); env.disk.setItem('wof:bookmarks', '["legacy"]');
  assert.equal(env.storage.getItem('wof:bookmarks'), '["legacy"]');
  const user = login(env, 1);
  assert.equal(user.storage.getItem('wof:bookmarks'), null);
  assert.equal(user.disk.getItem('wof:bookmarks'), '["legacy"]');
});
test('two users have separate business data and AI configuration', () => {
  const first = login(boot(), 1); first.storage.setItem('wof:bookmarks', '["one"]'); first.storage.setItem('yzzn-en-cfg', '{"key":"private"}');
  const second = login(first, 2); assert.equal(second.storage.getItem('wof:bookmarks'), null); assert.equal(second.storage.getItem('yzzn-en-cfg'), null);
  second.storage.setItem('wof:bookmarks', '["two"]');
  const again = login(second, 1); assert.equal(again.storage.getItem('wof:bookmarks'), '["one"]');
  assert.equal(again.storage.getItem('yzzn-en-cfg'), '{"key":"private"}');
  assert.equal('yzzn-en-cfg' in again.core.cloudValues(again.a.read().values), false);
});
test('old tab cannot mutate data after an account switch', () => {
  const first = login(boot(), 1); first.storage.setItem('yzzn-fish', '1');
  const second = login(first, 2); second.storage.setItem('yzzn-fish', '10');
  assert.throws(() => first.storage.setItem('yzzn-fish', '999'), /账号已变更/);
  assert.equal(second.storage.getItem('yzzn-fish'), '10');
  assert.equal(login(second, 1).storage.getItem('yzzn-fish'), '1');
});
test('backend changes do not share credentials or data namespaces', () => {
  const first = login(boot(), 1); first.storage.setItem('yzzn-fish', '7');
  const second = boot(first.disk, 'https://second.example/api/v1');
  assert.equal(second.a.session, null); assert.equal(second.storage.getItem('yzzn-fish'), null);
});
test('quota failure leaves previous complete state and emits visible error', () => {
  const env = login(boot(), 1); env.storage.setItem('yzzn-fish', '3'); const before = env.disk.getItem(env.a.dataKey);
  env.disk.fail = true; assert.throws(() => env.storage.setItem('yzzn-fish', '4'), /Quota/);
  assert.equal(env.disk.getItem(env.a.dataKey), before); assert.match(env.events.at(-1).detail, /保存失败/);
});
test('pending request and subsequent edits persist across reload', () => {
  const env = login(boot(), 1); const state = env.a.read(); state.pending = { base: 0, operation_id: 'stable', values: { 'yzzn-fish': '2' } }; env.a.write(state);
  env.storage.setItem('yzzn-fish', '3'); const reloaded = boot(env.disk);
  assert.equal(reloaded.a.read().pending.operation_id, 'stable'); assert.equal(reloaded.storage.getItem('yzzn-fish'), '3');
});
test('remote deletion replaces unchanged local state', () => {
  const { core } = boot(); const merged = core.merge({ 'wof:bookmarks': '["a"]' }, { 'wof:bookmarks': '["a"]' }, { 'wof:bookmarks': null });
  assert.equal(merged.values['wof:bookmarks'], null); assert.equal(merged.conflicts.length, 0);
});
test('old-device changes cannot automatically resurrect reset records', () => {
  const { core } = boot(); const result = core.merge({ 'babel-manual': '{"cat":3}' }, { 'babel-manual': '{"cat":3,"dog":1}' }, { 'babel-manual': '{}' });
  assert.deepEqual([...result.conflicts], ['babel-manual']);
});
test('independent fields merge while simultaneous counters require a decision', () => {
  const { core } = boot(); const result = core.merge({ 'yzzn-fish': '2', 'wof:reading-size': '20' }, { 'yzzn-fish': '3', 'wof:reading-size': '16' }, { 'yzzn-fish': '4', 'wof:reading-size': '20' });
  assert.equal(result.values['wof:reading-size'], '16'); assert.deepEqual([...result.conflicts], ['yzzn-fish']);
});
test('cancelling a task and clearing bookmarks are preserved as actual edits', () => {
  const { core } = boot(); const result = core.merge({ 'yzzn-uke-plan': '{"1-1":true}', 'wof:bookmarks': '["a"]' }, { 'yzzn-uke-plan': '{"1-1":false}', 'wof:bookmarks': '[]' }, { 'yzzn-uke-plan': '{"1-1":true}', 'wof:bookmarks': '["a"]' });
  assert.equal(result.values['yzzn-uke-plan'], '{"1-1":false}'); assert.equal(result.values['wof:bookmarks'], '[]'); assert.equal(result.conflicts.length, 0);
});
test('expired sessions retain owned offline changes without falling back to guest', () => {
  const env = login(boot(), 1); env.storage.setItem('yzzn-fish', '9');
  env.disk.setItem(env.a.sessionKey, JSON.stringify({ uid: 1, token: '', expired: true }));
  const expired = boot(env.disk); assert.equal(expired.a.owner, '1'); assert.equal(expired.storage.getItem('yzzn-fish'), '9');
});
test('snapshot commit cannot overwrite an edit appended by another tab', () => {
  const env = login(boot(), 1), staleSnapshot = env.a.read();
  const other = boot(env.disk);
  other.storage.setItem('yzzn-fish', '12');
  env.a.write(staleSnapshot, false);
  assert.equal(env.storage.getItem('yzzn-fish'), '12');
  const committed = env.a.read(); env.a.write(committed, false);
  assert.equal(boot(env.disk).storage.getItem('yzzn-fish'), '12');
});
test('snapshot metadata changes do not cause a reload cycle', () => {
  const env = login(boot(), 1);
  let reloads = 0; env.ctx.location.reload = () => reloads++;
  env.ctx.dispatchEvent({ type: 'storage', key: env.a.dataKey, oldValue: JSON.stringify({ values: { 'yzzn-fish': '3' }, version: 1 }), newValue: JSON.stringify({ values: { 'yzzn-fish': '3' }, version: 2 }) });
  assert.equal(reloads, 0);
  env.storage.setItem('yzzn-fish', '4');
});
test('leftover consumed edits cannot resurrect a later remote reset', () => {
  const env = login(boot(), 1); env.storage.setItem('babel-manual', '{"cat":3}');
  const state = env.a.read(); state.values['babel-manual'] = '{}';
  const remove = env.disk.removeItem.bind(env.disk); env.disk.removeItem = () => { throw new Error('cleanup interrupted'); };
  env.a.write(state, false); env.disk.removeItem = remove;
  assert.equal(boot(env.disk).storage.getItem('babel-manual'), '{}');
});
