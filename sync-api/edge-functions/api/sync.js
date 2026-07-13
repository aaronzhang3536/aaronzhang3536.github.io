/* 学习数据同步：一人一键 u:<uid>:data，值为 {ts, keys:{localStorage键: 值}}
   GET  → 取回整包（无数据返回 {ts:0, keys:{}}）
   PUT  → 覆盖存储（客户端负责合并）；限 300KB / 每日 400 次 */
import { json, preflight, kv, notReady, verifyToken, rateLimit, corsHeaders } from '../_lib.js';

const MAX_BYTES = 300 * 1024;
const DAILY_WRITES = 400;

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestGet(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const who = await verifyToken(context);
  if (!who) return json(context.request, 401, { error: 'unauthorized', msg: '未登录或登录已过期' });
  const raw = await kv().get('u:' + who.uid + ':data');
  if (!raw) return json(context.request, 200, { ts: 0, keys: {} });
  return new Response(raw, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(context.request) },
  });
}

export async function onRequestPut(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const who = await verifyToken(context);
  if (!who) return json(context.request, 401, { error: 'unauthorized', msg: '未登录或登录已过期' });
  const text = await context.request.text();
  if (text.length > MAX_BYTES) return json(context.request, 413, { error: 'too_large', msg: '数据超过 300KB 上限' });
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(context.request, 400, { error: 'bad_json' }); }
  if (!body || typeof body.keys !== 'object') return json(context.request, 400, { error: 'bad_shape', msg: '需要 {ts, keys}' });
  if (!(await rateLimit(who.uid, DAILY_WRITES))) return json(context.request, 429, { error: 'rate_limited', msg: '今日同步次数已达上限' });
  const ts = Date.now();
  await kv().put('u:' + who.uid + ':data', JSON.stringify({ ts, keys: body.keys }));
  return json(context.request, 200, { ok: true, ts });
}
