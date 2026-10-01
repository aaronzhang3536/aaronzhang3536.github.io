/* 外语中心云同步 · 纯合并内核（不碰 DOM / localStorage，node 里可直接测试：scripts/tests/lang.test.mjs）

   同步范围（白名单）：^yzzn-(en|ja|ko|fr|de|es|it|ru)-* ，排除 *-cfg（AI Key / 语音偏好，设备本地）
   与 yzzn-en-ai / yzzn-en-dict（缓存）。站内其他 yzzn-* 数据（游戏厅、天气、术数、音乐）一律不上传。
   另有一个元数据键 yzzn-sync-meta = { del: {键: {词条id: 删除时间}}, wipe: {键: 清空时间} }。

   按键的合并策略：
   - *-words  词条数组：按词条修改时间 mt「后写者胜」；删除墓碑时间 ≥ 词条 mt 则删除；清空标记之前的词条全部丢弃。
              旧数据没有 mt 时由 SM-2 状态反推最后一次评分时间（英语 srs.d - srs.i 天；其他语言 due - iv 天），
              两种词条形状（英语 {w,def,t,srs:{ef,n,i,d}} / 其他 {w,r,rom,def,due,iv,ef,rep}）都认。
   - yzzn-en-stats、yzzn-<ea>-daily（每日复习次数）、yzzn-<ea>-dojo（[对, 错]）计数器：
              三方合并 local + remote - base（base = 上次同步时用到的云端值），两台设备同一天的计数相加而不是取大；
              没有 base（首次同步 / 换账号 / 清空后）时退化为取大，避免把已同步过的计数翻倍。
   - 其余（闯关星数、豁免、竞技场纪录、en-daily 每日新词额度）：数值取大、布尔取或、对象并集、基本类型数组并集。
   - 字符串 / 类型不一致：本地优先。
   清空标记：一方的 wipe[键] 比另一方新 → 另一方这个键的数据视为已被清空（词条只保留清空之后改过的）。 */

export const META_KEY = 'yzzn-sync-meta';
export const DAY = 864e5;
export const TOMB_TTL = 180 * DAY;   /* 墓碑保留 180 天：离线超过这么久的设备可能让删掉的词复活 */
export const TOMB_MAX = 3000;        /* 每个键最多保留的墓碑数 */

const KEY_RE = /^yzzn-(en|ja|ko|fr|de|es|it|ru)-[a-z0-9-]+$/;
const EXCL_RE = /-cfg$|^yzzn-en-(ai|dict)$/;
const COUNTER_RE = /^yzzn-en-stats$|^yzzn-(ja|ko|fr|de|es|it|ru)-(daily|dojo)$/;

export function isSyncKey(k) { return typeof k === 'string' && KEY_RE.test(k) && !EXCL_RE.test(k); }
export function strategyOf(k) {
  if (/-words$/.test(k)) return 'entries';
  if (COUNTER_RE.test(k)) return 'counter';
  return 'max';
}
export function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
const isNum = (x) => typeof x === 'number' && isFinite(x);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const unionKeys = (a, b) => {
  const s = new Set(Object.keys(a));
  Object.keys(b).forEach((k) => s.add(k));
  s.delete('__proto__');   /* 防原型污染：远端 JSON 里的 "__proto__" 键一律丢弃 */
  return Array.from(s);
};

/* 词条 id：英语按小写去重（addWord 本身就大小写不敏感），其他语言按原文 */
export function entryId(key, w) { return key === 'yzzn-en-words' ? String(w).toLowerCase() : String(w); }

/* 词条的「最后修改时间」：优先 mt；旧数据从 SM-2 状态反推 */
export function entryTime(e, now) {
  if (!isPlainObject(e)) return 0;
  if (isNum(e.mt)) return e.mt;
  let t = isNum(e.t) ? e.t : 0;
  const s = e.srs;
  if (isPlainObject(s) && isNum(s.d) && s.d > 0) t = Math.max(t, s.d - (s.i > 0 ? s.i * DAY : 6e5));
  else if (isNum(e.due) && e.due > 0) t = Math.max(t, e.due - (e.iv > 0 ? e.iv * DAY : 6e5));
  if (now && t > now) t = now;
  return t > 0 ? t : 0;
}

/* 规范化 JSON：对象键排序、词条数组按 id 排序 —— 只用于「有没有变化」的比较，避免顺序不同导致来回写 */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return v === undefined ? 'null' : JSON.stringify(v);
}
export function canonKey(key, v) {
  if (key === META_KEY) return canon(normMeta(v));
  if (strategyOf(key) === 'entries' && Array.isArray(v)) {
    const rows = v.map((e) => [isPlainObject(e) && typeof e.w === 'string' ? entryId(key, e.w) : '', e]);
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return canon(rows.map((x) => x[1]));
  }
  return canon(v);
}

/* ---------- 元数据：墓碑 + 清空标记 ---------- */
export function normMeta(m) {
  const out = { del: {}, wipe: {} };
  if (!isPlainObject(m)) return out;
  if (isPlainObject(m.del)) {
    Object.keys(m.del).forEach((k) => {
      if (!isSyncKey(k) || !isPlainObject(m.del[k])) return;
      const d = {};
      Object.keys(m.del[k]).forEach((id) => {
        const t = m.del[k][id];
        if (id !== '__proto__' && isNum(t) && t > 0) d[id] = t;
      });
      if (Object.keys(d).length) out.del[k] = d;
    });
  }
  if (isPlainObject(m.wipe)) {
    Object.keys(m.wipe).forEach((k) => {
      const t = m.wipe[k];
      if (isSyncKey(k) && isNum(t) && t > 0) out.wipe[k] = t;
    });
  }
  return out;
}
export function pruneMeta(m, now) {
  Object.keys(m.del).forEach((k) => {
    const w = m.wipe[k] || 0, d = m.del[k];
    let ids = Object.keys(d).filter((id) => d[id] > w && now - d[id] < TOMB_TTL);
    if (ids.length > TOMB_MAX) ids = ids.sort((a, b) => d[b] - d[a]).slice(0, TOMB_MAX);
    if (!ids.length) { delete m.del[k]; return; }
    const nd = {};
    ids.forEach((id) => { nd[id] = d[id]; });
    m.del[k] = nd;
  });
  return m;
}
export function mergeMeta(a, b, now) {
  const A = normMeta(a), B = normMeta(b), out = { del: {}, wipe: {} };
  unionKeys(A.wipe, B.wipe).forEach((k) => { out.wipe[k] = Math.max(A.wipe[k] || 0, B.wipe[k] || 0); });
  unionKeys(A.del, B.del).forEach((k) => {
    const da = A.del[k] || {}, db = B.del[k] || {}, d = {};
    unionKeys(da, db).forEach((id) => { d[id] = Math.max(da[id] || 0, db[id] || 0); });
    out.del[k] = d;
  });
  return pruneMeta(out, now);
}
export function metaEmpty(m) { return !Object.keys(m.del).length && !Object.keys(m.wipe).length; }

/* ---------- 各策略 ---------- */
export function mergeEntries(key, l, r, tomb, wipeAt, now) {
  const map = new Map(), order = [];
  const better = (a, b) => {   /* b 是否胜过 a：时间新者胜，平局按内容定序（两端结果一致，不会来回翻） */
    const ta = entryTime(a, now), tb = entryTime(b, now);
    if (tb !== ta) return tb > ta;
    return canon(b) > canon(a);
  };
  const take = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((e) => {
      if (!isPlainObject(e) || typeof e.w !== 'string' || !e.w) return;
      const id = entryId(key, e.w);
      const old = map.get(id);
      if (!old) { map.set(id, e); order.push(id); } else if (better(old, e)) map.set(id, e);
    });
  };
  take(l); take(r);
  const out = [];
  order.forEach((id) => {
    const e = map.get(id), t = entryTime(e, now);
    if (wipeAt > 0 && t <= wipeAt) return;
    const td = tomb && own(tomb, id) ? tomb[id] : 0;
    if (td > 0 && td >= t) return;
    out.push(e);
  });
  return out;
}
export function mergeCounter(l, r, b, useBase) {
  if (l === undefined) return r;
  if (r === undefined) return l;
  if (isNum(l) && isNum(r)) {
    if (!useBase) return Math.max(l, r);
    const bb = isNum(b) ? b : 0;
    return Math.max(l, r, l + r - bb);
  }
  if (Array.isArray(l) && Array.isArray(r)) {
    const out = [];
    for (let i = 0; i < Math.max(l.length, r.length); i++) out.push(mergeCounter(l[i], r[i], Array.isArray(b) ? b[i] : undefined, useBase));
    return out;
  }
  if (isPlainObject(l) && isPlainObject(r)) {
    const out = {};
    unionKeys(l, r).forEach((k) => { out[k] = mergeCounter(l[k], r[k], isPlainObject(b) ? b[k] : undefined, useBase); });
    return out;
  }
  return l;
}
export function mergeMax(l, r) {
  if (l === undefined) return r;
  if (r === undefined) return l;
  if (isNum(l) && isNum(r)) return Math.max(l, r);
  if (typeof l === 'boolean' && typeof r === 'boolean') return l || r;
  if (Array.isArray(l) && Array.isArray(r)) {
    if (l.length === r.length && l.every(isNum) && r.every(isNum)) return l.map((x, i) => Math.max(x, r[i]));
    if (l.concat(r).every((x) => x === null || typeof x !== 'object')) {
      const out = l.slice();
      r.forEach((x) => { if (!out.includes(x)) out.push(x); });
      return out;
    }
    return l;
  }
  if (isPlainObject(l) && isPlainObject(r)) {
    const out = {};
    unionKeys(l, r).forEach((k) => { out[k] = mergeMax(l[k], r[k]); });
    return out;
  }
  return l;
}

/* 合并本机与云端的全部同步键。
   base：计数器键的公共祖先 {键: 值}（没有就传 null）。
   返回 { keys: 合并结果（含 META_KEY）, remoteUsed: 计数器键实际参与合并的云端值（成为下一次的 base） } */
export function mergeAll(local, remote, base, now) {
  local = isPlainObject(local) ? local : {};
  remote = isPlainObject(remote) ? remote : {};
  now = now || Date.now();
  const lm = normMeta(local[META_KEY]), rm = normMeta(remote[META_KEY]);
  const meta = mergeMeta(lm, rm, now);
  const keys = {}, remoteUsed = {};
  const names = new Set();
  Object.keys(local).forEach((k) => { if (isSyncKey(k)) names.add(k); });
  Object.keys(remote).forEach((k) => { if (isSyncKey(k)) names.add(k); });
  names.forEach((k) => {
    let l = local[k], r = remote[k];
    const W = meta.wipe[k] || 0;
    const st = strategyOf(k);
    if (st === 'entries') {
      if (!Array.isArray(l)) l = undefined;
      if (!Array.isArray(r)) r = undefined;
      if (l === undefined && r === undefined) return;
      keys[k] = mergeEntries(k, l, r, meta.del[k], W, now);
      return;
    }
    let useBase = isPlainObject(base) && own(base, k) && base[k] !== undefined;
    if ((lm.wipe[k] || 0) < W) { l = undefined; useBase = false; }
    if ((rm.wipe[k] || 0) < W) { r = undefined; useBase = false; }
    const v = st === 'counter' ? mergeCounter(l, r, useBase ? base[k] : undefined, useBase) : mergeMax(l, r);
    if (v !== undefined && v !== null) keys[k] = v;
    if (st === 'counter' && r !== undefined) remoteUsed[k] = r;
  });
  if (!metaEmpty(meta)) keys[META_KEY] = meta;
  return { keys, remoteUsed };
}

/* 两份数据在哪些同步键上不同（按规范化 JSON 比较） */
export function changedNames(a, b) {
  const names = new Set();
  [a, b].forEach((o) => Object.keys(o || {}).forEach((k) => { if (isSyncKey(k) || k === META_KEY) names.add(k); }));
  return Array.from(names).filter((k) => canonKey(k, (a || {})[k]) !== canonKey(k, (b || {})[k]));
}
export function counterSnapshot(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => { if (isSyncKey(k) && strategyOf(k) === 'counter' && obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}
