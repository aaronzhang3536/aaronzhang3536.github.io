/* 登录：POST {u, p, dev?} → {token, u, uid, dev}
   防爆破：
   ① 每 IP 限次：同一 isolate 内存精确计数 + KV 分桶近似计数（跨节点）。
   ② 每账户失败退避：连续失败 5 次后锁 30 s 起、每次翻倍、最长 15 分钟（lk_<name>，一天无失败清零）。
      为了不被恶意锁号：带着本设备以前登录成功时拿到的设备令牌（dev）登录，不受账户锁影响。
   ③ 用户名不存在 / 格式不对也跑一次同成本的 PBKDF2，响应时间不泄露账户是否存在；不为不存在的用户写任何键。 */
import {
  json, preflight, notReady, readJson, readAccount, checkPassword, dummyHash, signToken, signDevice, verifyDevice,
  clientIp, ipBucket, memHit, kvHit, readLock, lockedFor, noteFailure, clearLock, lockedResponse,
  sweepLegacy, background, NAME_RE, MAX_PASSWORD, MIN,
} from '../../_lib.js';

const IP_MEM = 20, IP_KV = 40, IP_WIN = 10 * MIN;   /* 每 IP 每 10 分钟 */
const ACCT_MEM = 10, ACCT_WIN = 10 * MIN;           /* 每账户每 isolate 每 10 分钟（无设备令牌时） */

const bad = (req) => json(req, 401, { error: 'bad_credentials', msg: '用户名或密码错误' });
const limited = (req) => json(req, 429, { error: 'rate_limited', msg: '尝试过于频繁，请稍后再试' }, { 'retry-after': '600' });

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const ip = clientIp(req);
  if (ip && !memHit('login-ip:' + ip, IP_MEM, IP_WIN)) return limited(req);
  const rj = await readJson(req, 4096);
  if (rj.error) return json(req, 400, { error: rj.error });
  const body = rj.body;
  const u = typeof body.u === 'string' ? body.u.trim() : '';
  const p = typeof body.p === 'string' ? body.p : '';
  if (!NAME_RE.test(u) || !p || p.length > MAX_PASSWORD) { await dummyHash(p); return bad(req); }
  if (ip && !(await kvHit(await ipBucket(context, 'login', ip), IP_KV, IP_WIN))) return limited(req);
  const name = u.toLowerCase();
  const acct = await readAccount(name);
  if (!acct) { await dummyHash(p); return bad(req); }
  const devOk = typeof body.dev === 'string' && (await verifyDevice(context, body.dev, acct.uid));
  const lock = await readLock(name);
  if (!devOk) {
    const secs = lockedFor(lock);
    if (secs) return lockedResponse(req, secs);
    if (!memHit('login-acct:' + name, ACCT_MEM, ACCT_WIN)) return lockedResponse(req, 600);
  }
  if (!(await checkPassword(acct, p))) {
    await noteFailure(name, lock);
    return bad(req);
  }
  await clearLock(name, lock);
  const token = await signToken(context, acct.uid, u, acct.tv || 0);
  const dev = devOk ? body.dev : await signDevice(context, acct.uid);
  if (Math.random() < 0.1) background(context, sweepLegacy());
  return json(req, 200, { token, u, uid: acct.uid, dev });
}
