/* 学习数据同步：一人一键 u:<uid>:data
   存储：v2 {fmt:2, v, ts, z | keys, wd, wn}；旧版 {ts, keys}（无 fmt，旧客户端写的）
   GET  → {fmt?, v, ts, z | keys}。v 是版本号（旧记录为 "L<ts>"，没有记录为 "0"），同时放在 ETag 头里。
          旧客户端只读 keys，v2 压缩记录对它来说是空的——它随后的 PUT 会被 409 拒绝（不会覆盖新数据）。
   PUT  v2：{fmt:2, base, v?, ts, z | keys}。base 必须等于当前版本，否则 409 conflict（客户端重新合并后重试）。
             z = gzip+base64 的 keys（服务端不解压，只校验字符集）；keys 必须是普通对象。
        旧客户端：{ts, keys}。记录还是旧格式时照旧覆盖；已是 v2 时 409 client_outdated（提示刷新页面）。
   限制：请求体 512 KB（按字节，先看 Content-Length、流式读取超限即停）；每用户每天 400 次写入（计数存在记录里）。 */
import {
  json, preflight, kv, notReady, verifyToken, readBody, isPlainObject, memHit, dataKey, MIN,
} from '../_lib.js';

const MAX_BYTES = 512 * 1024;
const DAILY_WRITES = 400;
const V_RE = /^[A-Za-z0-9_-]{1,40}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const inflight = new Set();

const ver = (rec) => (!rec ? '0' : typeof rec.v === 'string' ? rec.v : 'L' + (rec.ts || 0));
async function readRec(uid) {
  const raw = await kv().get(dataKey(uid));
  if (!raw) return null;
  try { const r = JSON.parse(raw); return isPlainObject(r) ? r : null; } catch (e) { return null; }
}
const unauthorized = (req) => json(req, 401, { error: 'unauthorized', msg: '未登录或登录已过期' });

export function onRequestOptions(context) { return preflight(context); }

export async function onRequestGet(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const who = await verifyToken(context);
  if (!who) return unauthorized(req);
  if (!memHit('get:' + who.uid, 300, 10 * MIN)) return json(req, 429, { error: 'rate_limited', msg: '同步过于频繁，请稍后再试' });
  const rec = await readRec(who.uid);
  const out = rec ? { v: ver(rec), ts: rec.ts || 0 } : { fmt: 2, v: '0', ts: 0 };
  if (rec && rec.fmt === 2) out.fmt = 2;
  if (rec && typeof rec.z === 'string') out.z = rec.z;
  else out.keys = rec && isPlainObject(rec.keys) ? rec.keys : {};
  return json(req, 200, out, { etag: '"' + out.v + '"' });
}

export async function onRequestPut(context) {
  const nr = notReady(context);
  if (nr) return nr;
  const req = context.request;
  const who = await verifyToken(context);
  if (!who) return unauthorized(req);
  if (!memHit('put:' + who.uid, 60, 10 * MIN)) return json(req, 429, { error: 'rate_limited', msg: '同步过于频繁，请稍后再试' });
  const b = await readBody(req, MAX_BYTES);
  if (b.tooLarge) return json(req, 413, { error: 'too_large', msg: '数据超过 ' + MAX_BYTES / 1024 + ' KB 上限', limit: MAX_BYTES });
  let body;
  try { body = JSON.parse(b.text); } catch (e) { return json(req, 400, { error: 'bad_json' }); }
  if (!isPlainObject(body)) return json(req, 400, { error: 'bad_shape', msg: '需要 JSON 对象' });
  const v2 = body.fmt === 2;
  let payload;
  if (typeof body.z === 'string') {
    if (!v2 || !B64_RE.test(body.z)) return json(req, 400, { error: 'bad_shape', msg: 'z 必须是 base64' });
    payload = { z: body.z };
  } else if (isPlainObject(body.keys)) {
    payload = { keys: body.keys };
  } else {
    return json(req, 400, { error: 'bad_shape', msg: '需要 {keys: 对象} 或 {fmt:2, z}' });
  }
  if (v2 && typeof body.base !== 'string') return json(req, 400, { error: 'bad_shape', msg: '需要 base 版本号' });
  /* 同一 isolate 内同一用户的写入串行化；跨节点靠 base 校验 + 写后回读 */
  if (inflight.has(who.uid)) return json(req, 409, { error: 'conflict', msg: '另一次同步正在进行' });
  inflight.add(who.uid);
  try {
    const rec = await readRec(who.uid);
    const cur = ver(rec);
    if (v2) {
      if (body.base !== cur) return json(req, 409, { error: 'conflict', v: cur, msg: '云端数据已被其他设备更新' });
    } else if (rec && rec.fmt === 2) {
      return json(req, 409, { error: 'client_outdated', msg: '页面是旧版本（浏览器缓存），请刷新页面后再同步' });
    }
    const day = new Date().toISOString().slice(0, 10);
    const wn = rec && rec.wd === day ? rec.wn || 0 : 0;
    if (wn >= DAILY_WRITES) return json(req, 429, { error: 'rate_limited', msg: '今日同步次数已达上限' });
    const ts = Date.now();
    const nv = v2 ? (typeof body.v === 'string' && V_RE.test(body.v) ? body.v : ts.toString(36) + '-' + Math.random().toString(36).slice(2, 10)) : '';
    const next = v2 ? { fmt: 2, v: nv, ts, ...payload, wd: day, wn: wn + 1 } : { ts, keys: payload.keys, wd: day, wn: wn + 1 };
    await kv().put(dataKey(who.uid), JSON.stringify(next));
    const back = await readRec(who.uid);
    const now = ver(back);
    if (back && now !== ver(next)) return json(req, 409, { error: 'conflict', v: now, msg: '云端数据已被其他设备更新' });
    return json(req, 200, { ok: true, ts, v: ver(next) });
  } finally {
    inflight.delete(who.uid);
  }
}
