/* 学习数据云同步：注册/登录（EdgeOne 边缘函数 + KV），多设备合并同步 + 本地导出导入
   - 同步范围：yzzn-* 键，排除设备本地项（*-cfg 含 AI Key/语音偏好）与缓存（en-ai / en-dict）
   - 合并策略：客户端合并——生词数组按词条取「rep 高者，平局 due 晚者」并集；
     其余结构递归：数字取 max、布尔取或、对象取键并集、等长数字数组逐位 max
   - 服务端只存整包（一人一键），冲突永远在客户端消解 */

const DEFAULT_API = 'https://yzzn-sync-lzgf3t47.edgeone.dev';
const CK = 'yzzn-cloud';
const EXCLUDE = /(-cfg$|^yzzn-en-ai$|^yzzn-en-dict$|^yzzn-cloud)/;

const $api = () => { try { return localStorage.getItem('yzzn-cloud-api') || DEFAULT_API; } catch (e) { return DEFAULT_API; } };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let cloud = load(CK, { token: '', u: '', lastSync: 0 });
let syncing = false;
let dirtyTimer = 0;

/* ---------- 采集与写回 ---------- */
function collect() {
  const keys = {};
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name || !name.startsWith('yzzn-') || EXCLUDE.test(name)) continue;
    try { keys[name] = JSON.parse(localStorage.getItem(name)); } catch (e) {}
  }
  return keys;
}
function collectAll() {   /* 导出备份用：含 cfg（是用户自己的文件） */
  const keys = {};
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name || !name.startsWith('yzzn-') || name.startsWith('yzzn-cloud')) continue;
    try { keys[name] = JSON.parse(localStorage.getItem(name)); } catch (e) {}
  }
  return keys;
}
function apply(keys) {
  Object.keys(keys).forEach((name) => {
    if (!name.startsWith('yzzn-') || name.startsWith('yzzn-cloud')) return;
    store(name, keys[name]);
  });
}

/* ---------- 合并 ---------- */
function mergeWords(a, b) {
  const map = new Map();
  const take = (arr) => (Array.isArray(arr) ? arr : []).forEach((it) => {
    if (!it || typeof it.w !== 'string') return;
    const old = map.get(it.w);
    if (!old) { map.set(it.w, it); return; }
    const ra = old.rep || 0, rb = it.rep || 0;
    if (rb > ra || (rb === ra && (it.due || 0) > (old.due || 0))) map.set(it.w, it);
  });
  take(a); take(b);
  return Array.from(map.values());
}
function mergeVal(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return a || b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length && a.every((x) => typeof x === 'number') && b.every((x) => typeof x === 'number')) {
      return a.map((x, i) => Math.max(x, b[i]));
    }
    return b.length > a.length ? b : a;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => { out[k] = mergeVal(a[k], b[k]); });
    return out;
  }
  return a;   /* 类型不一致：本地优先 */
}
function mergeKeys(local, remote) {
  const out = {};
  new Set(Object.keys(local).concat(Object.keys(remote))).forEach((name) => {
    if (name.endsWith('-words')) out[name] = mergeWords(local[name], remote[name]);
    else out[name] = mergeVal(local[name], remote[name]);
  });
  return out;
}

/* ---------- API ---------- */
async function req(path, opt) {
  const r = await fetch($api() + path, {
    ...opt,
    headers: {
      'content-type': 'application/json',
      ...(cloud.token ? { authorization: 'Bearer ' + cloud.token } : {}),
      ...(opt && opt.headers),
    },
  });
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (r.status === 401 && cloud.token) { cloud = { token: '', u: '', lastSync: 0 }; store(CK, cloud); renderUI(); }
  if (!r.ok) throw new Error((body && body.msg) || (body && body.error) || ('HTTP ' + r.status));
  return body;
}

async function fullSync(silent) {
  if (!cloud.token || syncing) return { changed: false };
  syncing = true;
  setMsg(silent ? '' : '同步中…');
  try {
    const remote = await req('/api/sync', { method: 'GET' });
    const local = collect();
    const merged = mergeKeys(local, (remote && remote.keys) || {});
    const changed = JSON.stringify(merged) !== JSON.stringify(local);
    apply(merged);
    await req('/api/sync', { method: 'PUT', body: JSON.stringify({ ts: Date.now(), keys: merged }) });
    cloud.lastSync = Date.now();
    store(CK, cloud);
    setMsg('✓ 已同步 ' + new Date().toLocaleTimeString());
    renderUI();
    return { changed };
  } catch (e) {
    setMsg('同步失败：' + e.message);
    return { changed: false };
  } finally {
    syncing = false;
  }
}

/* ---------- 变更侦听（防抖 12s 后台同步） ---------- */
function watchWrites() {
  const raw = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k, v) => {
    raw(k, v);
    if (cloud.token && typeof k === 'string' && k.startsWith('yzzn-') && !EXCLUDE.test(k)) {
      clearTimeout(dirtyTimer);
      dirtyTimer = setTimeout(() => fullSync(true), 12000);
    }
  };
}

/* ---------- UI ---------- */
let ui = null;
function setMsg(t) { const el = ui && ui.querySelector('#cs-msg'); if (el) el.textContent = t || ''; }
function renderUI() {
  if (!ui) return;
  const inner = cloud.token
    ? '<div class="enx-bar slim">' +
      '<span class="mono" style="color:var(--good);">☁ 已登录：' + esc(cloud.u) + '</span>' +
      (cloud.lastSync ? '<span class="mono" style="font-size:11px; color:var(--ink2);">上次同步 ' + new Date(cloud.lastSync).toLocaleString() + '</span>' : '') +
      '<span style="margin-left:auto; display:flex; gap:8px;">' +
      '<button type="button" class="pie-btn mono" id="cs-sync">↻ 立即同步</button>' +
      '<button type="button" class="pie-btn mono" id="cs-logout">退出</button></span></div>'
    : '<div class="enx-bar slim">' +
      '<input id="cs-u" class="mono" type="text" placeholder="用户名（3-20 位字母数字）" style="width:190px;" autocomplete="username" />' +
      '<input id="cs-p" class="mono" type="password" placeholder="密码（≥8 位）" style="width:150px;" autocomplete="current-password" />' +
      '<button type="button" class="pie-btn mono primary" id="cs-login">登录</button>' +
      '<button type="button" class="pie-btn mono" id="cs-reg">注册新账号</button></div>' +
      '<p class="mono" style="font-size:11px; color:var(--ink2); margin:4px 0 0;">同步生词/进度/星数（不上传 AI Key 与语音偏好）；登录后多设备自动合并。</p>';
  ui.querySelector('#cs-body').innerHTML = inner +
    '<div class="enx-bar slim"><span class="mono enx-msg" id="cs-msg"></span></div>' +
    '<div class="enx-bar slim">' +
    '<button type="button" class="pie-btn mono" id="cs-export">⬇ 导出本地备份</button>' +
    '<button type="button" class="pie-btn mono" id="cs-import">⬆ 导入备份</button>' +
    '<input id="cs-file" type="file" accept="application/json" hidden /></div>';
  const on = (id, fn) => { const el = ui.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
  on('cs-sync', () => fullSync(false).then((r) => { if (r.changed) location.reload(); }));
  on('cs-logout', () => { cloud = { token: '', u: '', lastSync: 0 }; store(CK, cloud); renderUI(); });
  on('cs-login', () => auth('/api/auth/login'));
  on('cs-reg', () => auth('/api/auth/register'));
  on('cs-export', doExport);
  on('cs-import', () => ui.querySelector('#cs-file').click());
  const f = ui.querySelector('#cs-file');
  if (f) f.addEventListener('change', doImport);
}
async function auth(path) {
  const u = ui.querySelector('#cs-u').value.trim();
  const p = ui.querySelector('#cs-p').value;
  if (!u || !p) { setMsg('请输入用户名和密码'); return; }
  setMsg('请稍候…');
  try {
    const r = await req(path, { method: 'POST', body: JSON.stringify({ u, p }) });
    cloud = { token: r.token, u: r.u, lastSync: 0 };
    store(CK, cloud);
    renderUI();
    const s = await fullSync(false);
    if (s.changed) location.reload();
  } catch (e) {
    setMsg((path.includes('register') ? '注册失败：' : '登录失败：') + e.message);
  }
}
function doExport() {
  const blob = new Blob([JSON.stringify({ exported: Date.now(), keys: collectAll() }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'yzzn-lang-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setMsg('✓ 备份已下载');
}
function doImport(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d || typeof d.keys !== 'object') throw new Error('格式不对');
      apply(d.keys);
      setMsg('✓ 已导入，刷新生效…');
      setTimeout(() => location.reload(), 600);
    } catch (e) { setMsg('导入失败：' + e.message); }
  };
  rd.readAsText(file);
}

function mount() {
  const panel = document.querySelector('.enx-panel[data-p="set"]');
  if (!panel || document.getElementById('cs-card')) return;
  ui = document.createElement('div');
  ui.id = 'cs-card';
  ui.innerHTML = '<div class="enx-h" style="margin-top:18px;">云同步 —— 注册账号，多设备合并学习进度</div><div id="cs-body"></div>';
  panel.appendChild(ui);
  renderUI();
  /* 服务端就绪检查（未配置时给出明确状态） */
  fetch($api() + '/api/health').then((r) => r.json()).then((h) => {
    if (!h.ok) setMsg('云同步服务未就绪（' + (!h.kv ? 'KV 未绑定' : !h.secret ? '密钥未配置' : '运行时异常') + '）——本地功能不受影响');
  }).catch(() => setMsg('云同步服务暂不可达——本地功能不受影响'));
}

(function init() {
  if (typeof document === 'undefined') return;
  watchWrites();
  const go = () => {
    mount();
    /* 上次为套用云端数据刷新过：8 秒后解除旗标，避免连环刷新 */
    if (sessionStorage.getItem('yzzn-cs-reloaded')) {
      setTimeout(() => sessionStorage.removeItem('yzzn-cs-reloaded'), 8000);
    }
    if (cloud.token) {
      fullSync(true).then((r) => {
        if (r.changed && !sessionStorage.getItem('yzzn-cs-reloaded')) {
          sessionStorage.setItem('yzzn-cs-reloaded', '1');
          location.reload();
        }
      });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
