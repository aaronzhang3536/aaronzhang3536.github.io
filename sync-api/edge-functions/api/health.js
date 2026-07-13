/* 健康检查：报告 KV/密钥/WebCrypto 就绪状态（不泄露任何机密） */
import { json, preflight, kv, secret, hashPassword } from '../_lib.js';

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestGet(context) {
  let cryptoOk = false;
  try {
    const h = await hashPassword('probe', '00112233445566778899aabbccddeeff');
    cryptoOk = h.hash.length === 64;
  } catch (e) { cryptoOk = false; }
  let kvOk = false;
  try {
    if (kv()) { await kv().get('health:probe'); kvOk = true; }
  } catch (e) { kvOk = false; }
  return json(context.request, 200, {
    ok: kvOk && !!secret(context) && cryptoOk,
    kv: kvOk,
    secret: !!secret(context),
    crypto: cryptoOk,
    t: Date.now(),
  });
}
