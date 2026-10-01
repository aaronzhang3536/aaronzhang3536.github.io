/* 云同步 API 公共库：CORS / 响应 / 请求体读取 / PBKDF2 口令散列 / HMAC 令牌 / 频控 / KV 访问
   部署为 EdgeOne Pages 独立项目（overseas 区，预设域名公开）。
   依赖控制台配置：KV 命名空间绑定为变量 yzzn_kv；环境变量 AUTH_SECRET。

   KV 布局（键名新增部分只用字母数字下划线，符合 EdgeOne KV 文档的键名约束；旧键保持原样以兼容存量数据）：
     acct:<小写用户名>   账户 {uid, salt, hash, iter, ts, tv?, u?}；tv = 令牌版本（缺省 0），「退出全部设备」时 +1
     u:<uid>:data        学习数据 {fmt?, v?, ts, keys | z, wd?, wn?}；wd/wn = 当日写入次数（频控，免额外键）
     lk_<小写用户名>     登录失败退避 {n, last, until}（仅真实存在的账户；登录成功即删除）
     rl_<范围>_<4hex>    按 IP 散列分桶的频控计数 {w, n}（桶数有上限、窗口写在值里，键不会无限增长）
     rl_reg_all          全站每日注册数 {w, n}
     rl:*                旧版频控键（无 TTL 的垃圾），登录成功时顺带分批清理
   EdgeOne KV 没有 TTL、没有原子读改写 / CAS，且边缘节点最多缓存 60 s（最终一致）：
   所以 KV 频控只是跨节点的近似值；同一 isolate 内的并发由模块级内存计数器精确兜底。 */

const ORIGINS = [
  'https://aaronzhang3536.github.io',
  'https://within-one-frame-f6egecj3.edgeone.cool',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

export function corsHeaders(request) {
  const o = request.headers.get('Origin') || '';
  return {
    'access-control-allow-origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}
export function json(request, status, obj, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request), ...(extra || {}) },
  });
}
export function preflight(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

export function kv() {
  /* eslint-disable no-undef */
  return typeof yzzn_kv !== 'undefined' ? yzzn_kv : null;
}
export function secret(context) {
  return (context.env && context.env.AUTH_SECRET) || '';
}
/* 未配置时给前端一个明确可展示的错误 */
export function notReady(context) {
  if (!kv()) return json(context.request, 503, { error: 'kv_not_bound', msg: '服务端未绑定 KV 命名空间' });
  if (!secret(context)) return json(context.request, 503, { error: 'no_secret', msg: '服务端未配置 AUTH_SECRET' });
  return null;
}

export const acctKey = (name) => 'acct:' + String(name).toLowerCase();
export const dataKey = (uid) => 'u:' + uid + ':data';
export const lockKey = (name) => 'lk_' + String(name).toLowerCase();
export const NAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const UID_RE = /^[0-9a-f]{16}$/;

/* ---------- 编码 ---------- */
const te = new TextEncoder();
export function b64u(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  return atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
}
export function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* ---------- 请求体：先看 Content-Length，再按字节流式读取，超限立即中止 ---------- */
export async function readBody(request, max) {
  const cl = parseInt(request.headers.get('content-length') || '', 10);
  if (cl > max) return { tooLarge: true, bytes: cl };
  if (request.body && typeof request.body.getReader === 'function') {
    const rd = request.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { try { await rd.cancel(); } catch (e) {} return { tooLarge: true, bytes: n }; }
      parts.push(value);
    }
    const all = new Uint8Array(n);
    let off = 0;
    parts.forEach((p) => { all.set(p, off); off += p.byteLength; });
    return { text: new TextDecoder().decode(all), bytes: n };
  }
  const text = await request.text();
  const bytes = te.encode(text).length;
  if (bytes > max) return { tooLarge: true, bytes };
  return { text, bytes };
}
export async function readJson(request, max) {
  const b = await readBody(request, max);
  if (b.tooLarge) return { error: 'too_large' };
  try {
    const v = JSON.parse(b.text);
    return isPlainObject(v) ? { body: v } : { error: 'bad_json' };
  } catch (e) { return { error: 'bad_json' }; }
}

/* ---------- 口令散列（PBKDF2-SHA256）
   实测本运行时迭代上限 <12 万（"Param Invalid"），取 6 万（约 35ms）；
   验证时用账户里存的 iter，将来提额不破坏旧账户 ---------- */
const PBKDF2_ITER = 60000;
export const MAX_PASSWORD = 72;
export async function hashPassword(password, saltHex, iter) {
  let salt;
  if (saltHex) {
    salt = new Uint8Array(saltHex.match(/.{2}/g).map((x) => parseInt(x, 16)));
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
  }
  const it = iter || PBKDF2_ITER;
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, key, 256);
  return { salt: hex(salt), hash: hex(bits), iter: it };
}
/* 用户不存在时也算一次同样成本的散列，消除「有没有这个用户」的时间差 */
const DUMMY_SALT = '5f1d3c0a9b7e42d68c0f1a2b3c4d5e6f';
export async function dummyHash(password) {
  try { await hashPassword(String(password || '').slice(0, MAX_PASSWORD) || 'x', DUMMY_SALT, PBKDF2_ITER); } catch (e) {}
}
export async function checkPassword(acct, password) {
  if (!acct || typeof acct.salt !== 'string' || typeof acct.hash !== 'string') return false;
  const { hash } = await hashPassword(password, acct.salt, acct.iter);
  return safeEqual(hash, acct.hash);
}
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- 令牌（HMAC-SHA256 签名，无状态）
   会话：payload = uid.uname.exp[.tv[.n]]（旧令牌没有 tv，按 0 处理，到期前继续有效；n = 注册时签发）
   设备：payload = dev.uid.exp.nonce —— 证明「这台设备登录成功过」，账户被锁时凭它仍可登录（防恶意锁号） */
async function hmac(sec, msg) {
  const key = await crypto.subtle.importKey('raw', te.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, te.encode(msg)));
}
async function signPayload(context, payload) {
  return b64u(te.encode(payload)) + '.' + (await hmac(secret(context), payload));
}
async function openPayload(context, token) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  let payload;
  try { payload = unb64u(parts[0]); } catch (e) { return null; }
  const sig = await hmac(secret(context), payload);
  return safeEqual(sig, parts[1]) ? payload : null;
}
export const TOKEN_DAYS = 30;
export async function signToken(context, uid, uname, tv, fresh) {
  const exp = Date.now() + TOKEN_DAYS * 864e5;
  return signPayload(context, uid + '.' + uname + '.' + exp + '.' + (tv || 0) + (fresh ? '.n' : ''));
}
export async function signDevice(context, uid) {
  const exp = Date.now() + 365 * 864e5;
  return signPayload(context, 'dev.' + uid + '.' + exp + '.' + hex(crypto.getRandomValues(new Uint8Array(6))));
}
export async function verifyDevice(context, token, uid) {
  const payload = await openPayload(context, token);
  if (!payload) return false;
  const seg = payload.split('.');
  return seg.length === 4 && seg[0] === 'dev' && seg[1] === uid && parseInt(seg[2], 10) > Date.now();
}
export async function readAccount(name) {
  const raw = await kv().get(acctKey(name));
  if (!raw) return null;
  try { const a = JSON.parse(raw); return isPlainObject(a) ? a : null; } catch (e) { return null; }
}
/* 校验会话令牌：签名 + 未过期 + 账户仍存在且 uid 一致 + 令牌版本一致（退出全部设备 / 注销后旧令牌失效） */
export async function verifyToken(context) {
  const h = context.request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const payload = await openPayload(context, m[1]);
  if (!payload) return null;
  const seg = payload.split('.');
  if (seg.length < 3 || seg.length > 5 || (seg.length === 5 && seg[4] !== 'n')) return null;
  const [uid, uname] = seg;
  const exp = parseInt(seg[2], 10);
  const tv = seg.length >= 4 ? parseInt(seg[3], 10) || 0 : 0;
  if (!UID_RE.test(uid) || !NAME_RE.test(uname)) return null;
  if (!exp || Date.now() > exp) return null;
  const acct = await readAccount(uname);
  if (!acct) {
    /* 刚注册的账户可能还没传到这个边缘节点（KV 节点缓存最长 60 s）：注册时签发、2 分钟内的令牌暂且放行 */
    if (seg[4] === 'n' && Date.now() - (exp - TOKEN_DAYS * 864e5) < 120e3) return { uid, uname, exp, tv, acct: null };
    return null;
  }
  if (acct.uid !== uid || (acct.tv || 0) !== tv) return null;
  return { uid, uname, exp, tv, acct };
}

/* ---------- 频控 ---------- */
/* 模块级内存计数：同步「检查 + 计数」之间没有 await，同一 isolate 内的并发请求不会一起穿过去 */
const MEM = new Map();
export function memHit(key, limit, windowMs, now) {
  now = now || Date.now();
  const w = Math.floor(now / windowMs) * windowMs;
  let e = MEM.get(key);
  if (!e || e.w !== w) {
    e = { w, n: 0 };
    MEM.set(key, e);
    if (MEM.size > 20000) MEM.forEach((v, k) => { if (now - v.w > 864e5) MEM.delete(k); });
  }
  if (e.n >= limit) return false;
  e.n++;
  return true;
}
export function memReset() { MEM.clear(); }
/* KV 计数（跨 isolate，近似）：值里带窗口起点，窗口过了自动重置，键数量有上限 */
export async function kvHit(key, limit, windowMs, now) {
  now = now || Date.now();
  const w = Math.floor(now / windowMs) * windowMs;
  let st = null;
  try { st = JSON.parse((await kv().get(key)) || 'null'); } catch (e) { st = null; }
  if (!isPlainObject(st) || st.w !== w || typeof st.n !== 'number') st = { w, n: 0 };
  if (st.n >= limit) return false;
  st.n++;
  await kv().put(key, JSON.stringify(st));
  return true;
}
/* 客户端 IP：只信平台注入的 request.eo.clientIp（及平台头），不信客户端可伪造的 X-Forwarded-For */
export function clientIp(request) {
  const eo = request.eo;
  const ip = (eo && eo.clientIp) || request.headers.get('eo-client-ip') || '';
  return String(ip).slice(0, 64);
}
/* IP → 分桶键（SHA-256(密钥 + IP) 取 16 bit；不存原始 IP） */
export async function ipBucket(context, scope, ip) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(secret(context) + '|' + ip)));
  return 'rl_' + scope + '_' + hex(d.slice(0, 2));
}
export const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;

/* ---------- 登录失败退避（按账户；存在独立键 lk_<name>，不回写 acct 记录以免与令牌版本冲突） ---------- */
const FREE_FAILS = 5, MAX_LOCK = 15 * MIN;
export async function readLock(name) {
  try {
    const st = JSON.parse((await kv().get(lockKey(name))) || 'null');
    if (!isPlainObject(st)) return null;
    if (Date.now() - (st.last || 0) > DAY) return null;   /* 一天没再失败：清零 */
    return st;
  } catch (e) { return null; }
}
export function lockedFor(st) {
  return st && st.until > Date.now() ? Math.ceil((st.until - Date.now()) / 1000) : 0;
}
export async function noteFailure(name, st) {
  const now = Date.now();
  const n = ((st && st.n) || 0) + 1;
  const until = n >= FREE_FAILS ? now + Math.min(MAX_LOCK, 30e3 * Math.pow(2, n - FREE_FAILS)) : 0;
  await kv().put(lockKey(name), JSON.stringify({ n, last: now, until }));
  return until;
}
export async function clearLock(name, st) {
  if (st) { try { await kv().delete(lockKey(name)); } catch (e) {} }
}
export function lockedResponse(request, secs) {
  return json(request, 429, {
    error: 'locked', retry: secs,
    msg: '这个账号密码错误次数过多，已临时锁定，请 ' + Math.max(1, Math.ceil(secs / 60)) + ' 分钟后再试（以前在本设备登录过的不受影响）',
  }, { 'retry-after': String(secs) });
}

/* ---------- 旧版 rl:* 频控键（永不过期）分批清理 ---------- */
export async function sweepLegacy() {
  try {
    if (typeof kv().list !== 'function') return 0;
    const r = await kv().list({ prefix: 'rl:', limit: 50 });
    const keys = ((r && r.keys) || []).map((k) => (typeof k === 'string' ? k : k && (k.key || k.name))).filter((k) => typeof k === 'string' && k.startsWith('rl:'));
    for (const k of keys) { try { await kv().delete(k); } catch (e) {} }
    return keys.length;
  } catch (e) { return 0; }
}
export function background(context, p) {
  if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
  else p.catch(() => {});
}
