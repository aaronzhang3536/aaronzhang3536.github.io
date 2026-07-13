/* 注册：POST {u, p} → {token, u}
   KV: acct:<用户名小写> = {uid, salt, hash, iter, ts} */
import { json, preflight, kv, notReady, hashPassword, signToken, hex } from '../../_lib.js';

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  let body;
  try { body = await context.request.json(); } catch (e) { return json(context.request, 400, { error: 'bad_json' }); }
  const u = String(body.u || '').trim();
  const p = String(body.p || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) return json(context.request, 400, { error: 'bad_username', msg: '用户名需 3-20 位字母/数字/下划线' });
  if (p.length < 8 || p.length > 72) return json(context.request, 400, { error: 'bad_password', msg: '密码至少 8 位' });
  const key = 'acct:' + u.toLowerCase();
  const exist = await kv().get(key);
  if (exist) return json(context.request, 409, { error: 'user_exists', msg: '用户名已被注册' });
  const { salt, hash, iter } = await hashPassword(p);
  const uid = hex(crypto.getRandomValues(new Uint8Array(8)));
  await kv().put(key, JSON.stringify({ uid, salt, hash, iter, ts: Date.now() }));
  const token = await signToken(context, uid, u, 30);
  return json(context.request, 200, { token, u, uid });
}
