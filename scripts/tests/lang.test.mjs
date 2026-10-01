/* 外语中心回归测试：零依赖，`node scripts/tests/lang.test.mjs`。
   A. 合并内核 synccore.js（两种词条形状、墓碑、清空标记、计数器三方合并、白名单、原型污染、不来回写）
   B. langdata.js（本地日期、旧 UTC 日期键兼容、墓碑 / 清空标记写入）
   C. 数据：欧洲语言冠词形式、英语考纲释义不含专业领域义项
   D. 端到端：多台「设备」各自加载一份 cloudsync.js，经 fetch 桩直连 sync-api 边缘函数 + 带延迟的内存 KV，
      覆盖旧数据迁移、跨设备进度、忘了、删除、清空、计数、并发冲突、体积、旧服务端、换账号、导出去密钥、
      接口地址覆盖、合并通知、令牌失效、写入响应丢失。 */
import fs from 'node:fs';
import zlib from 'node:zlib';

process.env.TZ = 'Asia/Shanghai';
const SRC = new URL('../../src/scripts/lang/', import.meta.url);
const ROOT = new URL('../../', import.meta.url);
const core = await import(new URL('synccore.js', SRC));
const { mergeAll, mergeEntries, entryTime, changedNames, canonKey, isSyncKey, META_KEY, DAY } = core;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (detail !== undefined ? '  ' + detail : ''));
}
const NOW = Date.now();
const ws = (r, k) => (r.keys[k] || []).map((e) => e.w).sort().join(',');

/* ================= A. 合并内核 ================= */
{
  /* 1. 英语词条（srs 形状）：另一台设备的进度能合并过来，不再永远本地胜 */
  const remoteA = { 'yzzn-en-words': [{ w: 'apple', def: 'x', t: 1, srs: { ef: 2.6, n: 3, i: 15, d: NOW + 15 * DAY }, mt: NOW - 1000 }] };
  const localB = { 'yzzn-en-words': [{ w: 'apple', def: 'x', t: 1, srs: { ef: 2.5, n: 1, i: 1, d: NOW - DAY }, mt: NOW - 2 * DAY }] };
  check('英语：较新的远端进度胜出', mergeAll(localB, remoteA, null, NOW).keys['yzzn-en-words'][0].srs.n === 3);
  /* 旧数据没有 mt：从 SM-2 状态反推 */
  const legA = { 'yzzn-en-words': [{ w: 'apple', def: 'x', t: 1, srs: { ef: 2.6, n: 3, i: 15, d: NOW + 15 * DAY } }] };
  const legB = { 'yzzn-en-words': [{ w: 'apple', def: 'x', t: 1, srs: { ef: 2.5, n: 1, i: 1, d: NOW - DAY } }] };
  check('英语旧数据：反推最后评分时间（15 天间隔、今天评的胜过 1 天间隔、两天前评的）', mergeAll(legB, legA, null, NOW).keys['yzzn-en-words'][0].srs.n === 3);
  check('entryTime 反推：英语 srs.d - srs.i 天', Math.abs(entryTime(legA['yzzn-en-words'][0], NOW + 20 * DAY) - NOW) < 5);
  /* 2. 「忘了」：本地刚忘（rep 0），远端还是 rep 3 → 本地胜 */
  const rem = { 'yzzn-ja-words': [{ w: '私', rep: 3, iv: 15, ef: 2.6, due: NOW - 1000 }] };
  const loc = { 'yzzn-ja-words': [{ w: '私', rep: 0, iv: 0, ef: 2.6, due: NOW + 6e5 }] };
  check('东亚旧数据：「忘了」不会被云端的高 rep 覆盖', mergeAll(loc, rem, null, NOW).keys['yzzn-ja-words'][0].rep === 0);
  const loc2 = { 'yzzn-en-words': [{ w: 'apple', def: 'x', t: 1, srs: { ef: 2.5, n: 0, i: 0, d: NOW + 6e5 }, mt: NOW }] };
  check('英语：「忘了」（n 归零、mt 最新）胜过远端旧的高进度', mergeAll(loc2, remoteA, null, NOW).keys['yzzn-en-words'][0].srs.n === 0);
  /* 3. 删除墓碑 */
  const r3 = { 'yzzn-en-words': [{ w: 'apple', t: 1 }, { w: 'banana', t: 2 }] };
  const l3 = { 'yzzn-en-words': [{ w: 'apple', t: 1 }], [META_KEY]: { del: { 'yzzn-en-words': { banana: NOW } }, wipe: {} } };
  const m3 = mergeAll(l3, r3, null, NOW);
  check('删除的词不被云端复活', ws(m3, 'yzzn-en-words') === 'apple', ws(m3, 'yzzn-en-words'));
  check('墓碑随合并结果上传', m3.keys[META_KEY].del['yzzn-en-words'].banana === NOW);
  const m3b = mergeAll({ 'yzzn-en-words': [{ w: 'banana', t: NOW + 5, mt: NOW + 5 }] }, { 'yzzn-en-words': [], [META_KEY]: m3.keys[META_KEY] }, null, NOW + 10);
  check('删除之后重新加入的词保留（mt 晚于墓碑）', ws(m3b, 'yzzn-en-words') === 'banana');
  /* 4. 清空标记 */
  const wipeAt = NOW - 1000;
  const l4 = { [META_KEY]: { del: {}, wipe: { 'yzzn-ko-words': wipeAt, 'yzzn-ko-game': wipeAt } } };
  const r4 = { 'yzzn-ko-words': [{ w: 'a', due: NOW - 5 * DAY, iv: 0 }, { w: 'b', mt: NOW }], 'yzzn-ko-game': { stars: { 0: 3 } } };
  const m4 = mergeAll(l4, r4, null, NOW);
  check('清空本语言：云端更早的词条与闯关进度不再复活', ws(m4, 'yzzn-ko-words') === 'b' && m4.keys['yzzn-ko-game'] === undefined, JSON.stringify(m4.keys));
  /* 5. 白名单：游戏厅（越小越好）、天气缓存、术数历史不参与 */
  const m5 = mergeAll({ 'yzzn-arc-mines': 30, 'yzzn-en-cfg': { key: 'sk' } }, { 'yzzn-arc-mines': 60, 'yzzn-wx-live': { city: 'X' }, 'yzzn-xlr-history': [1] }, null, NOW);
  check('非外语键一律不合并、不上传', Object.keys(m5.keys).length === 0, JSON.stringify(m5.keys));
  check('白名单判定', isSyncKey('yzzn-en-words') && isSyncKey('yzzn-ru-dojo') && !isSyncKey('yzzn-en-cfg') && !isSyncKey('yzzn-en-ai') &&
    !isSyncKey('yzzn-en-dict') && !isSyncKey('yzzn-arc-mines') && !isSyncKey('yzzn-uke-plan') && !isSyncKey('yzzn-cloud') && !isSyncKey(META_KEY));
  /* 6. 道场 [对, 错]：三方合并 */
  const d6 = mergeAll({ 'yzzn-ja-dojo': { 'sei-h:あ': [3, 1] } }, { 'yzzn-ja-dojo': { 'sei-h:あ': [1, 4] } }, { 'yzzn-ja-dojo': { 'sei-h:あ': [1, 1] } }, NOW);
  check('道场计数：base [1,1] + 本机 +2 对 + 远端 +3 错 = [3,4]', JSON.stringify(d6.keys['yzzn-ja-dojo']['sei-h:あ']) === '[3,4]');
  const d6b = mergeAll({ 'yzzn-ja-dojo': { x: [3, 1] } }, { 'yzzn-ja-dojo': { x: [1, 4] } }, null, NOW);
  check('道场计数：没有 base 时取大（首次同步不翻倍）', JSON.stringify(d6b.keys['yzzn-ja-dojo'].x) === '[3,4]');
  /* 7. 同一天两台设备的复习次数相加 */
  const s7 = mergeAll({ 'yzzn-en-stats': { '2026-10-01': 30 } }, { 'yzzn-en-stats': { '2026-10-01': 20 } }, { 'yzzn-en-stats': { '2026-10-01': 10 } }, NOW);
  check('今日复习：10 + 20 + 10 = 40', s7.keys['yzzn-en-stats']['2026-10-01'] === 40);
  const s7b = mergeAll({ 'yzzn-en-stats': { '2026-10-02': 3 } }, { 'yzzn-en-stats': { '2026-10-02': 4 } }, { 'yzzn-en-stats': {} }, NOW);
  check('base 之后才出现的新日期：两边相加', s7b.keys['yzzn-en-stats']['2026-10-02'] === 7);
  check('remoteUsed 记录参与合并的远端计数', s7.remoteUsed['yzzn-en-stats']['2026-10-01'] === 20);
  /* 8. 垃圾输入 */
  let threw = false;
  try { mergeAll({ a: 1 }, null, null, NOW); mergeAll(null, { 'yzzn-en-words': 'x', 'yzzn-en-stats': 'y' }, 'z', NOW); } catch (e) { threw = e; }
  check('远端为空 / 形状不对不抛异常', !threw, threw && threw.message);
  /* 9. 原型污染 */
  const evil = JSON.parse('{"yzzn-en-game":{"__proto__":{"polluted":1}},"yzzn-sync-meta":{"del":{"yzzn-en-words":{"__proto__":5}}}}');
  const m9 = mergeAll({ 'yzzn-en-game': {} }, evil, null, NOW);
  check('__proto__ 键不污染原型', ({}).polluted === undefined && Object.getPrototypeOf(m9.keys['yzzn-en-game']) === Object.prototype && m9.keys['yzzn-en-game'].polluted === undefined);
  /* 10. 字符串 / 类型不一致：本地优先 */
  check('类型不一致：本地优先', mergeAll({ 'yzzn-en-game': 'a' }, { 'yzzn-en-game': { x: 1 } }, null, NOW).keys['yzzn-en-game'] === 'a');
  /* 11. 英语大小写变体合并 */
  const m11 = mergeAll({ 'yzzn-en-words': [{ w: 'Apple', t: 1 }] }, { 'yzzn-en-words': [{ w: 'apple', t: 2 }] }, null, NOW);
  check('英语按小写去重', m11.keys['yzzn-en-words'].length === 1 && m11.keys['yzzn-en-words'][0].w === 'apple');
  /* 12. 顺序不同不算变化（不来回写） */
  const a12 = { 'yzzn-en-words': [{ w: 'a', mt: 1 }, { w: 'b', mt: 2 }], 'yzzn-en-game': { x: 1, y: 2 } };
  const b12 = { 'yzzn-en-words': [{ w: 'b', mt: 2 }, { w: 'a', mt: 1 }], 'yzzn-en-game': { y: 2, x: 1 } };
  check('词条 / 键顺序不同不算变化', changedNames(a12, b12).length === 0);
  const m12 = mergeAll(a12, b12, null, NOW);
  check('合并后两边都不需要再写', changedNames(a12, m12.keys).length === 0 && changedNames(b12, m12.keys).length === 0);
  /* 13. 平局确定性：两端算出同一个赢家 */
  const x = { w: 'q', def: 'one', mt: 5 }, y = { w: 'q', def: 'two', mt: 5 };
  const w1 = mergeEntries('yzzn-fr-words', [x], [y], null, 0, NOW)[0], w2 = mergeEntries('yzzn-fr-words', [y], [x], null, 0, NOW)[0];
  check('同一时间戳的冲突两端结果一致', w1 === w2 || JSON.stringify(w1) === JSON.stringify(w2));
  /* 14. 收敛性：随机操作的三台设备两两同步若干轮后完全一致 */
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const devs = [{}, {}, {}];
  let cloud = {}, clock = NOW;
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (let step = 0; step < 300; step++) {
    const d = devs[Math.floor(rnd() * 3)];
    clock += 1000;
    const words = (d['yzzn-de-words'] || []).slice();
    const w = pool[Math.floor(rnd() * pool.length)];
    const op = rnd();
    if (op < 0.4) { const i = words.findIndex((e) => e.w === w); const e = { w, rep: Math.floor(rnd() * 5), mt: clock }; if (i >= 0) words[i] = e; else words.push(e); }
    else if (op < 0.6) {
      const i = words.findIndex((e) => e.w === w);
      if (i >= 0) { words.splice(i, 1); const m = core.normMeta(d[META_KEY]); (m.del['yzzn-de-words'] = m.del['yzzn-de-words'] || {})[w] = clock; d[META_KEY] = m; }
    } else {
      const r = mergeAll(d, cloud, null, clock);
      Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, r.keys); cloud = r.keys;
      continue;
    }
    d['yzzn-de-words'] = words;
  }
  for (let round = 0; round < 2; round++) devs.forEach((d) => { const r = mergeAll(d, cloud, null, clock + 1); Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, r.keys); cloud = r.keys; });
  check('随机操作后三台设备收敛到同一状态', devs.every((d) => changedNames(d, cloud).length === 0));
  /* 15. 墓碑过期清理 */
  const old = mergeAll({ [META_KEY]: { del: { 'yzzn-en-words': { gone: NOW - 400 * DAY, fresh: NOW - DAY } }, wipe: {} } }, {}, null, NOW);
  check('180 天前的墓碑被清理', old.keys[META_KEY].del['yzzn-en-words'].gone === undefined && old.keys[META_KEY].del['yzzn-en-words'].fresh > 0);
  check('canonKey 对元数据做规范化', canonKey(META_KEY, undefined) === canonKey(META_KEY, { del: {}, wipe: {} }));
}

/* ================= B. langdata ================= */
class MemStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(String(k)); }
  clear() { this.m.clear(); }
}
const langdata = await import(new URL('langdata.js', SRC));
{
  const d = new Date(2026, 9, 2, 7, 30);   /* 北京时间 10 月 2 日 07:30 = UTC 10 月 1 日 23:30 */
  check('localDay 用本地日期（北京早上 7 点已是新的一天）', langdata.localDay(d) === '2026-10-02' && d.toISOString().slice(0, 10) === '2026-10-01');
  check('legacyAltDay：东八区的旧 UTC 键在前一天', langdata.legacyAltDay(d) === '2026-10-01');
  globalThis.localStorage = new MemStorage();
  langdata.noteDelete('yzzn-en-words', 'Apple', 1000);
  langdata.noteWipe(['yzzn-ja-words'], 2000);
  const m = JSON.parse(localStorage.getItem(META_KEY));
  check('noteDelete 记英语小写墓碑', m.del['yzzn-en-words'].apple === 1000, JSON.stringify(m));
  check('noteWipe 记清空时间', m.wipe['yzzn-ja-words'] === 2000);
}

/* ================= C. 数据 ================= */
{
  const pack = (f) => JSON.parse(fs.readFileSync(new URL('public/data/lang/' + f, ROOT), 'utf8')).words;
  const form = (e) => e[4] || (e[1] ? e[1] + ' ' + e[0] : e[0]);
  const fr = pack('fr-a1.json');
  const frBad = fr.filter((e) => /^(le|la)$/.test(e[1]) && /^(le|la) [aeiouyâàéèêëîïôûùh]/i.test(form(e)) && !/^(le|la) h(aricot|ibou|éros|asard|aut|onte|uit)/i.test(form(e)));
  check('法语：元音 / 哑音 h 前用 l\'', frBad.length === 0, frBad.map(form).join(' | '));
  check('法语：l\'homme / l\'eau / l\'heure', ['homme', 'eau', 'heure'].every((w) => form(fr.find((e) => e[0] === w)) === "l'" + w));
  const it = pack('it-a1.json');
  const itBad = it.filter((e) => /^(il|la)$/.test(e[1]) && (/^(il|la) [aeiouàèéìòù]/i.test(form(e)) || /^il (s[^aeiou]|z|gn|ps|x|y)/i.test(form(e))));
  check('意大利语：元音前 l\'，s+辅音前 lo', itBad.length === 0, itBad.map(form).join(' | '));
  check('意大利语：lo studente / l\'acqua / i soldi', form(it.find((e) => e[0] === 'studente')) === 'lo studente' &&
    form(it.find((e) => e[0] === 'acqua')) === "l'acqua" && form(it.find((e) => e[0] === 'soldi')) === 'i soldi');
  check('意大利语：词性列只用 il/la/空（竞技场判阴阳性）', it.every((e) => ['', 'il', 'la'].includes(e[1])));
  const es = pack('es-a1.json');
  const agua = es.find((e) => e[0] === 'agua');
  check('西语：agua 是阴性（竞技场答 la），展示 / 朗读为 el agua', agua[1] === 'la' && form(agua) === 'el agua');
  ['de-a1.json', 'ru-a1.json', 'ja-n5.json', 'ko-topik1.json', 'fr-a1.json', 'it-a1.json', 'es-a1.json'].forEach((f) => {
    const rows = pack(f);
    check(f + '：每行 4 或 5 列字符串', rows.every((e) => Array.isArray(e) && (e.length === 4 || e.length === 5) && e.every((x) => typeof x === 'string')));
  });
  const DOMAIN = /(^|；)(?:[a-z]+\.\s*)?\[(医|计|法|化|经|机|电|建)\]/;
  let rows = 0, dom = 0, maxSize = 0;
  ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'].forEach((lv) => {
    const file = new URL('public/data/en/levels/' + lv + '.json', ROOT);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    maxSize = Math.max(maxSize, fs.statSync(file).size);
    check(lv + '：n 与词数一致、按 rank 升序', j.n === j.words.length && j.words.every((e, i) => i === 0 || (e[3] || 1e9) >= (j.words[i - 1][3] || 1e9) || !e[3]));
    j.words.forEach((e) => { rows++; if (DOMAIN.test(e[2])) dom++; });
    if (lv === 'gk') check('gk：be 的释义不再是 [计] 后端', j.words.find((e) => e[0] === 'be')[2] === 'v. 是, 表示, 在');
  });
  check('考纲释义：带专业领域义项的行 < 0.5%（只剩唯一义项本身就是领域义项的词）', dom / rows < 0.005, dom + ' / ' + rows);
  check('考纲词库单文件 < 600 KB', maxSize < 600 * 1024, maxSize);
}

/* ================= D. 端到端：多设备 cloudsync ↔ sync-api ================= */
const SECRET = 'lang-test-secret';
const store = new Map();
const lag = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
globalThis.yzzn_kv = {
  async get(k) { await lag(); return store.has(k) ? store.get(k) : null; },
  async put(k, v) { await lag(); store.set(k, String(v)); },
  async delete(k) { await lag(); store.delete(k); },
  async list() { await lag(); return { complete: true, cursor: '', keys: [] }; },
};
const API = new URL('sync-api/edge-functions/', ROOT);
const lib = await import(new URL('_lib.js', API));
const H = {
  '/api/sync': await import(new URL('api/sync.js', API)),
  '/api/auth/login': await import(new URL('api/auth/login.js', API)),
  '/api/auth/register': await import(new URL('api/auth/register.js', API)),
  '/api/auth/logout': await import(new URL('api/auth/logout.js', API)),
  '/api/auth/delete': await import(new URL('api/auth/delete.js', API)),
  '/api/health': await import(new URL('api/health.js', API)),
};
const net = { log: [], beforePut: null, dropPutResponse: false, legacy: null };
globalThis.fetch = async (url, init) => {
  init = init || {};
  const u = new URL(url);
  const method = (init.method || 'GET').toUpperCase();
  net.log.push(method + ' ' + u.host + u.pathname);
  if (net.legacy) return net.legacy(u, method, init);
  if (method === 'PUT' && u.pathname === '/api/sync' && net.beforePut) { const f = net.beforePut; net.beforePut = null; await f(); }
  const request = new Request('https://sync.test' + u.pathname, { method, headers: init.headers, body: init.body });
  request.eo = { clientIp: '203.0.113.' + (1 + Math.floor(Math.random() * 250)) };
  const mod = H[u.pathname];
  const fn = mod && mod['onRequest' + method[0] + method.slice(1).toLowerCase()];
  if (!fn) return new Response('{}', { status: 404 });
  const res = await fn({ request, env: { AUTH_SECRET: SECRET }, waitUntil() {} });
  if (method === 'PUT' && net.dropPutResponse) { net.dropPutResponse = false; throw new TypeError('Failed to fetch'); }
  return res;
};
let confirmAnswers = [];
globalThis.confirm = () => (confirmAnswers.length ? confirmAnswers.shift() : true);

let devN = 0;
async function device(init) {
  const ls = new MemStorage();
  Object.entries(init || {}).forEach(([k, v]) => ls.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  globalThis.localStorage = ls;
  const mod = await import(new URL('cloudsync.js?dev=' + (++devN), SRC));
  const d = {
    ls, cs: mod.__test,
    use() { globalThis.localStorage = ls; lib.memReset(); return d; },
    get(k) { return JSON.parse(ls.getItem(k)); },
    set(k, v) { ls.setItem(k, JSON.stringify(v)); },
    async sync() { d.use(); return d.cs.fullSync({ silent: true }); },
    words(k) { return (d.get(k || 'yzzn-en-words') || []).map((e) => e.w).sort().join(','); },
  };
  return d;
}
const serverRec = (uid) => {
  const r = JSON.parse(store.get('u:' + uid + ':data'));
  const keys = r.z ? JSON.parse(zlib.gunzipSync(Buffer.from(r.z, 'base64')).toString('utf8')) : r.keys;
  return { rec: r, keys };
};
async function legacyToken(uid, uname) {
  const te = new TextEncoder();
  const payload = uid + '.' + uname + '.' + (Date.now() + 30 * 864e5);
  const key = await crypto.subtle.importKey('raw', te.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return lib.b64u(te.encode(payload)) + '.' + lib.b64u(await crypto.subtle.sign('HMAC', key, te.encode(payload)));
}
const enWord = (w, n, mt, extra) => ({ w, def: w + ' 释义', t: 1720000000000, srs: { ef: 2.5, n, i: n ? 6 : 0, d: mt + (n ? 6 * DAY : 6e5) }, ...(mt ? { mt } : {}), ...(extra || {}) });
const today = langdata.localDay();

/* D1. 旧版登录中的设备 + 旧格式云端整包 → 迁移到 v2，只留外语键 */
const pw = 'password123';
const h = await lib.hashPassword(pw);
const UID = '1111222233334444';
store.set('acct:zhang', JSON.stringify({ uid: UID, salt: h.salt, hash: h.hash, iter: h.iter, ts: 1 }));
store.set('u:' + UID + ':data', JSON.stringify({ ts: 1720000005000, keys: {
  'yzzn-en-words': [enWord('apple', 1, NOW - 3 * DAY), enWord('banana', 0, 0)],
  'yzzn-en-stats': { [today]: 12 },
  'yzzn-arc-mines': 60, 'yzzn-wx-live': { city: '北京' }, 'yzzn-xlr-history': [{ q: 1 }],
} }));
const A = await device({
  'yzzn-cloud': { token: await legacyToken(UID, 'zhang'), u: 'zhang', lastSync: 1 },
  'yzzn-en-words': [enWord('apple', 2, NOW - DAY), enWord('cherry', 0, 0)],
  'yzzn-en-stats': { [today]: 5 },
  'yzzn-en-cfg': { key: 'sk-secret-123', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat', voice: 'v' },
  'yzzn-arc-mines': 30,
});
{
  check('旧登录状态迁移：从令牌解出 uid，本机数据归属该账号', A.cs.getCloud().uid === UID && A.cs.getCloud().owner === UID);
  const r = await A.sync();
  check('A 首次同步成功', r.ok, JSON.stringify(r));
  const s = serverRec(UID);
  check('云端升级为 v2 压缩格式', s.rec.fmt === 2 && typeof s.rec.z === 'string' && typeof s.rec.v === 'string');
  check('云端只剩外语键：游戏厅 / 天气（含城市）/ 术数 / AI Key 全部不在', Object.keys(s.keys).every((k) => isSyncKey(k) || k === META_KEY) &&
    !JSON.stringify(s.keys).includes('sk-secret') && !JSON.stringify(s.keys).includes('北京'), Object.keys(s.keys).join(','));
  check('本机游戏厅成绩没被「取大」改坏', A.get('yzzn-arc-mines') === 30 && A.get('yzzn-wx-live') === null);
  check('词条并集 + 较新进度胜出', A.words() === 'apple,banana,cherry' && A.get('yzzn-en-words').find((e) => e.w === 'apple').srs.n === 2);
  check('首次同步计数取大（不翻倍）', A.get('yzzn-en-stats')[today] === 12);
  const again = await A.sync();
  const puts = net.log.filter((l) => l.startsWith('PUT')).length;
  await A.sync();
  check('没有变化时不再 PUT', again.ok && net.log.filter((l) => l.startsWith('PUT')).length === puts);
}

/* D2. 第二台设备登录：本机没有数据，直接拉下来；进度跨设备合并 */
const B = await device({});
{
  B.use();
  const r = await B.cs.auth('login', 'zhang', pw);
  check('B 登录并同步', r && r.ok && B.words() === 'apple,banana,cherry', B.words());
  check('B 拿到设备令牌', /\./.test(B.cs.getCloud().dev));
  /* A 复习 apple（认识）→ 同步 → B 同步 */
  A.use();
  const wa = A.get('yzzn-en-words');
  Object.assign(wa.find((e) => e.w === 'apple'), { srs: { ef: 2.6, n: 3, i: 16, d: Date.now() + 16 * DAY }, mt: Date.now() });
  A.set('yzzn-en-words', wa);
  await A.sync(); await B.sync();
  check('英语进度跨设备合并（bug 1）', B.get('yzzn-en-words').find((e) => e.w === 'apple').srs.n === 3);
  /* B 对 apple 选「忘了」→ 同步 → A 同步 */
  B.use();
  const wb = B.get('yzzn-en-words');
  Object.assign(wb.find((e) => e.w === 'apple'), { srs: { ef: 2.6, n: 0, i: 0, d: Date.now() + 6e5 }, mt: Date.now() + 1 });
  B.set('yzzn-en-words', wb);
  await B.sync(); await A.sync();
  check('「忘了」不被云端撤销（bug 2）', A.get('yzzn-en-words').find((e) => e.w === 'apple').srs.n === 0);
  /* A 删除 banana */
  A.use();
  A.set('yzzn-en-words', A.get('yzzn-en-words').filter((e) => e.w !== 'banana'));
  langdata.noteDelete('yzzn-en-words', 'banana');
  await A.sync(); await B.sync(); await A.sync();
  check('删除传播到其他设备且不复活（bug 3）', A.words() === 'apple,cherry' && B.words() === 'apple,cherry' && !serverRec(UID).keys['yzzn-en-words'].some((e) => e.w === 'banana'));
}

/* D3. 计数器：两台设备同一天各复习几次 → 相加 */
{
  A.use(); const sa = A.get('yzzn-en-stats'); sa[today] += 3; A.set('yzzn-en-stats', sa);
  B.use(); const sb = B.get('yzzn-en-stats'); sb[today] += 2; B.set('yzzn-en-stats', sb);
  await A.sync(); await B.sync(); await A.sync();
  check('同日计数相加：12 + 3 + 2 = 17', A.get('yzzn-en-stats')[today] === 17 && B.get('yzzn-en-stats')[today] === 17, A.get('yzzn-en-stats')[today] + '/' + B.get('yzzn-en-stats')[today]);
  /* 写入成功但响应丢失：下次同步不重复计数 */
  A.use(); const s2 = A.get('yzzn-en-stats'); s2[today] += 1; A.set('yzzn-en-stats', s2);
  net.dropPutResponse = true;
  const lost = await A.sync();
  check('PUT 响应丢失时报告失败', !lost.ok);
  B.use(); const s3 = B.get('yzzn-en-stats'); s3[today] += 1; B.set('yzzn-en-stats', s3);
  await A.sync(); await B.sync(); await A.sync();
  check('响应丢失后不重复计数：17 + 1 + 1 = 19', A.get('yzzn-en-stats')[today] === 19 && B.get('yzzn-en-stats')[today] === 19, A.get('yzzn-en-stats')[today] + '/' + B.get('yzzn-en-stats')[today]);
}

/* D4. 清空本语言：其他设备上更早的数据一并清掉，清空之后新加的保留 */
{
  A.use();
  A.set('yzzn-ja-words', [{ w: '私', r: 'わたし', rom: 'watashi', def: '我', due: NOW, iv: 0, ef: 2.5, rep: 0, mt: NOW - 5000 }]);
  A.set('yzzn-ja-dojo', { 'sei-h:あ': [3, 0] });
  A.set('yzzn-ja-game', { stars: { 0: 2 } });
  await A.sync(); await B.sync();
  check('日语数据同步到 B', B.words('yzzn-ja-words') === '私' && B.get('yzzn-ja-game').stars[0] === 2);
  A.use();
  langdata.noteWipe(['yzzn-ja-words', 'yzzn-ja-dojo', 'yzzn-ja-game', 'yzzn-ja-daily']);
  ['yzzn-ja-words', 'yzzn-ja-dojo', 'yzzn-ja-game', 'yzzn-ja-daily'].forEach((k) => localStorage.removeItem(k));
  await new Promise((r) => setTimeout(r, 5));
  B.use();
  B.set('yzzn-ja-words', B.get('yzzn-ja-words').concat([{ w: '猫', r: 'ねこ', rom: 'neko', def: '猫', due: Date.now(), iv: 0, ef: 2.5, rep: 0, mt: Date.now() }]));
  await A.sync(); await B.sync(); await A.sync();
  check('清空后旧词条 / 道场 / 星数不复活（bug 3）', B.words('yzzn-ja-words') === '猫' && !B.get('yzzn-ja-dojo') && !B.get('yzzn-ja-game'), B.words('yzzn-ja-words') + JSON.stringify(B.get('yzzn-ja-game')));
  check('清空之后另一台设备新加的词保留', A.words('yzzn-ja-words') === '猫');
}

/* D5. 并发写：A 的 PUT 之前云端刚被别的设备改过 → 409 → 重新合并 → 两边的改动都在 */
{
  A.use();
  A.set('yzzn-en-words', A.get('yzzn-en-words').concat([enWord('durian', 0, Date.now(), { mt: Date.now() })]));
  net.beforePut = async () => {
    const s = serverRec(UID);
    s.keys['yzzn-en-words'].push(enWord('elder', 0, Date.now(), { mt: Date.now() }));
    const z = zlib.gzipSync(JSON.stringify(s.keys)).toString('base64');
    const tok = (await (await fetch('https://x/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ u: 'zhang', p: pw }) })).json()).token;
    const r = await fetch('https://x/api/sync', { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: JSON.stringify({ fmt: 2, base: s.rec.v, v: 'other-dev', ts: Date.now(), z }) });
    if (r.status !== 200) throw new Error('inject failed ' + r.status);
  };
  const before = net.log.length;
  const r = await A.sync();
  const log = net.log.slice(before).filter((l) => /sync$/.test(l));
  check('冲突后自动重试成功（bug 6）', r.ok && log.filter((l) => l.startsWith('PUT')).length === 3, log.join(' | '));
  const keys = serverRec(UID).keys;
  check('两台设备的改动都保留', keys['yzzn-en-words'].some((e) => e.w === 'durian') && keys['yzzn-en-words'].some((e) => e.w === 'elder') && A.words().includes('elder'));
}

/* D6. 体积：3000 个考纲词能装下；超大时不上传、给出提示 */
{
  const lv = JSON.parse(fs.readFileSync(new URL('public/data/en/levels/cet6.json', ROOT), 'utf8')).words.slice(0, 3000);
  const C = await device({});
  C.use();
  await C.cs.auth('reg', 'bigbook', pw);
  C.set('yzzn-en-words', lv.map((e, i) => ({ w: e[0], def: e[2], t: NOW - i, ph: e[1], lv: 'cet6', srs: { ef: 2.5, n: 2, i: 6, d: NOW + i * 1000 }, mt: NOW - i * 7 })));
  const r = await C.sync();
  const rec = JSON.parse(store.get('u:' + C.cs.getCloud().uid + ':data'));
  const raw = Buffer.byteLength(C.ls.getItem('yzzn-en-words'));
  check('3000 词的生词本压缩后能同步', r.ok && rec.z.length < 300 * 1024, 'raw ' + raw + ' B → z ' + (rec.z && rec.z.length) + ' B');
  const junk = Array.from({ length: 6000 }, (_, i) => ({ w: 'w' + i, def: Array.from({ length: 120 }, () => String.fromCharCode(0x4e00 + Math.floor(Math.random() * 20000))).join(''), mt: NOW }));
  C.set('yzzn-en-words', junk);
  const before = store.get('u:' + C.cs.getCloud().uid + ':data');
  const r2 = await C.sync();
  check('超过上限：不上传、返回失败（页面显示提示）', !r2.ok && store.get('u:' + C.cs.getCloud().uid + ':data') === before);
}

/* D7. 旧服务端（GET 没有 v）：自动退回旧格式 {ts, keys}，且只含外语键 */
{
  const legacyStore = { ts: 5, keys: { 'yzzn-fr-words': [{ w: 'eau', r: 'la', mt: 1 }], 'yzzn-arc-x': 1 } };
  let putBody = null;
  net.legacy = async (u, method, init) => {
    if (u.pathname === '/api/sync' && method === 'GET') return new Response(JSON.stringify(legacyStore), { status: 200 });
    if (u.pathname === '/api/sync' && method === 'PUT') { putBody = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, ts: 9 }), { status: 200 }); }
    return new Response('{}', { status: 404 });
  };
  const D = await device({ 'yzzn-cloud': { token: 'x.y', u: 'old', uid: 'abcdefabcdefabcd', owner: 'abcdefabcdefabcd' }, 'yzzn-fr-words': [{ w: 'pain', r: 'le', mt: 2 }] });
  const r = await D.sync();
  net.legacy = null;
  check('旧服务端：发送旧格式', r.ok && putBody && putBody.fmt === undefined && putBody.keys && putBody.z === undefined);
  check('旧服务端：合并结果只含外语键', putBody && Object.keys(putBody.keys).every((k) => isSyncKey(k) || k === META_KEY) && D.words('yzzn-fr-words') === 'eau,pain');
}

/* D8. 换账号：本机数据属于另一个账号时先询问 */
{
  const E = await device({});
  E.use();
  await E.cs.auth('reg', 'other_user', pw);
  const otherUid = E.cs.getCloud().uid;
  E.set('yzzn-ko-words', [{ w: '나', mt: NOW }]);
  await E.sync();
  E.cs.logout();
  check('退出后保留数据并记住归属', E.cs.getCloud().token === '' && E.cs.getCloud().owner === otherUid && E.words('yzzn-ko-words') === '나');
  confirmAnswers = [false, false];
  const c1 = await E.cs.auth('login', 'zhang', pw);
  check('两次都取消：放弃登录，本机与云端都不变', c1.cancelled && !E.cs.getCloud().token && E.words('yzzn-ko-words') === '나' && !serverRec(UID).keys['yzzn-ko-words']);
  confirmAnswers = [false, true];
  const c2 = await E.cs.auth('login', 'zhang', pw);
  check('选择替换但备份下载失败：不替换也不登录', c2.cancelled && !E.cs.getCloud().token && E.words('yzzn-ko-words') === '나');
  confirmAnswers = [true];
  const c3 = await E.cs.auth('login', 'zhang', pw);
  check('确认合并：数据并入新账号，归属改为新账号', c3.ok && E.cs.getCloud().owner === UID && serverRec(UID).keys['yzzn-ko-words'].some((e) => e.w === '나'));
  const F = await device({ 'yzzn-de-words': [{ w: 'Haus', mt: NOW }] });
  F.use();
  confirmAnswers = [false];   /* 不应被询问：本机数据没有归属（未登录时产生） */
  const c4 = await F.cs.auth('login', 'zhang', pw);
  check('无归属的本机数据直接并入，不询问', c4.ok && confirmAnswers.length === 1 && F.words('yzzn-de-words') === 'Haus');
  confirmAnswers = [];
}

/* D9. 导出备份去掉 AI Key；接口地址覆盖只在 localhost 生效 */
{
  A.use();
  const ex = A.cs.collectExport();
  check('导出不含 AI Key，但保留其他设置与学习数据', ex['yzzn-en-cfg'] && ex['yzzn-en-cfg'].key === undefined && ex['yzzn-en-cfg'].model === 'deepseek-chat' && Array.isArray(ex['yzzn-en-words']) && !JSON.stringify(ex).includes('sk-secret'));
  check('导出只含外语数据', Object.keys(ex).every((k) => isSyncKey(k) || k === META_KEY || /-cfg$/.test(k)) && ex['yzzn-arc-mines'] === undefined);
  localStorage.setItem('yzzn-cloud-api', 'https://evil.example');
  globalThis.location = { hostname: 'aaronzhang3536.github.io' };
  let n = net.log.length;
  await A.sync();
  check('线上域名忽略 yzzn-cloud-api 覆盖', net.log.slice(n).every((l) => / yzzn-sync-lzgf3t47\.edgeone\.dev\//.test(l)), net.log.slice(n).join(' | '));
  globalThis.location = { hostname: 'localhost' };
  n = net.log.length;
  await A.sync();
  check('localhost 允许覆盖（开发测试用）', net.log.slice(n).some((l) => / evil\.example\//.test(l)));
  delete globalThis.location;
  localStorage.removeItem('yzzn-cloud-api');
}

/* D10. 合并后通知页面（不刷新）；令牌被吊销后干净地退回未登录 */
{
  globalThis.window = new EventTarget();
  let got = null;
  langdata.onSyncApplied((keys) => { got = keys; });
  B.use();
  B.set('yzzn-en-words', B.get('yzzn-en-words').concat([enWord('fig', 0, Date.now(), { mt: Date.now() })]));
  await B.sync();
  await A.sync();
  check('合并结果写回后派发 yzzn-sync-applied（页面就地重读）', Array.isArray(got) && got.includes('yzzn-en-words'), JSON.stringify(got));
  delete globalThis.window;
  B.use();
  const tok = B.cs.getCloud().token;
  await fetch('https://x/api/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: '{"all":true}' });
  const r = await A.sync();
  check('「退出全部设备」后其他设备：同步失败并退回未登录，数据与归属保留', !r.ok && A.cs.getCloud().token === '' && A.cs.getCloud().owner === UID && A.words().includes('fig'));
  A.use();
  confirmAnswers = [];
  const re = await A.cs.auth('login', 'zhang', pw);
  check('重新登录即可继续（同账号不询问）', re.ok);
}

console.log('lang.test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
