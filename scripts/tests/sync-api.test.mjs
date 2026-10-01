/* 云同步服务端（sync-api/edge-functions）回归测试：零依赖，`node scripts/tests/sync-api.test.mjs`。
   用带随机延迟的内存 KV 模拟 EdgeOne KV（异步、无原子操作），直接调用各边缘函数的 onRequest* 处理器。
   覆盖：存量账户 / 旧令牌兼容、登录防爆破（IP 限次、账户退避、设备令牌防恶意锁号、并发）、用户名枚举、
   注册限流与同名竞争、令牌吊销与注销、同步版本冲突 / 旧客户端 / 体积与形状校验、health 不放大、旧 rl: 键清理。 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const SECRET = 'test-secret-0123456789';
const ROOT = new URL('../../sync-api/edge-functions/', import.meta.url);

/* ---------- 带延迟的内存 KV ---------- */
const store = new Map();
const lag = () => new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 4)));
let kvWrites = 0;
globalThis.yzzn_kv = {
  async get(k) { await lag(); return store.has(k) ? store.get(k) : null; },
  async put(k, v) { await lag(); kvWrites++; store.set(k, String(v)); },
  async delete(k) { await lag(); store.delete(k); },
  async list(o) {
    await lag();
    const keys = [...store.keys()].filter((k) => !o || !o.prefix || k.startsWith(o.prefix)).sort().slice(0, (o && o.limit) || 256);
    return { complete: true, cursor: '', keys: keys.map((key) => ({ key })) };
  },
};

const lib = await import(new URL('_lib.js', ROOT));
const health = await import(new URL('api/health.js', ROOT));
const sync = await import(new URL('api/sync.js', ROOT));
const login = await import(new URL('api/auth/login.js', ROOT));
const register = await import(new URL('api/auth/register.js', ROOT));
const logout = await import(new URL('api/auth/logout.js', ROOT));
const del = await import(new URL('api/auth/delete.js', ROOT));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (detail !== undefined ? '  ' + detail : ''));
}

/* ---------- 请求构造 ---------- */
let curIp = '203.0.113.7';
function ctx(method, path, { body, token, ip, headers } = {}) {
  const h = { origin: 'https://aaronzhang3536.github.io', ...(headers || {}) };
  if (token) h.authorization = 'Bearer ' + token;
  if (body !== undefined) h['content-type'] = 'application/json';
  const request = new Request('https://sync.test' + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  request.eo = { clientIp: ip || curIp };
  const bg = [];
  return { request, env: { AUTH_SECRET: SECRET }, waitUntil: (p) => bg.push(p), bg };
}
async function call(fn, method, path, opt) {
  const c = ctx(method, path, opt);
  const r = await fn(c);
  let j = null;
  try { j = await r.json(); } catch (e) {}
  await Promise.all(c.bg);
  return { status: r.status, body: j, headers: r.headers };
}
const post = (mod, path, body, opt) => call(mod.onRequestPost, 'POST', path, { ...(opt || {}), body });
const doLogin = (u, p, opt) => post(login, '/api/auth/login', { u, p, ...(opt && opt.dev ? { dev: opt.dev } : {}) }, opt);
const doReg = (u, p, opt) => post(register, '/api/auth/register', { u, p }, opt);
const getSync = (token) => call(sync.onRequestGet, 'GET', '/api/sync', { token });
const putSync = (token, body, opt) => call(sync.onRequestPut, 'PUT', '/api/sync', { ...(opt || {}), token, body });
const ctxOnly = () => ({ env: { AUTH_SECRET: SECRET } });

/* 旧版令牌格式：payload = uid.uname.exp（没有 tv） */
async function legacyToken(uid, uname) {
  const te = new TextEncoder();
  const payload = uid + '.' + uname + '.' + (Date.now() + 30 * 864e5);
  const key = await crypto.subtle.importKey('raw', te.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return lib.b64u(te.encode(payload)) + '.' + lib.b64u(await crypto.subtle.sign('HMAC', key, te.encode(payload)));
}
const reset = () => { store.clear(); lib.memReset(); };

/* ================= 1. 存量账户与旧令牌 ================= */
reset();
{
  const h = await lib.hashPassword('oldpassword1');
  /* 旧版注册写入的账户记录：没有 tv / u 字段 */
  store.set('acct:alice', JSON.stringify({ uid: '0123456789abcdef', salt: h.salt, hash: h.hash, iter: h.iter, ts: 1720000000000 }));
  store.set('u:0123456789abcdef:data', JSON.stringify({ ts: 1720000001000, keys: { 'yzzn-en-words': [{ w: 'apple', def: '苹果', t: 1 }], 'yzzn-arc-mines': 30 } }));
  const r = await doLogin('Alice', 'oldpassword1');
  check('存量账户可登录（大小写不敏感）', r.status === 200 && r.body.uid === '0123456789abcdef' && r.body.token && r.body.dev, JSON.stringify(r.body));
  const old = await legacyToken('0123456789abcdef', 'alice');
  const g = await getSync(old);
  check('旧格式令牌（3 段）继续有效', g.status === 200 && g.body.keys && Array.isArray(g.body.keys['yzzn-en-words']), g.status);
  check('旧记录 GET 带版本号 L<ts>，无 fmt', g.body.v === 'L1720000001000' && g.body.fmt === undefined, JSON.stringify(g.body).slice(0, 80));
  check('ETag 头', g.headers.get('etag') === '"L1720000001000"');
  const g2 = await getSync(r.body.token);
  check('新令牌（4 段）有效', g2.status === 200);
  const forged = lib.b64u(new TextEncoder().encode('0123456789abcdef.alice.' + (Date.now() + 1e12) + '.0')) + '.' + r.body.token.split('.')[1];
  check('篡改 payload 的令牌被拒', (await getSync(forged)).status === 401);
  const asDev = await getSync(r.body.dev);
  check('设备令牌不能当会话令牌', asDev.status === 401);
}

/* ================= 2. 用户名枚举 / 不存在用户不写键 ================= */
reset();
{
  const h = await lib.hashPassword('rightpass1');
  store.set('acct:bob', JSON.stringify({ uid: 'aaaaaaaaaaaaaaaa', salt: h.salt, hash: h.hash, iter: h.iter, ts: 1 }));
  const time = async (u) => { const t = performance.now(); const r = await doLogin(u, 'wrongpass9'); return [performance.now() - t, r.status]; };
  await time('bob'); await time('nobody_x');   /* 预热 */
  lib.memReset();
  const tb = [], tn = [];
  for (let i = 0; i < 4; i++) { tb.push((await time('bob'))[0]); tn.push((await time('nobody_' + i))[0]); lib.memReset(); }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mb = med(tb), mn = med(tn);
  check('不存在的用户也跑同成本散列（耗时差 < 50%）', mn > mb * 0.5 && mn < mb * 1.5, 'exist ' + mb.toFixed(1) + 'ms vs missing ' + mn.toFixed(1) + 'ms');
  const keys = [...store.keys()];
  check('不存在的用户名不留下任何键', !keys.some((k) => /nobody/.test(k)), keys.join(','));
  check('新键名只含字母数字下划线（旧前缀 acct:/u: 除外）', keys.every((k) => /^(acct:|u:)/.test(k) || /^[A-Za-z0-9_]+$/.test(k)), keys.join(','));
  const r = await doLogin('nobody', 'x'.repeat(100));
  check('超过 72 位的密码直接拒绝', r.status === 401, r.status);
  const r2 = await post(login, '/api/auth/login', '{"u":"bob","p":' + JSON.stringify('y'.repeat(9000)) + '}');
  check('超大登录请求体 400', r2.status === 400, r2.status);
}

/* ================= 3. 登录防爆破：IP 限次 / 账户退避 / 设备令牌 / 并发 ================= */
reset();
{
  const h = await lib.hashPassword('victimpass1');
  store.set('acct:victim', JSON.stringify({ uid: 'bbbbbbbbbbbbbbbb', salt: h.salt, hash: h.hash, iter: h.iter, ts: 1 }));
  /* 受害者先在自己的设备上登录，拿到设备令牌 */
  const first = await doLogin('victim', 'victimpass1', { ip: '198.51.100.1' });
  const devTok = first.body.dev;
  lib.memReset();
  /* 攻击者：同一 IP 并发 100 次 */
  const res = await Promise.all(Array.from({ length: 100 }, () => doLogin('victim', 'guess' + Math.random(), { ip: '192.0.2.66' })));
  const st = res.map((r) => r.status);
  const n401 = st.filter((s) => s === 401).length, n429 = st.filter((s) => s === 429).length;
  check('并发 100 次只有限额内的请求真正校验密码', n401 <= 20 && n401 + n429 === 100, '401=' + n401 + ' 429=' + n429);
  const lk = JSON.parse(store.get('lk_victim') || 'null');
  check('失败记录在 lk_victim（不回写 acct 记录）', lk && lk.n >= 1 && JSON.parse(store.get('acct:victim')).tv === undefined, JSON.stringify(lk));
  /* 换 IP 继续猜：账户被锁 */
  lib.memReset();
  store.set('lk_victim', JSON.stringify({ n: 5, last: Date.now(), until: Date.now() + 60e3 }));
  const locked = await doLogin('victim', 'victimpass1', { ip: '192.0.2.99' });
  check('账户锁定期间（无设备令牌）拒绝，即使密码正确', locked.status === 429 && locked.body.error === 'locked' && locked.body.retry > 0, JSON.stringify(locked.body));
  const owner = await doLogin('victim', 'victimpass1', { ip: '198.51.100.1', dev: devTok });
  check('持设备令牌的主人不受锁影响（防恶意锁号）', owner.status === 200, JSON.stringify(owner.body));
  check('登录成功后清除失败记录', !store.has('lk_victim'));
  const otherDev = await (async () => { store.set('acct:mallory', JSON.stringify({ uid: 'cccccccccccccccc', salt: h.salt, hash: h.hash, iter: h.iter, ts: 1 })); const r = await doLogin('mallory', 'victimpass1'); return r.body.dev; })();
  store.set('lk_victim', JSON.stringify({ n: 6, last: Date.now(), until: Date.now() + 60e3 }));
  const wrongDev = await doLogin('victim', 'victimpass1', { ip: '198.51.100.2', dev: otherDev });
  check('别的账户的设备令牌不能绕过锁', wrongDev.status === 429, wrongDev.status);
  /* 退避递增 */
  lib.memReset(); store.delete('lk_victim');
  for (let i = 0; i < 5; i++) await doLogin('victim', 'nope' + i, { ip: '192.0.2.' + (10 + i) });
  const l5 = JSON.parse(store.get('lk_victim'));
  check('连续 5 次失败后开始锁定（30 s 起）', l5.n === 5 && l5.until - l5.last >= 29e3 && l5.until - l5.last <= 31e3, JSON.stringify(l5));
  /* IP 限次：同一 IP 21 次 */
  lib.memReset(); store.delete('lk_victim');
  let last = null;
  for (let i = 0; i < 21; i++) last = await doLogin('nobody' + i, 'whatever1', { ip: '192.0.2.200' });
  check('单 IP 10 分钟超过 20 次 → 429', last.status === 429, last.status);
  const bucketKeys = [...store.keys()].filter((k) => k.startsWith('rl_login_'));
  check('IP 计数按散列分桶存储，不含原始 IP', bucketKeys.length >= 1 && bucketKeys.every((k) => /^rl_login_[0-9a-f]{4}$/.test(k)), bucketKeys.join(','));
}

/* ================= 4. 注册：限流 / 同名竞争 / 409 ================= */
reset();
{
  const ok = await doReg('Carol_1', 'password123', { ip: '203.0.113.50' });
  check('注册成功返回 token/uid/dev', ok.status === 200 && /^[0-9a-f]{16}$/.test(ok.body.uid) && ok.body.token && ok.body.dev);
  const acct = JSON.parse(store.get('acct:carol_1'));
  check('新账户记录含 tv=0 与原始用户名', acct.tv === 0 && acct.u === 'Carol_1');
  const dup = await doReg('carol_1', 'password123', { ip: '203.0.113.51' });
  check('重名 409', dup.status === 409 && dup.body.error === 'user_exists');
  check('密码太短 400', (await doReg('dave', 'short', { ip: '203.0.113.52' })).status === 400);
  check('用户名非法 400', (await doReg('a!', 'password123', { ip: '203.0.113.52' })).status === 400);
  lib.memReset();
  const race = await Promise.all(Array.from({ length: 8 }, () => doReg('racer', 'password123', { ip: '203.0.113.' + Math.floor(Math.random() * 200) })));
  const wins = race.filter((r) => r.status === 200);
  check('并发同名注册只有一个成功', wins.length === 1, race.map((r) => r.status).join(','));
  const stored = JSON.parse(store.get('acct:racer'));
  check('成功者的 uid 就是存下的 uid', wins.length === 1 && stored.uid === wins[0].body.uid);
  lib.memReset();
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await doReg('spam' + i, 'password123', { ip: '198.18.0.1' })).status);
  check('单 IP 每小时注册 5 次后 429', statuses.slice(0, 5).every((s) => s === 200) && statuses[5] === 429, statuses.join(','));
  lib.memReset();
  store.set('rl_reg_all', JSON.stringify({ w: Math.floor(Date.now() / 864e5) * 864e5, n: 300 }));
  const full = await doReg('lateuser', 'password123', { ip: '198.18.0.9' });
  check('全站每日注册上限', full.status === 429 && !store.has('acct:lateuser'), full.status);
}

/* ================= 5. 同步：版本冲突 / 旧客户端 / 体积 / 形状 ================= */
reset();
{
  const reg = await doReg('syncer', 'password123');
  const tok = reg.body.token;
  const g0 = await getSync(tok);
  check('无数据时 GET {fmt:2, v:"0", keys:{}}', g0.status === 200 && g0.body.fmt === 2 && g0.body.v === '0' && g0.body.keys && !Object.keys(g0.body.keys).length);
  const p1 = await putSync(tok, { fmt: 2, base: '0', v: 'ver-1', ts: 1, z: 'H4sIAAAAAAAAA6uuBQBDv6ajAgAAAA==' });
  check('PUT v2 base 匹配 → 200，采用客户端提议的版本号', p1.status === 200 && p1.body.v === 'ver-1', JSON.stringify(p1.body));
  const g1 = await getSync(tok);
  check('GET 返回压缩数据 z 与版本', g1.body.fmt === 2 && g1.body.v === 'ver-1' && typeof g1.body.z === 'string' && g1.body.keys === undefined);
  check('内部计数字段不外泄', g1.body.wd === undefined && g1.body.wn === undefined);
  const stale = await putSync(tok, { fmt: 2, base: '0', v: 'ver-x', ts: 2, keys: {} });
  check('base 过期 → 409 conflict 并给出当前版本', stale.status === 409 && stale.body.error === 'conflict' && stale.body.v === 'ver-1');
  const oldc = await putSync(tok, { ts: 3, keys: { 'yzzn-en-words': [] } });
  check('旧客户端写 v2 记录 → 409 client_outdated，数据不被覆盖', oldc.status === 409 && oldc.body.error === 'client_outdated' && JSON.parse(store.get('u:' + reg.body.uid + ':data')).v === 'ver-1');
  check('v2 缺 base → 400', (await putSync(tok, { fmt: 2, keys: {} })).status === 400);
  check('keys:null → 400', (await putSync(tok, { ts: 1, keys: null })).status === 400);
  check('keys 为数组 → 400', (await putSync(tok, { fmt: 2, base: 'ver-1', keys: [] })).status === 400);
  check('keys 为字符串 → 400', (await putSync(tok, { fmt: 2, base: 'ver-1', keys: 'xx' })).status === 400);
  check('z 非 base64 → 400', (await putSync(tok, { fmt: 2, base: 'ver-1', z: '<script>' })).status === 400);
  check('非法 JSON → 400', (await putSync(tok, '{oops')).status === 400);
  const cjk = JSON.stringify({ fmt: 2, base: 'ver-1', keys: { 'yzzn-en-words': '汉'.repeat(200 * 1024) } });
  const big = await putSync(tok, cjk);
  check('按字节计：约 600 KB 的中文（20 万字符）→ 413', cjk.length < 512 * 1024 && big.status === 413 && big.body.limit === 512 * 1024, cjk.length + ' chars → ' + big.status);
  const lie = await call(sync.onRequestPut, 'PUT', '/api/sync', { token: tok, body: '{}', headers: { 'content-length': String(10 * 1024 * 1024) } });
  check('Content-Length 超限直接 413', lie.status === 413);
  /* 每日写入上限（计数存在记录里，不额外占键） */
  const rec = JSON.parse(store.get('u:' + reg.body.uid + ':data'));
  rec.wd = new Date().toISOString().slice(0, 10); rec.wn = 400;
  store.set('u:' + reg.body.uid + ':data', JSON.stringify(rec));
  check('每日 400 次写入上限', (await putSync(tok, { fmt: 2, base: 'ver-1', keys: {} })).status === 429);
  check('同步不再写 rl: 键', ![...store.keys()].some((k) => k.startsWith('rl:')));
  /* 旧客户端 + 旧记录：照旧覆盖 */
  const reg2 = await doReg('legacyuser', 'password123', { ip: '203.0.113.90' });
  store.set('u:' + reg2.body.uid + ':data', JSON.stringify({ ts: 5, keys: { a: 1 } }));
  const lp = await putSync(reg2.body.token, { ts: 6, keys: { 'yzzn-en-words': [{ w: 'x' }] } });
  const lrec = JSON.parse(store.get('u:' + reg2.body.uid + ':data'));
  check('旧客户端写旧记录照旧成功（无 fmt）', lp.status === 200 && lrec.fmt === undefined && lrec.keys['yzzn-en-words'][0].w === 'x');
  /* 并发写：同一 base 两个写者，只有一个成功 */
  lib.memReset();
  const cur = (await getSync(reg2.body.token)).body.v;
  const both = await Promise.all([
    putSync(reg2.body.token, { fmt: 2, base: cur, v: 'A1', keys: { k: 'A' } }),
    putSync(reg2.body.token, { fmt: 2, base: cur, v: 'B1', keys: { k: 'B' } }),
  ]);
  const okN = both.filter((r) => r.status === 200).length;
  check('同一 base 并发两次写入：恰好一个成功，另一个 409', okN === 1 && both.some((r) => r.status === 409), both.map((r) => r.status).join(','));
}

/* ================= 6. 令牌吊销：退出全部设备 / 注销账号 ================= */
reset();
{
  const reg = await doReg('erin', 'password123');
  const t1 = reg.body.token;
  const t2 = (await doLogin('erin', 'password123')).body.token;
  const leg = await legacyToken(reg.body.uid, 'erin');
  check('吊销前三个令牌都有效', (await getSync(t1)).status === 200 && (await getSync(t2)).status === 200 && (await getSync(leg)).status === 200);
  const lo = await post(logout, '/api/auth/logout', { all: false }, { token: t1 });
  check('普通退出不影响令牌（无状态）', lo.status === 200 && (await getSync(t1)).status === 200);
  const la = await post(logout, '/api/auth/logout', { all: true }, { token: t1 });
  check('退出全部设备 → 200', la.status === 200 && la.body.all === true && JSON.parse(store.get('acct:erin')).tv === 1);
  check('之后所有旧令牌 401（含旧格式）', (await getSync(t1)).status === 401 && (await getSync(t2)).status === 401 && (await getSync(leg)).status === 401);
  const t3 = (await doLogin('erin', 'password123')).body.token;
  check('重新登录拿到新版本令牌', (await getSync(t3)).status === 200);
  await putSync(t3, { fmt: 2, base: '0', keys: { a: 1 } });
  const wrong = await post(del, '/api/auth/delete', { p: 'not-my-pass' }, { token: t3 });
  check('注销时密码错误 → 403（不是 401，客户端不会误判为登录失效）', wrong.status === 403);
  const ok = await post(del, '/api/auth/delete', { p: 'password123' }, { token: t3 });
  check('注销成功，账户与数据删除', ok.status === 200 && !store.has('acct:erin') && !store.has('u:' + reg.body.uid + ':data'));
  check('注销后令牌 401', (await getSync(t3)).status === 401);
  const again = await doReg('erin', 'password123', { ip: '203.0.113.77' });
  check('注销后用户名可重新注册（新 uid），旧令牌不会串到新账户', again.status === 200 && again.body.uid !== reg.body.uid && (await getSync(t3)).status === 401);
}

/* ================= 6b. 刚注册、账户记录还没传到别的边缘节点（KV 最终一致）================= */
reset();
{
  const reg = await doReg('fresh_user', 'password123');
  const loginTok = (await doLogin('fresh_user', 'password123')).body.token;
  const saved = store.get('acct:fresh_user');
  store.delete('acct:fresh_user');   /* 模拟另一个节点还读不到新账户 */
  check('注册时签发的令牌在 2 分钟内放行（避免刚注册就被判登录失效）', (await getSync(reg.body.token)).status === 200);
  check('登录令牌不享受宽限（账户不存在即 401）', (await getSync(loginTok)).status === 401);
  const te = new TextEncoder();
  const stale = reg.body.uid + '.fresh_user.' + (Date.now() + 30 * 864e5 - 300e3) + '.0.n';
  const key = await crypto.subtle.importKey('raw', te.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const staleTok = lib.b64u(te.encode(stale)) + '.' + lib.b64u(await crypto.subtle.sign('HMAC', key, te.encode(stale)));
  check('注册令牌超过 2 分钟后不再宽限', (await getSync(staleTok)).status === 401);
  const lo = await post(logout, '/api/auth/logout', { all: true }, { token: reg.body.token });
  check('宽限期内「退出全部设备」返回 409 稍后再试', lo.status === 409);
  store.set('acct:fresh_user', saved);
}

/* ================= 7. health：无放大 / 缓存 ================= */
reset();
{
  const c = { request: new Request('https://sync.test/api/health'), env: { AUTH_SECRET: SECRET } };
  const r = await health.onRequestGet(c);
  const j = await r.json();
  check('health 字段兼容旧前端 {ok, kv, secret, crypto}', j.ok === true && j.kv === true && j.secret === true && j.crypto === true, JSON.stringify(j));
  const t = performance.now();
  for (let i = 0; i < 200; i++) await health.onRequestGet(c);
  const ms = performance.now() - t;
  check('200 次 health 很便宜（不再每次跑 6 万轮 PBKDF2）', ms < 400, ms.toFixed(0) + 'ms');
  const nos = await health.onRequestGet({ request: c.request, env: {} });
  check('未配置密钥时 ok=false', (await nos.json()).ok === false);
}

/* ================= 8. 旧 rl: 垃圾键清理 / 未配置 ================= */
reset();
{
  for (let i = 0; i < 30; i++) store.set('rl:login:user' + i + ':2026-07-1' + (i % 10), '3');
  store.set('rl:0123456789abcdef:2026-07-20', '9');
  const n = await lib.sweepLegacy();
  check('sweepLegacy 删除旧 rl: 键', n === 31 && ![...store.keys()].some((k) => k.startsWith('rl:')), n);
  const saved = globalThis.yzzn_kv;
  delete globalThis.yzzn_kv;
  const nr = await doLogin('x_user', 'password123');
  check('KV 未绑定 → 503 kv_not_bound', nr.status === 503 && nr.body.error === 'kv_not_bound');
  globalThis.yzzn_kv = saved;
  const ns = await call(login.onRequestPost, 'POST', '/api/auth/login', { body: { u: 'x', p: 'y' } });
  check('CORS 头随响应返回', ns.headers.get('access-control-allow-origin') === 'https://aaronzhang3536.github.io');
}

console.log('sync-api.test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
