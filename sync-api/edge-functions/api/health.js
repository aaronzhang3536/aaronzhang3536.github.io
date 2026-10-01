/* 健康检查：报告 KV/密钥/WebCrypto 就绪状态（不泄露任何机密）
   不需要登录，所以不能有放大效应：WebCrypto 自检只做一次 SHA-256 + HMAC（不再每次跑 6 万轮 PBKDF2），
   结果连同 KV 探测在模块级缓存 60 秒。 */
import { json, preflight, kv, secret } from '../_lib.js';

let cache = null;   /* {at, kv, crypto} */
const TTL = 60e3;

async function probe() {
  let cryptoOk = false;
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('probe'));
    const k = await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const s = await crypto.subtle.sign('HMAC', k, new Uint8Array(d));
    const pk = await crypto.subtle.importKey('raw', new TextEncoder().encode('probe'), 'PBKDF2', false, ['deriveBits']);
    const b = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 1000 }, pk, 256);
    cryptoOk = d.byteLength === 32 && s.byteLength === 32 && b.byteLength === 32 && typeof crypto.getRandomValues === 'function';
  } catch (e) { cryptoOk = false; }
  let kvOk = false;
  try {
    if (kv()) { await kv().get('health_probe'); kvOk = true; }
  } catch (e) { kvOk = false; }
  return { at: Date.now(), kv: kvOk, crypto: cryptoOk };
}

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestGet(context) {
  if (!cache || Date.now() - cache.at > TTL) cache = await probe();
  return json(context.request, 200, {
    ok: cache.kv && !!secret(context) && cache.crypto,
    kv: cache.kv,
    secret: !!secret(context),
    crypto: cache.crypto,
    t: Date.now(),
  });
}
