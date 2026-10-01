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
const MAX_BYTES = 512 * 1024;     /* 与服务端一致：请求体字节数上限 */
const LEGACY_MAX_CHARS = 300 * 1024;
const DEBOUNCE = 12000;

let rawSet = (k, v) => localStorage.setItem(k, v);
let rawRemove = (k) => localStorage.removeItem(k);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { rawSet(k, JSON.stringify(v)); } catch (e) {} };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const str = (v) => (typeof v === 'string' ? v : '');

let cloud = readCloud();
let syncing = false, again = false, dirtyTimer = 0;

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
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } } catch (e) {}
  return out;
}
function collect() {
  const keys = {};
  lsKeys().forEach((k) => {
    if (!isSyncKey(k) && k !== META_KEY) return;
    try { const v = JSON.parse(localStorage.getItem(k)); if (v != null) keys[k] = v; } catch (e) {}
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
function applyLocal(merged, names) {
  names.forEach((k) => {
    try {
      if (merged[k] === undefined) rawRemove(k);
      else rawSet(k, JSON.stringify(merged[k]));
    } catch (e) { /* 配额满：这一键留到下次 */ }
  });
}
function wipeLocalLearning() {
  const gone = lsKeys().filter((k) => isSyncKey(k) || k === META_KEY);
  gone.forEach((k) => { try { rawRemove(k); } catch (e) {} });
  try { rawRemove(BK); } catch (e) {}
  notifyApplied(gone, true);
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
async function call(path, method, body, auth) {
  let r;
  try {
    r = await fetch(apiBase() + path, {
      method,
      headers: { 'content-type': 'application/json', ...(auth && cloud.token ? { authorization: 'Bearer ' + cloud.token } : {}) },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
  } catch (e) { return { status: 0, ok: false, body: null }; }
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && auth && cloud.token) sessionLost();
  return { status: r.status, ok: r.ok, body: j };
}
const errText = (res) => (res.body && (res.body.msg || res.body.error)) || (res.status ? 'HTTP ' + res.status : '网络不可达');
function sessionLost() {
  cloud.token = '';
  saveCloud();
  clearTimeout(dirtyTimer);
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
  if (syncing) { again = true; return { ok: false, busy: true }; }
  syncing = true;
  if (!opts.silent) setMsg('同步中…');
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const g = await call('/api/sync', 'GET', undefined, true);
      if (!g.ok) throw new Error(errText(g));
      const rec = isPlainObject(g.body) ? g.body : {};
      const legacyServer = !('v' in rec);
      const remote = await decodeRemote(rec);
      let base = loadBase();
      if (base && base.pv && base.pv === rec.v) base = { uid: cloud.uid, v: base.pv, keys: base.pkeys || {} };   /* 上次的写入其实成功了 */
      const local = collect();
      const res = mergeAll(local, remote, base ? base.keys : null, Date.now());
      const merged = res.keys;
      const lc = changedNames(local, merged);
      if (lc.length) { applyLocal(merged, lc); notifyApplied(lc); }
      /* 本机此刻已包含这次用到的云端计数：公共祖先前移 */
      save(BK, { uid: cloud.uid, v: rec.v, keys: counterSnapshot(res.remoteUsed) });
      const foreign = Object.keys(remote).some((k) => !isSyncKey(k) && k !== META_KEY);
      const needPut = legacyServer || rec.fmt !== 2 || foreign || changedNames(remote, merged).length > 0;
      if (!needPut) return done(opts);
      let body, nv = '';
      if (legacyServer) {
        body = JSON.stringify({ ts: Date.now(), keys: merged });
        if (body.length > LEGACY_MAX_CHARS) { tooLarge(body.length, LEGACY_MAX_CHARS); return { ok: false }; }
      } else {
        nv = newVersion();
        body = JSON.stringify({ fmt: 2, base: rec.v, v: nv, ts: Date.now(), ...(await encodeKeys(merged)) });
        const n = byteLen(body);
        if (n > MAX_BYTES) { tooLarge(n, MAX_BYTES); return { ok: false }; }
        save(BK, { uid: cloud.uid, v: rec.v, keys: counterSnapshot(res.remoteUsed), pv: nv, pkeys: counterSnapshot(merged) });
      }
      const p = await call('/api/sync', 'PUT', body, true);
      if (p.status === 409 && p.body && p.body.error === 'conflict') continue;   /* 别的设备刚写过：重新合并 */
      if (p.status === 413) { tooLarge(byteLen(body), (p.body && p.body.limit) || MAX_BYTES); return { ok: false }; }
      if (!p.ok) throw new Error(errText(p));
      save(BK, { uid: cloud.uid, v: (p.body && p.body.v) || nv || undefined, keys: counterSnapshot(merged) });
      return done(opts);
    }
    throw new Error('云端数据一直在变化，稍后再试');
  } catch (e) {
    setMsg('同步失败：' + (e && e.message || e));
    return { ok: false };
  } finally {
    syncing = false;
    if (again) { again = false; schedule(); }
  }
}
function done(opts) {
  cloud.lastSync = Date.now();
  saveCloud();
  if (noteEl && noteEl.dataset.kind === 'size') note('');
  const last = ui && ui.querySelector('#cs-last');
  if (last) last.textContent = '上次同步 ' + new Date(cloud.lastSync).toLocaleString();
  else renderUI(true);   /* 只在刚登录时整块重绘，避免冲掉正在输入的内容 */
  setMsg(opts.silent ? '' : '✓ 已同步 ' + new Date().toLocaleTimeString());
  return { ok: true };
}
function schedule() {
  if (!cloud.token) return;
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => fullSync({ silent: true }), DEBOUNCE);
  if (dirtyTimer && dirtyTimer.unref) dirtyTimer.unref();
}

/* 合并结果已写回本机：通知页面就地重读；没人处理就提示刷新 */
function notifyApplied(keys, quiet) {
  const real = keys.filter((k) => k !== META_KEY);
  if (!real.length || typeof window === 'undefined' || typeof CustomEvent !== 'function' || !window.dispatchEvent) return;
  const handled = !window.dispatchEvent(new CustomEvent('yzzn-sync-applied', { detail: { keys: real }, cancelable: true }));
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
  setMsg('请稍候…');
  const res = await call(kind === 'reg' ? '/api/auth/register' : '/api/auth/login', 'POST', { u, p, dev: cloud.dev || undefined }, false);
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
  if (replace) {
    if (!doExport()) { setMsg('备份下载失败，为安全起见没有替换本机数据，也没有登录'); return { ok: false, cancelled: true }; }
    wipeLocalLearning();
  }
  cloud = { token: r.token, u: str(r.u) || u, uid, lastSync: 0, owner: uid, ownerName: str(r.u) || u, dev: str(r.dev) || cloud.dev };
  saveCloud();
  note('');
  renderUI();
  return fullSync({});
}
function logout() {
  /* 本机数据保留，并记住它属于哪个账号（owner），下次换账号登录时会先询问 */
  clearTimeout(dirtyTimer);
  cloud.token = '';
  saveCloud();
  setMsg('已退出（本机数据保留）');
  renderUI(true);
}
async function logoutAll() {
  if (!confirm('让这个账号在所有设备上的登录全部失效？（包括本机，学习数据不受影响）')) return;
  const res = await call('/api/auth/logout', 'POST', { all: true }, true);
  if (!res.ok && res.status !== 401) { setMsg('操作失败：' + errText(res)); return; }
  logout();
  setMsg('已退出全部设备');
}
async function deleteAccount(p) {
  if (!p) { setMsg('请输入密码确认'); return; }
  const res = await call('/api/auth/delete', 'POST', { p }, true);
  if (!res.ok) { if (res.status !== 401) setMsg('注销失败：' + errText(res)); return; }
  clearTimeout(dirtyTimer);
  cloud = { token: '', u: '', uid: '', lastSync: 0, owner: '', ownerName: '', dev: '' };
  saveCloud();
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
  saveCloud();
  watchWrites();
  const go = () => {
    mount();
    if (cloud.token) fullSync({ silent: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();

/* 测试钩子（scripts/tests/lang.test.mjs 用，页面不调用） */
export const __test = {
  fullSync, auth, logout, collect, collectExport, hasLearningData,
  getCloud: () => cloud,
  setCloud: (c) => { cloud = { ...readCloud(), ...c }; saveCloud(); },
  reloadCloud: () => { cloud = readCloud(); return cloud; },
};
