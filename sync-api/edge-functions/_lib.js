/* 云同步 API 公共库：CORS / 响应 / PBKDF2 口令散列 / HMAC 会话令牌 / KV 访问
   部署为 EdgeOne Pages 独立项目（overseas 区，预设域名公开）。
   依赖控制台配置：KV 命名空间绑定为变量 yzzn_kv；环境变量 AUTH_SECRET。 */

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
export function json(request, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request) },
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

/* ---------- 编码 ---------- */
const te = new TextEncoder();
export function b64u(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function hex(buf) {
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- 口令散列（PBKDF2-SHA256）
   实测本运行时迭代上限 <12 万（"Param Invalid"），取 6 万（约 35ms）；
   验证时用账户里存的 iter，将来提额不破坏旧账户 ---------- */
const PBKDF2_ITER = 60000;
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
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- 会话令牌：payload = uid.uname.exp，HMAC-SHA256 签名 ---------- */
async function hmac(sec, msg) {
  const key = await crypto.subtle.importKey('raw', te.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, te.encode(msg)));
}
export async function signToken(context, uid, uname, days) {
  const exp = Date.now() + (days || 30) * 864e5;
  const payload = uid + '.' + uname + '.' + exp;
  return b64u(te.encode(payload)) + '.' + (await hmac(secret(context), payload));
}
export async function verifyToken(context) {
  const h = context.request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  let payload;
  try {
    payload = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
  } catch (e) { return null; }
  const sig = await hmac(secret(context), payload);
  if (!safeEqual(sig, parts[1])) return null;
  const seg = payload.split('.');
  if (seg.length !== 3) return null;
  const exp = parseInt(seg[2], 10);
  if (!exp || Date.now() > exp) return null;
  return { uid: seg[0], uname: seg[1], exp };
}

/* ---------- 简易频控：每用户每日写入上限（KV 读改写，近似即可） ---------- */
export async function rateLimit(uid, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const key = 'rl:' + uid + ':' + day;
  const n = parseInt((await kv().get(key)) || '0', 10);
  if (n >= limit) return false;
  await kv().put(key, String(n + 1));
  return true;
}
