/* 登录：POST {u, p} → {token, u} */
import { json, preflight, kv, notReady, hashPassword, safeEqual, signToken, rateLimit } from '../../_lib.js';

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  let body;
  try { body = await context.request.json(); } catch (e) { return json(context.request, 400, { error: 'bad_json' }); }
  const u = String(body.u || '').trim();
  const p = String(body.p || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) return json(context.request, 401, { error: 'bad_credentials', msg: '用户名或密码错误' });
  /* 防爆破：每用户名每日 30 次尝试 */
  if (!(await rateLimit('login:' + u.toLowerCase(), 30))) return json(context.request, 429, { error: 'rate_limited', msg: '尝试次数过多，明天再试' });
  const raw = await kv().get('acct:' + u.toLowerCase());
  if (!raw) return json(context.request, 401, { error: 'bad_credentials', msg: '用户名或密码错误' });
  let acct;
  try { acct = JSON.parse(raw); } catch (e) { return json(context.request, 500, { error: 'corrupt_account' }); }
  const { hash } = await hashPassword(p, acct.salt, acct.iter);
  if (!safeEqual(hash, acct.hash)) return json(context.request, 401, { error: 'bad_credentials', msg: '用户名或密码错误' });
  const token = await signToken(context, acct.uid, u, 30);
  return json(context.request, 200, { token, u, uid: acct.uid });
}
