/* 注销账号：POST {p}（Bearer + 再输一次密码）→ 删除 u:<uid>:data、acct:<name>、lk_<name>
   密码错误返回 403（不是 401，免得客户端把它当成登录失效），并计入账户失败退避。 */
import {
  json, preflight, kv, notReady, verifyToken, readJson, checkPassword, memHit, readLock, lockedFor, noteFailure,
  clearLock, lockedResponse, acctKey, dataKey, MAX_PASSWORD, HOUR,
} from '../../_lib.js';

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const who = await verifyToken(context);
  if (!who) return json(req, 401, { error: 'unauthorized', msg: '未登录或登录已过期' });
  if (!memHit('delete:' + who.uid, 5, HOUR)) return json(req, 429, { error: 'rate_limited', msg: '操作过于频繁，请稍后再试' });
  if (!who.acct) return json(req, 409, { error: 'not_ready', msg: '账号刚创建，请一分钟后再试' });
  const rj = await readJson(req, 4096);
  const p = rj.body && typeof rj.body.p === 'string' ? rj.body.p : '';
  const name = who.uname.toLowerCase();
  const lock = await readLock(name);
  const secs = lockedFor(lock);
  if (secs) return lockedResponse(req, secs);
  if (!p || p.length > MAX_PASSWORD || !(await checkPassword(who.acct, p))) {
    await noteFailure(name, lock);
    return json(req, 403, { error: 'bad_password', msg: '密码错误' });
  }
  await kv().delete(dataKey(who.uid));
  await kv().delete(acctKey(name));
  await clearLock(name, lock);
  await kv().delete(dataKey(who.uid));   /* 再删一次：防止刚好有一次同步写入夹在中间 */
  return json(req, 200, { ok: true });
}
