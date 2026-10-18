/* 学习数据云同步（外语中心）：注册/登录（EdgeOne 边缘函数 + KV）→ 多设备合并同步；本地导出导入
   - 只同步外语学习数据（白名单见 synccore.js）：生词、复习进度、闯关星数、道场掌握度、每日计数。
     AI Key / 语音偏好（*-cfg）与词典/AI 缓存永不上传；站内其他数据（游戏厅、天气、术数、音乐）不上传。
   - 未登录时不连接服务器；打开「设置」面板时才做一次服务状态检查。
   - 合并内核 synccore.js：词条按修改时间后写者胜 + 删除墓碑 + 清空标记；计数器三方合并。
   - 协议 v2：GET → {fmt, v, ts, z|keys}；PUT {fmt:2, base, v, ts, z|keys}。base 与云端当前版本不一致 → 409，
     重新拉取合并后重试。z = gzip + base64 的 keys（浏览器支持 CompressionStream 时），大词库也能装下。
     旧服务端（GET 没有 v）自动退回旧格式 {ts, keys}。
   - 合并后不刷新页面：派发 yzzn-sync-applied 事件，页面就地重读内存状态；没有页面处理时显示「刷新」提示。
   - 本机数据记录归属账号（owner）：登录另一个账号时先询问是否合并，避免把上一个人的数据并进来。 */
import { META_KEY, isSyncKey, isPlainObject, mergeAll, changedNames, counterSnapshot } from './synccore.js';

const DEFAULT_API = 'https://yzzn-sync-lzgf3t47.edgeone.dev';
const CK = 'yzzn-cloud';          /* {token, u, uid, lastSync, owner, ownerName, dev} */
const BK = 'yzzn-cloud-base';     /* {uid, v, keys, pv?, pkeys?}：计数器三方合并的公共祖先（+ 未确认的写入） */
const RK = 'yzzn-cloud-recovery'; /* 本地写前日志：归属、接口、业务键/base 前后值与 lastSync；不含令牌，不上传 */
const MAX_BYTES = 512 * 1024;     /* 与服务端一致：请求体字节数上限 */
const LEGACY_MAX_CHARS = 300 * 1024;
const DEBOUNCE = 12000;

let rawSet = (k, v) => localStorage.setItem(k, v);
let rawRemove = (k) => localStorage.removeItem(k);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => rawSet(k, JSON.stringify(v));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (v) => (typeof v === 'string' ? v : '');

let cloud = readCloud();
let syncing = null, again = false, dirtyTimer = 0, sessionEpoch = 0;
const requests = new Set();

/* 请求固定到发起时的会话；持久化 CK 对照也能识别另一标签页切换账号。 */
function snapshot() { return { epoch: sessionEpoch, token: cloud.token, uid: cloud.uid, owner: cloud.owner, api: apiBase() }; }
function sessionCurrent(s) {
  const persisted = readCloud();
  return s.epoch === sessionEpoch && s.token === cloud.token && s.uid === cloud.uid && s.owner === cloud.owner && s.api === apiBase() &&
    s.token === persisted.token && s.uid === persisted.uid && s.owner === persisted.owner;
}
function requireSession(s) { if (!sessionCurrent(s)) throw new Error('同步会话已变更'); }
function invalidateSession() {
  sessionEpoch++;
  clearTimeout(dirtyTimer);
  again = false;
  requests.forEach((c) => c.abort());
  requests.clear();
}

/* ---------- 登录状态（兼容旧版 {token, u, lastSync}） ---------- */
function tokenUid(tok) {
  try {
    const p = atob(String(tok).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'));
    const uid = p.split('.')[0];
    return /^[0-9a-f]{16}$/.test(uid) ? uid : '';
  } catch (e) { return ''; }
}
function readCloud() {
  const c = load(CK, {});
  const out = {
    token: str(c.token), u: str(c.u), uid: str(c.uid), lastSync: typeof c.lastSync === 'number' ? c.lastSync : 0,
    owner: str(c.owner), ownerName: str(c.ownerName), dev: str(c.dev),
  };
  if (out.token && !out.uid) out.uid = tokenUid(out.token);
  /* 旧版登录中的设备：本机数据就是这个账号的 */
  if (out.token && out.uid && !out.owner) { out.owner = out.uid; out.ownerName = out.u; }
  return out;
}
function saveCloud() { save(CK, cloud); }

/* 接口地址：只在本地开发（localhost）时允许用 yzzn-cloud-api 覆盖，线上一律用默认地址 */
function apiBase() {
  try {
    if (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      const o = localStorage.getItem('yzzn-cloud-api');
      if (o) return o;
    }
  } catch (e) {}
  return DEFAULT_API;
}

/* ---------- 本机数据 ---------- */
function lsKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); }
  return out;
}
function collect() {
  const keys = {};
  lsKeys().forEach((k) => {
    if (!isSyncKey(k) && k !== META_KEY) return;
    const raw = localStorage.getItem(k);   /* 读取失败不能当成「没有本机数据」继续上传 */
    try { const v = JSON.parse(raw); if (v != null) keys[k] = v; } catch (e) {}
  });
  return keys;
}
function hasLearningData() {
  const keys = collect();
  return Object.keys(keys).some((k) => {
    if (k === META_KEY) return false;
    const v = keys[k];
    return Array.isArray(v) ? v.length > 0 : isPlainObject(v) ? Object.keys(v).length > 0 : true;
  });
}
function storageError(message) {
  const e = new Error('本机保存失败：' + message);
  e.localStorage = true;
  return e;
}
/* localStorage 没有跨键事务：先落前后值日志，数据与 base 一起成功才提交。
   回滚逐键释放空间并恢复；记录正在恢复的键，以便识别中途关闭后的空值。
   若本机值已不属于本次事务（例如失败后又学习），保留现值与日志并暂停，不能覆盖新进度。
   日志只允许业务键/BK 和 lastSync 数字，绝不复制 CK 中的 token/dev。 */
function recoverLocal(s) {
  requireSession(s);
  const raw = localStorage.getItem(RK);
  if (raw === null) return [];
  let j;
  try { j = JSON.parse(raw); } catch (e) { throw storageError('恢复日志无法读取，请保留本机数据并导出备份'); }
  if (!j || j.fmt !== 1 || j.uid !== s.uid || j.owner !== s.owner || j.api !== s.api || !Array.isArray(j.before) || !Array.isArray(j.after) ||
      j.before.some((x) => !Array.isArray(x) || x.length !== 2 || !(isSyncKey(x[0]) || x[0] === META_KEY || x[0] === BK) || !(x[1] === null || typeof x[1] === 'string')) ||
      new Set(j.before.map(([k]) => k)).size !== j.before.length || j.after.length !== j.before.length ||
      j.after.some((x, i) => !Array.isArray(x) || x.length !== 2 || x[0] !== j.before[i][0] || !(x[1] === null || typeof x[1] === 'string')) ||
      (j.restoring !== undefined && !j.before.some(([k]) => k === j.restoring)) ||
      (j.lastSync !== undefined && (!Number.isFinite(j.lastSync) || !Number.isFinite(j.afterLastSync)))) {
    throw storageError('恢复日志与当前账号或接口不匹配，已暂停同步，未覆盖任何数据');
  }
  const current = j.before.map(([k]) => localStorage.getItem(k));
  if (j.before.some(([k, v], i) => current[i] !== v && current[i] !== j.after[i][1] && !(j.restoring === k && current[i] === null)) ||
      (j.lastSync !== undefined && ![j.lastSync, j.afterLastSync].includes(readCloud().lastSync))) {
    throw storageError('恢复日志之后出现了新的本机进度，已保留当前数据并暂停同步；请先导出备份，再处理恢复冲突');
  }
  const changed = j.before.filter(([k, v]) => localStorage.getItem(k) !== v);
  try {
    changed.forEach(([k, v]) => {
      requireSession(s);
      j.restoring = k;
      save(RK, j);   /* 先记录允许出现空值的唯一键，再释放该键的空间 */
      requireSession(s);
      rawRemove(k);
      if (v !== null) rawSet(k, v);
    });
    if (j.lastSync !== undefined) {
      requireSession(s);
      const c = readCloud();
      if (c.lastSync !== j.lastSync) save(CK, { ...c, lastSync: j.lastSync });
    }
    requireSession(s);
    rawRemove(RK);
  } catch (e) { throw storageError('上次写入尚未恢复；请释放浏览器存储空间后重试，恢复完成前不会上传'); }
  return changed.map(([k]) => k).filter((k) => k !== BK);
}
function writeLocal(changes, s, nextCloud) {
  requireSession(s);
  /* 调用者已从恢复后的快照计算合并；这里若出现新日志，绝不能恢复后沿用旧计算结果。 */
  if (localStorage.getItem(RK) !== null) throw storageError('另一次本机写入尚未恢复，已暂停本次提交，请重试同步');
  const before = changes.map(([k]) => [k, localStorage.getItem(k)]);
  const journal = { fmt: 1, uid: s.uid, owner: s.owner, api: s.api, before, after: changes,
    ...(nextCloud ? { lastSync: readCloud().lastSync, afterLastSync: nextCloud.lastSync } : {}) };
  try {
    requireSession(s);
    save(RK, journal);   /* 日志本身保存失败时，业务数据完全不动 */
    changes.forEach(([k, v]) => { requireSession(s); if (v === null) rawRemove(k); else rawSet(k, v); });
    if (nextCloud) { requireSession(s); save(CK, nextCloud); }
    requireSession(s);
    rawRemove(RK);
  } catch (e) {
    if (!sessionCurrent(s)) throw e;
    recoverLocal(s);
    throw storageError('未完成本次保存，已恢复写入前的数据；请释放浏览器存储空间后重试');
  }
}
function applyLocal(merged, names, base, s, nextCloud) {
  const changes = names.map((k) => [k, merged[k] === undefined ? null : JSON.stringify(merged[k])]);
  changes.push([BK, JSON.stringify(base)]);
  writeLocal(changes, s, nextCloud);
}
function wipeLocalLearning(s) {
  const gone = lsKeys().filter((k) => isSyncKey(k) || k === META_KEY);
  writeLocal(gone.concat(BK).map((k) => [k, null]), s);
  return gone;
}

/* ---------- 编码：gzip + base64 ---------- */
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' &&
  typeof Blob === 'function' && typeof Response === 'function';
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gzip(text) {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function gunzip(bytes) {
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function decodeRemote(rec) {
  if (!isPlainObject(rec)) return {};
  if (typeof rec.z === 'string') {
    if (!canZip()) throw new Error('当前浏览器不支持解压云端数据（需要较新的 Chrome / Edge / Safari 16.4+ / Firefox 113+）');
    const j = JSON.parse(await gunzip(unb64(rec.z)));
    return isPlainObject(j) ? j : {};
  }
  return isPlainObject(rec.keys) ? rec.keys : {};
}
async function encodeKeys(keys) {
  if (canZip()) { try { return { z: b64(await gzip(JSON.stringify(keys))) }; } catch (e) {} }
  return { keys };
}
const byteLen = (s) => (typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length * 3);
const newVersion = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

/* ---------- API ---------- */
async function call(path, method, body, auth, s = snapshot()) {
  const cancelled = () => ({ status: 0, ok: false, body: null, cancelled: true });
  if (!sessionCurrent(s)) return cancelled();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  if (controller) requests.add(controller);
  try {
    const r = await fetch(s.api + path, {
      method,
      headers: { 'content-type': 'application/json', ...(auth && s.token ? { authorization: 'Bearer ' + s.token } : {}) },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!sessionCurrent(s)) return cancelled();
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (!sessionCurrent(s)) return cancelled();
    if (r.status === 401 && auth && s.token) sessionLost(s);
    return { status: r.status, ok: r.ok, body: j };
  } catch (e) { return sessionCurrent(s) ? { status: 0, ok: false, body: null } : cancelled(); }
  finally { if (controller) requests.delete(controller); }
}
const errText = (res) => (res.body && (res.body.msg || res.body.error)) || (res.status ? 'HTTP ' + res.status : '网络不可达');
function sessionLost(s) {
  if (!sessionCurrent(s)) return;
  invalidateSession();
  cloud.token = '';
  try { saveCloud(); } catch (e) { note('登录已失效，本机退出状态无法保存，请释放浏览器存储空间后重新登录。'); renderUI(); return; }
  note('云同步的登录已失效（可能在别的设备上「退出全部设备」或注销了账号），请在「设置」里重新登录。本机数据不受影响。');
  renderUI();
}

/* ---------- 同步 ---------- */
function loadBase() {
  const b = load(BK, null);
  return isPlainObject(b) && b.uid === cloud.uid ? b : null;
}
function tooLarge(n, limit) {
  const t = '云同步数据过大（约 ' + Math.ceil(n / 1024) + ' KB，上限 ' + Math.round(limit / 1024) + ' KB），本机最新进度没有上传。' +
    '可以在生词本删掉不再需要的词，或先「导出本地备份」。';
  note(t);
  setMsg(t);
}
async function fullSync(opts) {
  opts = opts || {};
  if (!cloud.token) return { ok: false };
  const s = snapshot();
  if (!sessionCurrent(s)) return { ok: false, cancelled: true };
  if (syncing && sessionCurrent(syncing)) { again = true; return { ok: false, busy: true }; }
  syncing = s;
  if (!opts.silent) setMsg('同步中…');
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      requireSession(s);
      const recovered = recoverLocal(s);
      if (recovered.length) notifyApplied(recovered, true, s);
      const g = await call('/api/sync', 'GET', undefined, true, s);
      requireSession(s);
      if (!g.ok) throw new Error(errText(g));
      const rec = isPlainObject(g.body) ? g.body : {};
      const legacyServer = !('v' in rec);
      const remote = await decodeRemote(rec);
      requireSession(s);
      /* GET/解压期间另一标签页也可能留下未完成的事务，必须先恢复，再读取 base/local。 */
      const restored = recoverLocal(s);
      if (restored.length) notifyApplied(restored, true, s);
      const baseRaw = localStorage.getItem(BK);
      let base = loadBase();
      if (base && base.pv && base.pv === rec.v) base = { uid: cloud.uid, v: base.pv, keys: base.pkeys || {} };   /* 上次的写入其实成功了 */
      const local = collect();
      const res = mergeAll(local, remote, base ? base.keys : null, Date.now());
      const merged = res.keys;
      const lc = changedNames(local, merged);
      const nextBase = { uid: s.uid, v: rec.v, keys: counterSnapshot(res.remoteUsed) };
      const foreign = Object.keys(remote).some((k) => !isSyncKey(k) && k !== META_KEY);
      const needPut = legacyServer || rec.fmt !== 2 || foreign || changedNames(remote, merged).length > 0;
      if (!needPut) return done(opts, s, nextBase, merged, lc);
      let body, nv = '';
      if (legacyServer) {
        body = JSON.stringify({ ts: Date.now(), keys: merged });
        if (body.length > LEGACY_MAX_CHARS) { tooLarge(body.length, LEGACY_MAX_CHARS); return { ok: false }; }
      } else {
        nv = newVersion();
        body = JSON.stringify({ fmt: 2, base: rec.v, v: nv, ts: Date.now(), ...(await encodeKeys(merged)) });
        requireSession(s);
        const n = byteLen(body);
        if (n > MAX_BYTES) { tooLarge(n, MAX_BYTES); return { ok: false }; }
        nextBase.pv = nv;
        nextBase.pkeys = counterSnapshot(merged);
      }
      /* 压缩期间用户可能又做了一道题；重新合并，不能把旧快照盖回本机。 */
      if (baseRaw !== localStorage.getItem(BK) || changedNames(local, collect()).length) continue;
      applyLocal(merged, lc, nextBase, s);
      if (lc.length) notifyApplied(lc, false, s);
      requireSession(s);   /* dispatchEvent 也可以同步重入并切换账号 */
      const p = await call('/api/sync', 'PUT', body, true, s);
      requireSession(s);
      if (p.status === 409 && p.body && p.body.error === 'conflict') continue;   /* 别的设备刚写过：重新合并 */
      if (p.status === 413) { tooLarge(byteLen(body), (p.body && p.body.limit) || MAX_BYTES); return { ok: false }; }
      if (!p.ok) throw new Error(errText(p));
      return done(opts, s, { uid: s.uid, v: (p.body && p.body.v) || nv || undefined, keys: counterSnapshot(merged) });
    }
    throw new Error('云端数据一直在变化，稍后再试');
  } catch (e) {
    if (!sessionCurrent(s)) return { ok: false, cancelled: true };
    setMsg('同步失败：' + (e && e.message || e));
    if (e && e.localStorage) note(e.message);
    return { ok: false };
  } finally {
    if (syncing === s) {
      syncing = null;
      if (again && sessionCurrent(s)) { again = false; schedule(); }
    }
  }
}
function done(opts, s, base, merged = {}, names = []) {
  requireSession(s);
  const next = { ...cloud, lastSync: Date.now() };
  /* PUT 后确认失败时，事务恢复到 pv/pkeys 待确认态；不能撤销已送达的 PUT。 */
  applyLocal(merged, names, base, s, next);
  cloud = next;
  if (names.length) notifyApplied(names, false, s);
  requireSession(s);
  if (noteEl && noteEl.dataset.kind === 'size') note('');
  const last = ui && ui.querySelector('#cs-last');
  if (last) last.textContent = '上次同步 ' + new Date(cloud.lastSync).toLocaleString();
  else renderUI(true);   /* 只在刚登录时整块重绘，避免冲掉正在输入的内容 */
  setMsg(opts.silent ? '' : '✓ 已同步 ' + new Date().toLocaleTimeString());
  return { ok: true };
}
function schedule() {
  if (!cloud.token) return;
  const s = snapshot();
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => { if (sessionCurrent(s)) fullSync({ silent: true }); }, DEBOUNCE);
  if (dirtyTimer && dirtyTimer.unref) dirtyTimer.unref();
}

/* 合并结果已写回本机：通知页面就地重读；没人处理就提示刷新 */
function notifyApplied(keys, quiet, s) {
  if (s) requireSession(s);
  const real = keys.filter((k) => k !== META_KEY);
  if (!real.length || typeof window === 'undefined' || typeof CustomEvent !== 'function' || !window.dispatchEvent) return;
  const handled = !window.dispatchEvent(new CustomEvent('yzzn-sync-applied', { detail: { keys: real }, cancelable: true }));
  if (s) requireSession(s);
  if (quiet) return;
  if (handled) note('☁ 已合并其他设备的学习进度', { ttl: 5000 });
  else note('☁ 云端有更新，刷新页面后显示。', { reload: true });
}

/* 侦听写入：同步键变化后防抖 12 s 后台同步（setItem 与 removeItem 都算）。
   挂在 Storage.prototype 上并只响应 localStorage：直接给 localStorage 对象赋值 setItem 在 Chromium 里可行，
   但按 WebIDL 命名属性语义，别的引擎可能把它存成一个名叫 "setItem" 的条目。 */
function watchWrites() {
  const ls = localStorage;
  const touch = (k) => { if (cloud.token && (isSyncKey(k) || k === META_KEY)) schedule(); };
  const SP = typeof Storage === 'function' && Storage.prototype;
  if (SP && typeof SP.setItem === 'function' && ls instanceof Storage) {
    const set0 = SP.setItem, rm0 = SP.removeItem;
    rawSet = (k, v) => set0.call(ls, k, v);
    rawRemove = (k) => rm0.call(ls, k);
    SP.setItem = function (k, v) { set0.call(this, k, v); if (this === ls) touch(k); };
    SP.removeItem = function (k) { rm0.call(this, k); if (this === ls) touch(k); };
    /* 若有引擎把旧版的 localStorage.setItem = … 存成了条目，顺手清掉 */
    ['setItem', 'removeItem'].forEach((n) => {
      try { const v = ls.getItem(n); if (v && /^\(?k/.test(v)) rm0.call(ls, n); } catch (e) {}
    });
  } else {
    const set0 = ls.setItem.bind(ls), rm0 = ls.removeItem.bind(ls);
    rawSet = set0; rawRemove = rm0;
    ls.setItem = (k, v) => { set0(k, v); touch(k); };
    ls.removeItem = (k) => { rm0(k); touch(k); };
  }
}

/* ---------- 页面提示条（就是一行字，用现有样式） ---------- */
let noteEl = null, noteTimer = 0;
function note(text, opt) {
  if (typeof document === 'undefined') return;
  opt = opt || {};
  if (!noteEl) {
    if (!text) return;
    const anchor = document.querySelector('main.enx .enx-app');
    if (!anchor || !anchor.parentNode) return;
    noteEl = document.createElement('p');
    noteEl.id = 'cs-note';
    noteEl.className = 'mono enx-msg';
    noteEl.setAttribute('role', 'status');
    anchor.parentNode.insertBefore(noteEl, anchor);
  }
  clearTimeout(noteTimer);
  noteEl.textContent = text || '';
  noteEl.hidden = !text;
  noteEl.dataset.kind = /过大/.test(text || '') ? 'size' : '';
  if (text && opt.reload) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pie-btn mono';
    b.textContent = '刷新';
    b.addEventListener('click', () => location.reload());
    noteEl.append(' ', b);
  }
  if (text && opt.ttl) noteTimer = setTimeout(() => { if (noteEl) noteEl.hidden = true; }, opt.ttl);
}

/* ---------- 账号 ---------- */
async function auth(kind, u, p) {
  if (!u || !p) { setMsg('请输入用户名和密码'); return { ok: false }; }
  try { recoverLocal(snapshot()); } catch (e) { setMsg(e.message); return { ok: false }; }
  invalidateSession();   /* 最后发起的登录获胜；退出也会使尚未返回的登录作废 */
  const s = snapshot();
  setMsg('请稍候…');
  const res = await call(kind === 'reg' ? '/api/auth/register' : '/api/auth/login', 'POST', { u, p, dev: cloud.dev || undefined }, false, s);
  if (!sessionCurrent(s)) return { ok: false, cancelled: true };
  if (!res.ok || !res.body || !res.body.token) {
    setMsg((kind === 'reg' ? '注册失败：' : '登录失败：') + errText(res));
    return { ok: false };
  }
  const r = res.body;
  const uid = str(r.uid) || tokenUid(r.token);
  let replace = false;
  if (cloud.owner && cloud.owner !== uid && hasLearningData()) {
    const who = cloud.ownerName ? '账号「' + cloud.ownerName + '」' : '另一个账号';
    if (!confirm('本机现有的外语学习数据属于' + who + '。\n\n确定：把这些数据合并进「' + r.u + '」\n取消：不合并')) {
      if (!confirm('改用「' + r.u + '」的云端数据替换本机的外语学习数据吗？\n替换前会先下载一份本机数据的备份文件。\n\n确定：替换　取消：放弃登录（本机数据不变）')) {
        setMsg('已取消登录，本机数据未改动');
        return { ok: false, cancelled: true };
      }
      replace = true;
    }
  }
  let gone = [];
  const next = { token: r.token, u: str(r.u) || u, uid, lastSync: 0, owner: uid, ownerName: str(r.u) || u, dev: str(r.dev) || cloud.dev };
  try {
    requireSession(s);
    if (replace) {
      if (!doExport()) { setMsg('备份下载失败，为安全起见没有替换本机数据，也没有登录'); return { ok: false, cancelled: true }; }
      gone = wipeLocalLearning(s);
    }
    save(CK, next);   /* 单键写入成功后才接受新会话，失败不只改内存 */
  } catch (e) {
    setMsg('登录状态保存失败：' + e.message + (gone.length ? '；本机学习数据已按替换选择清空，可从刚导出的备份恢复。' : ''));
    return { ok: false };
  }
  invalidateSession();
  cloud = next;
  if (gone.length) notifyApplied(gone, true);
  note('');
  renderUI();
  return fullSync({});
}
function logout() {
  /* 本机数据保留，并记住它属于哪个账号（owner），下次换账号登录时会先询问 */
  const current = sessionCurrent(snapshot());
  invalidateSession();
  cloud.token = '';
  if (!current) {
    setMsg('另一页面已更换登录账号，本页已暂停；请刷新后操作。');
    note('另一页面已更换登录账号，本页已暂停，请刷新。', { reload: true });
    renderUI(true);
    return { ok: false, cancelled: true };   /* 不用旧标签页的 owner 覆盖当前 CK */
  }
  try { saveCloud(); } catch (e) { setMsg('本页已停止同步，但退出状态无法保存，请释放浏览器存储空间后重试。'); renderUI(true); return { ok: false }; }
  setMsg('已退出（本机数据保留）');
  renderUI(true);
}
async function logoutAll() {
  if (!confirm('让这个账号在所有设备上的登录全部失效？（包括本机，学习数据不受影响）')) return;
  const s = snapshot();
  const res = await call('/api/auth/logout', 'POST', { all: true }, true, s);
  if (!sessionCurrent(s)) return { ok: false, cancelled: true };
  if (!res.ok && res.status !== 401) { setMsg('操作失败：' + errText(res)); return; }
  if (logout()?.ok === false) return;
  setMsg('已退出全部设备');
}
async function deleteAccount(p) {
  if (!p) { setMsg('请输入密码确认'); return; }
  const s = snapshot();
  try {
    const recovered = recoverLocal(s);
    if (recovered.length) notifyApplied(recovered, true, s);
  } catch (e) { setMsg('注销前的本机恢复未完成：' + e.message); return { ok: false }; }
  const res = await call('/api/auth/delete', 'POST', { p }, true, s);
  if (!sessionCurrent(s)) return { ok: false, cancelled: true };
  if (!res.ok) { if (res.status !== 401) setMsg('注销失败：' + errText(res)); return; }
  let recoveryError = null;
  try {
    const recovered = recoverLocal(s);
    if (recovered.length) notifyApplied(recovered, true, s);
  } catch (e) { recoveryError = e; }
  if (!sessionCurrent(s)) return { ok: false, cancelled: true };
  invalidateSession();
  /* 请求期间产生的新日志若不能恢复，保留原归属供恢复，不能留下无主日志阻断后续登录。 */
  cloud = recoveryError ? { ...cloud, token: '', dev: '' } : { token: '', u: '', uid: '', lastSync: 0, owner: '', ownerName: '', dev: '' };
  try { saveCloud(); } catch (e) { setMsg('云端账号已注销，但本机退出状态无法保存，请释放浏览器存储空间后重试。'); renderUI(true); return; }
  if (recoveryError) {
    setMsg('云端账号已注销；本机恢复未完成，已停止同步并保留数据归属。' + recoveryError.message);
    note(recoveryError.message);
    renderUI(true);
    return { ok: false, recovery: true };
  }
  try { rawRemove(BK); } catch (e) {}
  renderUI(true);
  setMsg('账号已注销，云端数据已删除；本机数据保留');
}

/* ---------- 备份：只含外语学习数据与设置，去掉 AI Key 等机密 ---------- */
const SECRET_RE = /key|token|secret|pass/i;
function collectExport() {
  const keys = collect();
  lsKeys().forEach((k) => {
    if (!/^yzzn-(en|ja|ko|fr|de|es|it|ru)-cfg$/.test(k)) return;
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (!isPlainObject(v)) return;
      const c = {};
      Object.keys(v).forEach((f) => { if (!SECRET_RE.test(f)) c[f] = v[f]; });
      keys[k] = c;
    } catch (e) {}
  });
  return keys;
}
function doExport() {
  try {
    const blob = new Blob([JSON.stringify({ exported: Date.now(), keys: collectExport() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'yzzn-lang-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    setMsg('✓ 备份已下载（不含 AI Key）');
    return true;
  } catch (e) { setMsg('导出失败：' + e.message); return false; }
}
function doImport(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || !isPlainObject(d.keys)) throw new Error('格式不对');
      const now = Date.now();
      Object.keys(d.keys).forEach((k) => {
        if (!/^yzzn-/.test(k) || /^yzzn-cloud/.test(k) || k === META_KEY) return;
        let v = d.keys[k];
        if (/-words$/.test(k) && Array.isArray(v)) {
          /* 恢复备份 = 重新加入：打上当前时间，才不会被之前的删除 / 清空记录再删一遍 */
          v = v.map((e) => (isPlainObject(e) ? { ...e, mt: now } : e));
        } else if (/-cfg$/.test(k) && isPlainObject(v)) {
          const cur = load(k, {});
          v = { ...(isPlainObject(cur) ? cur : {}), ...v };   /* 备份里没有 Key：保留本机已有的 */
        }
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      });
      setMsg('✓ 已导入，刷新生效…');
      setTimeout(() => location.reload(), 600);
    } catch (e) { setMsg('导入失败：' + e.message); }
  };
  rd.readAsText(file);
}

/* ---------- 设置面板 UI ---------- */
let ui = null, healthChecked = false, keepMsg = '';
function setMsg(t) {
  keepMsg = t || '';
  const el = ui && ui.querySelector('#cs-msg');
  if (el) el.textContent = keepMsg;
}
function renderUI(keep) {
  if (!ui) return;
  const inner = cloud.token
    ? '<div class="enx-bar slim">' +
      '<span class="mono" style="color:var(--good);">☁ 已登录：' + esc(cloud.u) + '</span>' +
      '<span class="mono" id="cs-last" style="font-size:11px; color:var(--ink2);">' + (cloud.lastSync ? '上次同步 ' + new Date(cloud.lastSync).toLocaleString() : '') + '</span>' +
      '<span style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">' +
      '<button type="button" class="pie-btn mono" id="cs-sync">↻ 立即同步</button>' +
      '<button type="button" class="pie-btn mono" id="cs-logout">退出</button>' +
      '<button type="button" class="pie-btn mono" id="cs-logout-all">退出全部设备</button>' +
      '<button type="button" class="pie-btn mono" id="cs-del">注销账号</button></span></div>' +
      '<div class="enx-bar slim" id="cs-del-bar" hidden>' +
      '<input id="cs-del-p" class="mono" type="password" placeholder="输入密码确认注销" autocomplete="current-password" />' +
      '<button type="button" class="pie-btn mono" id="cs-del-go">确认注销并删除云端数据</button>' +
      '<button type="button" class="pie-btn mono" id="cs-del-no">取消</button></div>'
    : '<div class="enx-bar slim">' +
      '<input id="cs-u" class="mono" type="text" placeholder="用户名（3-20 位字母数字）" style="width:190px;" autocomplete="username" value="' + esc(cloud.u) + '" />' +
      '<input id="cs-p" class="mono" type="password" placeholder="密码（≥8 位）" style="width:150px;" autocomplete="current-password" />' +
      '<button type="button" class="pie-btn mono primary" id="cs-login">登录</button>' +
      '<button type="button" class="pie-btn mono" id="cs-reg">注册新账号</button></div>' +
      '<p class="mono" style="font-size:11px; color:var(--ink2); margin:4px 0 0;">可选功能。未登录时本页不连接任何同步服务器，学习数据只在本机。' +
      '登录后，本站各语言页的生词、复习进度、闯关星数会上传到同步服务器（EdgeOne 边缘函数）并在多设备间合并；' +
      'AI Key、语音偏好和词典缓存永不上传。</p>';
  ui.querySelector('#cs-body').innerHTML = inner +
    '<div class="enx-bar slim"><span class="mono enx-msg" id="cs-msg"></span></div>' +
    '<div class="enx-bar slim">' +
    '<button type="button" class="pie-btn mono" id="cs-export">⬇ 导出本地备份</button>' +
    '<button type="button" class="pie-btn mono" id="cs-import">⬆ 导入备份</button>' +
    '<input id="cs-file" type="file" accept="application/json" hidden /></div>';
  if (keep) setMsg(keepMsg); else setMsg('');
  const $u = (id) => ui.querySelector('#' + id);
  const on = (id, fn) => { const el = $u(id); if (el) el.addEventListener('click', fn); };
  on('cs-sync', () => fullSync({}));
  on('cs-logout', logout);
  on('cs-logout-all', logoutAll);
  on('cs-del', () => { const b = $u('cs-del-bar'); if (b) { b.hidden = false; $u('cs-del-p').focus(); } });
  on('cs-del-no', () => { const b = $u('cs-del-bar'); if (b) b.hidden = true; });
  on('cs-del-go', () => deleteAccount($u('cs-del-p').value));
  on('cs-login', () => auth('login', $u('cs-u').value.trim(), $u('cs-p').value));
  on('cs-reg', () => auth('reg', $u('cs-u').value.trim(), $u('cs-p').value));
  on('cs-export', doExport);
  on('cs-import', () => $u('cs-file').click());
  const f = $u('cs-file');
  if (f) f.addEventListener('change', doImport);
}
function checkHealth() {
  if (healthChecked) return;
  healthChecked = true;
  fetch(apiBase() + '/api/health').then((r) => r.json()).then((h) => {
    if (!h.ok) setMsg('云同步服务未就绪（' + (!h.kv ? 'KV 未绑定' : !h.secret ? '密钥未配置' : '运行时异常') + '）——本地功能不受影响');
  }).catch(() => setMsg('云同步服务暂不可达——本地功能不受影响'));
}
function mount() {
  const panel = document.querySelector('.enx-panel[data-p="set"]');
  if (!panel || document.getElementById('cs-card')) return;
  ui = document.createElement('div');
  ui.id = 'cs-card';
  ui.innerHTML = '<div class="enx-h" style="margin-top:18px;">云同步（可选）—— 注册账号，多设备合并学习进度</div><div id="cs-body"></div>';
  panel.appendChild(ui);
  renderUI();
  /* 服务状态检查只在打开「设置」时做一次（未登录不在页面加载时联网） */
  if (!panel.hidden) checkHealth();
  document.querySelectorAll('.enx-side button[data-p="set"]').forEach((b) => b.addEventListener('click', checkHealth));
}

(function init() {
  if (typeof document === 'undefined') return;
  try { sessionStorage.removeItem('yzzn-cs-reloaded'); } catch (e) {}
  let recovered = [];
  try { recovered = recoverLocal(snapshot()); cloud = readCloud(); saveCloud(); }
  catch (e) { setMsg(e.message); }
  watchWrites();
  const go = () => {
    mount();
    if (recovered.length) notifyApplied(recovered, true);
    if (cloud.token) fullSync({ silent: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();

/* 测试钩子（scripts/tests/lang.test.mjs 用，页面不调用） */
export const __test = {
  fullSync, auth, logout, logoutAll, deleteAccount, collect, collectExport, hasLearningData,
  getCloud: () => cloud,
  setCloud: (c) => { invalidateSession(); const next = { ...readCloud(), ...c }; save(CK, next); cloud = next; },
  reloadCloud: () => { invalidateSession(); cloud = readCloud(); return cloud; },
};
