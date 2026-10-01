/* 退出：POST {all?: true}（Bearer）
   - 不带 all：令牌是无状态的，本端丢弃即可，这里只回 ok。
   - all: true：账户令牌版本 tv + 1 —— 所有设备上已签发的令牌（包括本次这个）立即失效（其他边缘节点最多延迟 60 s）。 */
import { json, preflight, kv, notReady, verifyToken, readJson, memHit, acctKey, HOUR } from '../../_lib.js';

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const who = await verifyToken(context);
  if (!who) return json(req, 401, { error: 'unauthorized', msg: '未登录或登录已过期' });
  if (!memHit('logout:' + who.uid, 20, HOUR)) return json(req, 429, { error: 'rate_limited', msg: '操作过于频繁' });
  const rj = await readJson(req, 1024);
  const all = !!(rj.body && rj.body.all === true);
  if (all) {
    if (!who.acct) return json(req, 409, { error: 'not_ready', msg: '账号刚创建，请一分钟后再试' });
    const acct = { ...who.acct, tv: (who.acct.tv || 0) + 1 };
    await kv().put(acctKey(who.uname), JSON.stringify(acct));
  }
  return json(req, 200, { ok: true, all });
}
