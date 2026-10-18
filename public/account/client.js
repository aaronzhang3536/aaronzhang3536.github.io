(function () {
  'use strict';
  const a = window.WOFAccount;
  if (!a) return;
  const { core, config, disk } = a;
  let busy = false, timer, conflict = null, sequence = 0;
  const status = document.createElement('a');
  status.href = '/account/'; status.id = 'wof-account-status'; status.setAttribute('role', 'status');
  status.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9000;max-width:min(420px,90vw);padding:10px 14px;border:1px solid #708090;border-radius:8px;background:#17202c;color:#fff;font:13px/1.5 system-ui;text-decoration:none;box-shadow:0 3px 12px #0003';
  document.body.append(status);
  function say(message) { status.textContent = message; const el = document.querySelector('#account-message'); if (el) el.textContent = message; }
  say(a.error || (a.session?.token ? '账号已登录 · 正在核对云端数据' : a.owner === 'guest' ? '访客 · 数据仅保存在本机 · 登录同步' : '登录已过期 · 本机修改已保留，请重新登录'));
  window.addEventListener('wof-status', e => say(e.detail));
  function current() { a.guard(); }
  async function request(path, options = {}, authBase = false, token = a.session?.token) {
    current();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 18000);
    let response;
    try {
      response = await fetch((authBase ? config.auth : config.api) + path, {
        ...options, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers }
      });
    } catch (e) { throw new Error(navigator.onLine === false ? '当前断网，修改已保存在本机，联网后重试。' : '连接失败，修改已保存在本机；未确认的请求会安全重试。'); }
    finally { clearTimeout(timeout); }
    current();
    let body;
    try { body = await response.json(); } catch { throw new Error('服务返回异常，尚未确认保存。'); }
    if (response.status === 401 && token === a.session?.token && a.session?.token) {
      disk.setItem(a.sessionKey, JSON.stringify({ ...a.session, token: '', expired: true }));
      location.reload();
      throw new Error('登录已过期，请重新登录；本机修改已保留。');
    }
    if (!response.ok && (response.status !== 409 || authBase)) throw new Error(body.error || '请求失败：' + response.status);
    return { body, status: response.status };
  }
  const statePath = '/apps/' + config.app + '/state';
  function valueEqual(x, y) { return !Object.keys({ ...x, ...y }).some(k => !core.same(x[k], y[k])); }
  async function syncLocked() {
    current();
    if (!a.session?.token) return;
    if (Date.parse(a.session.expires_at) <= Date.now()) {
      disk.setItem(a.sessionKey, JSON.stringify({ ...a.session, token: '', expired: true })); location.reload(); return;
    }
    say('正在同步…');
    // A durable pending request is retried verbatim, before taking a new cloud snapshot.
    let state = a.read();
    if (state.pending) {
      const sent = state.pending;
      const response = await request(statePath, { method: 'PUT', body: JSON.stringify(sent) });
      state = a.read();
      if (response.status === 200) {
        state.base = sent.values; state.version = response.body.version; state.pending = null;
        a.write(state, false);
      } else { state.pending = null; a.write(state, false); }
    }
    const { body: remote } = await request(statePath);
    if (!Number.isSafeInteger(remote.version) || !remote.values || Object.entries(remote.values).some(([k, v]) => !core.syncKey(k) || (v !== null && typeof v !== 'string'))) throw new Error('云端数据格式异常，未覆盖本机。');
    state = a.read();
    const local = core.cloudValues(state.values), merged = core.merge(state.base, local, remote.values);
    if (merged.conflicts.length) {
      conflict = { remote, keys: merged.conflicts };
      say('两台设备修改了相同数据，已保留双方版本。请到账号页处理冲突。');
      renderConflict(); return;
    }
    const changed = !valueEqual(local, merged.values);
    state.values = { ...state.values, ...merged.values }; state.base = remote.values; state.version = remote.version;
    if (!valueEqual(merged.values, remote.values)) {
      state.pending = { base: remote.version, operation_id: crypto.randomUUID(), values: merged.values };
      a.write(state, false);
      const sent = state.pending;
      const result = await request(statePath, { method: 'PUT', body: JSON.stringify(sent) });
      if (result.status === 409) { schedule(250); say('云端发生新修改，正在重新核对。'); return; }
      state = a.read(); state.base = sent.values; state.version = result.body.version; state.pending = null;
    }
    state.lastSync = Date.now(); a.write(state, false);
    say('已同步 · ' + (a.session.username || '账号') + ' · ' + new Date(state.lastSync).toLocaleTimeString());
    conflict = null; renderConflict();
    // Reload only after the complete local snapshot is committed, keeping module memory in sync.
    if (changed) location.reload();
    else if (!valueEqual(core.cloudValues(a.read().values), state.base)) schedule(1200);
  }
  async function sync() {
    if (busy || !a.session?.token) return;
    busy = true;
    try {
      if (!navigator.locks) throw new Error('此浏览器不支持安全的多页面同步，请使用新版浏览器。');
      await navigator.locks.request(a.prefix + 'sync', syncLocked);
    } catch (e) { say(e.message); }
    finally { busy = false; }
  }
  function schedule(ms = 1800) { clearTimeout(timer); timer = setTimeout(sync, ms); }
  window.addEventListener('wof-dirty', () => { say(a.session?.token ? '本机已保存 · 等待同步' : '本机已保存 · 登录后可同步'); schedule(); });
  window.addEventListener('wof-other-tab', () => { say('另一页面更新了存档，请刷新以读取最新数据。'); });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('offline', () => say('当前断网 · 修改保存在本机，联网后同步'));
  function download(values, name = 'within-one-frame-backup') {
    const blob = new Blob([JSON.stringify({ app: config.app, exported_at: new Date().toISOString(), values: core.cloudValues(values) }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  }
  function renderConflict() {
    const box = document.querySelector('#account-conflict');
    if (box) box.hidden = !conflict;
  }
  async function resolveConflict(useLocal) {
    if (!conflict) return;
    if (!confirm('将先下载本机备份，再' + (useLocal ? '用本机版本覆盖冲突项。' : '使用云端版本替换冲突项。'))) return;
    download(a.read().values, 'within-one-frame-before-conflict');
    const state = a.read();
    const merged = core.merge(state.base, core.cloudValues(state.values), conflict.remote.values);
    for (const key of conflict.keys) merged.values[key] = useLocal ? state.values[key] ?? null : conflict.remote.values[key] ?? null;
    state.values = { ...state.values, ...merged.values }; state.base = conflict.remote.values; state.version = conflict.remote.version; state.pending = null;
    a.write(state, false); conflict = null; await sync(); location.reload();
  }
  const form = document.querySelector('#account-login');
  if (form) {
    document.querySelector('#account-identity').textContent = a.session ? a.session.username + (a.session.token ? ' · 已登录' : ' · 需要重新登录') : '访客';
    form.hidden = !!a.session?.token;
    document.querySelector('#account-logout').hidden = a.owner === 'guest';
    document.querySelector('#account-import-guest').hidden = !a.session?.token;
    document.querySelector('#account-admin').href = config.admin;
    form.addEventListener('submit', async e => {
      e.preventDefault(); const attempt = ++sequence;
      const button = e.submitter, mode = button?.value === 'register' ? 'register' : 'login';
      const fd = new FormData(form); say('正在' + (mode === 'register' ? '注册' : '登录') + '…');
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      try {
        const { body } = await request('/' + mode, { method: 'POST', body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), product: config.app }) }, true, null);
        if (attempt !== sequence) return;
        const { body: user } = await request('/me', {}, true, body.token);
        if (!body.token || !Number.isSafeInteger(user.id) || !Number.isFinite(Date.parse(body.expires_at))) throw new Error('登录返回格式异常');
        current(); disk.setItem(a.sessionKey, JSON.stringify({ token: body.token, uid: user.id, username: user.username, expires_at: body.expires_at }));
        location.reload();
      } catch (error) { say(error.message); }
      finally { form.querySelector('input[type=password]').value = ''; for (const b of form.querySelectorAll('button')) b.disabled = false; }
    });
    document.querySelector('#account-logout').addEventListener('click', async () => {
      sequence++;
      try { if (a.session?.token) await request('/logout', { method: 'POST', body: '{}' }, true); }
      catch (error) { say('服务端退出失败：' + error.message + ' 可联网后重试，或选择仅退出本机。'); document.querySelector('#account-local-logout').hidden = false; return; }
      current(); disk.removeItem(a.sessionKey); location.reload();
    });
    document.querySelector('#account-local-logout').addEventListener('click', () => { current(); disk.removeItem(a.sessionKey); location.reload(); });
    document.querySelector('#account-sync').addEventListener('click', sync);
    document.querySelector('#account-export').addEventListener('click', () => download(a.read().values));
    document.querySelector('#account-import-file').addEventListener('change', async e => {
      try {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 3 * 1024 * 1024) throw new Error('备份文件超过 3 MiB');
        const payload = JSON.parse(await file.text());
        const source = payload.values || (payload.keys && Object.fromEntries(Object.entries(payload.keys).map(([k, v]) => [k, JSON.stringify(v)])));
        if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('备份格式不正确');
        const values = core.cloudValues(source);
        if (Object.values(values).some(v => v !== null && typeof v !== 'string')) throw new Error('备份值格式不正确');
        if (!confirm('确认将此备份中的业务数据导入当前账号/访客区？同名数据会替换；将先下载现有数据备份。')) return;
        const state = a.read(); download(state.values, 'within-one-frame-before-import');
        state.values = { ...state.values, ...values }; a.write(state); location.reload();
      } catch (error) { say('导入失败：' + error.message); }
      finally { e.target.value = ''; }
    });
    document.querySelector('#account-cloud-choice').addEventListener('click', () => resolveConflict(false));
    document.querySelector('#account-local-choice').addEventListener('click', () => resolveConflict(true));
    document.querySelector('#account-import-guest').addEventListener('click', () => {
      if (!confirm('将本浏览器访客区的业务数据复制到当前账号；同名数据会替换。请确认这些数据属于你。AI Key 和设备设置不会导入。')) return;
      const state = a.read(); download(state.values, 'within-one-frame-before-import');
      const guestRaw = disk.getItem(a.prefix + 'data:guest');
      let values = {};
      if (guestRaw) values = JSON.parse(guestRaw).values;
      else for (let i = 0; i < disk.length; i++) { const k = disk.key(i); if (core.syncKey(k)) values[k] = disk.getItem(k); }
      state.values = { ...state.values, ...core.cloudValues(values) }; a.write(state); location.reload();
    });
    const tbody = document.querySelector('#account-records');
    for (const [key, value] of Object.entries(core.cloudValues(a.read().values)).filter(([, v]) => v !== null)) {
      const row = document.createElement('tr'), name = document.createElement('td'), amount = document.createElement('td'), action = document.createElement('td'), del = document.createElement('button');
      name.textContent = core.label(key); amount.textContent = new Blob([value]).size + ' B'; del.textContent = '删除'; del.type = 'button';
      del.addEventListener('click', () => { if (confirm('删除此类数据，并在下次同步时删除云端版本？')) { window.WOFStorage.removeItem(key); location.reload(); } });
      action.append(del); row.append(name, amount, action); tbody.append(row);
    }
  }
  if (a.session?.token) {
    request('/me', {}, true).then(({ body }) => { if (body.id !== a.session.uid) throw new Error('会话身份不一致，已停止同步'); return sync(); }).catch(e => say(e.message));
  }
})();
