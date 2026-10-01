/* 注册：POST {u, p, dev?} → {token, u, uid, dev}
   KV: acct:<用户名小写> = {uid, salt, hash, iter, ts, tv, u}
   限流：每 IP（内存 + KV 分桶）每天 10 次尝试、全站每天 300 个新账号；用户名已存在返回 409（也计入 IP 次数）。
   竞争：KV 没有原子「不存在才写」。同一 isolate 内用内存集合串行化同名注册；散列后、写入前再查一次；
   写入后回读，uid 不是自己的就按「已被注册」处理。令牌校验时要求 acct.uid 与令牌一致，
   所以即使跨节点竞争两边都写成功，输掉的一方令牌立即失效，不会把两个人的数据混在一起。 */
import {
  json, preflight, kv, notReady, readJson, readAccount, hashPassword, signToken, signDevice, hex,
  clientIp, ipBucket, memHit, kvHit, acctKey, NAME_RE, MAX_PASSWORD, HOUR, DAY,
} from '../../_lib.js';

const REG_IP_MEM = 5, REG_IP_KV = 10, REG_ALL_MEM = 100, REG_ALL = 300;
const pending = new Set();

const limited = (req, msg) => json(req, 429, { error: 'rate_limited', msg: msg || '注册过于频繁，请明天再试' });
const taken = (req) => json(req, 409, { error: 'user_exists', msg: '用户名已被注册' });

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestPost(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const ip = clientIp(req);
  if (ip && !memHit('reg-ip:' + ip, REG_IP_MEM, HOUR)) return limited(req);
  if (!memHit('reg-all', REG_ALL_MEM, HOUR)) return limited(req, '注册人数过多，请稍后再试');
  const rj = await readJson(req, 4096);
  if (rj.error) return json(req, 400, { error: rj.error });
  const body = rj.body;
  const u = typeof body.u === 'string' ? body.u.trim() : '';
  const p = typeof body.p === 'string' ? body.p : '';
  if (!NAME_RE.test(u)) return json(req, 400, { error: 'bad_username', msg: '用户名需 3-20 位字母/数字/下划线' });
  if (p.length < 8 || p.length > MAX_PASSWORD) return json(req, 400, { error: 'bad_password', msg: '密码需 8-72 位' });
  if (ip && !(await kvHit(await ipBucket(context, 'reg', ip), REG_IP_KV, DAY))) return limited(req);
  const name = u.toLowerCase();
  if (pending.has(name)) return taken(req);
  pending.add(name);
  try {
    if (await kv().get(acctKey(name))) return taken(req);
    if (!(await kvHit('rl_reg_all', REG_ALL, DAY))) return limited(req, '今日注册名额已满，请明天再试');
    const { salt, hash, iter } = await hashPassword(p);
    const uid = hex(crypto.getRandomValues(new Uint8Array(8)));
    if (await kv().get(acctKey(name))) return taken(req);   /* 散列的几十毫秒里被别人抢先 */
    await kv().put(acctKey(name), JSON.stringify({ uid, salt, hash, iter, ts: Date.now(), tv: 0, u }));
    const back = await readAccount(name);
    if (!back || back.uid !== uid) return taken(req);
    const token = await signToken(context, uid, u, 0, true);
    const dev = await signDevice(context, uid);
    return json(req, 200, { token, u, uid, dev });
  } finally {
    pending.delete(name);
  }
}
