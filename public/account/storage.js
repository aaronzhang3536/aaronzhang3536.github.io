(function () {
  'use strict';
  const core = window.WOFCore, config = window.WOF_CONFIG, disk = window.localStorage;
  if (!core || !config) throw new Error('账号配置加载失败');
  for (const endpoint of [config.api, config.auth]) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('账号接口必须使用 HTTPS');
  }
  const prefix = 'wof-account-v1:' + encodeURIComponent(config.api + '|' + config.app) + ':';
  const sessionKey = prefix + 'session';
  const initial = disk.getItem(sessionKey);
  let session;
  try { session = JSON.parse(initial || 'null'); } catch { session = null; }
  const owner = session && Number.isSafeInteger(session.uid) ? String(session.uid) : 'guest';
  const dataKey = prefix + 'data:' + owner;
  const editPrefix = dataKey + ':edit:';
  let error = '', stale = false;
  function report(message) { error = message; window.dispatchEvent(new CustomEvent('wof-status', { detail: message })); }
  function guard() {
    if (stale) throw new Error('另一页面已更新存档，请刷新后继续。');
    if (disk.getItem(sessionKey) !== initial) {
      report('账号已在另一页面变更，请刷新后继续。');
      throw new Error('账号已变更');
    }
  }
  function read() {
    guard();
    const raw = disk.getItem(dataKey);
    let state;
    if (raw) {
      state = JSON.parse(raw);
      if (!state || !state.values || !state.base || !Number.isSafeInteger(state.version)) throw new Error('本机存档损坏，请先导出原始备份');
    } else state = core.empty();
    if (!raw && owner === 'guest') {
      for (let i = 0; i < disk.length; i++) {
        const key = disk.key(i);
        if (core.syncKey(key) || core.privateKey(key)) state.values[key] = disk.getItem(key);
      }
    }
    // Each local edit has its own atomic key. A concurrent snapshot commit cannot
    // overwrite an edit appended by another tab between read() and write().
    const edits = [];
    for (let i = 0; i < disk.length; i++) {
      const id = disk.key(i);
      if (!id.startsWith(editPrefix)) continue;
      const edit = JSON.parse(disk.getItem(id));
      if (!(core.syncKey(edit.key) || core.privateKey(edit.key)) || !(edit.value === null || typeof edit.value === 'string') || !Number.isSafeInteger(edit.clock)) throw new Error('本机待保存记录损坏，请先保留原始备份');
      edits.push({ ...edit, id });
    }
    state.applied = (state.applied || []).filter(id => disk.getItem(id) !== null);
    state.edits = edits.map(e => e.id);
    edits.sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
    for (const edit of edits) {
      if (!state.applied.includes(edit.id)) state.values[edit.key] = edit.value;
      state.clock = Math.max(state.clock || 0, edit.clock);
    }
    return state;
  }
  function write(state, notify = true) {
    guard();
    const captured = [...new Set([...(state.applied || []), ...(state.edits || [])])];
    const next = { ...state, applied: captured }; delete next.edits;
    try { disk.setItem(dataKey, JSON.stringify(next)); }
    catch (e) { report('本机保存失败，修改尚未保存。请释放浏览器存储空间后重试。'); throw e; }
    // A failed cleanup is harmless: the committed snapshot records which edits
    // were incorporated, so they cannot be applied twice after restart.
    for (const id of captured) { try { disk.removeItem(id); } catch {} }
    if (notify) window.dispatchEvent(new Event('wof-dirty'));
  }
  function edit(key, value) {
    const state = read();
    if (core.same(state.values[key], value)) return;
    const clock = Math.max(Date.now() * 1000, (state.clock || 0) + 1);
    try { disk.setItem(editPrefix + crypto.randomUUID(), JSON.stringify({ key, value, clock })); }
    catch (e) { report('本机保存失败，修改尚未保存。请释放浏览器存储空间后重试。'); throw e; }
    // Retain only the newest absolute value for this key among edits we observed.
    // Edits added concurrently have different IDs and are never removed here.
    for (const id of state.edits || []) {
      try { if (JSON.parse(disk.getItem(id) || 'null')?.key === key) disk.removeItem(id); } catch {}
    }
    window.dispatchEvent(new Event('wof-dirty'));
  }
  const facade = {
    getItem(key) { key = String(key); return core.syncKey(key) || core.privateKey(key) ? (read().values[key] ?? null) : disk.getItem(key); },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (!core.syncKey(key) && !core.privateKey(key)) return disk.setItem(key, value);
      edit(key, value);
    },
    removeItem(key) {
      key = String(key);
      if (!core.syncKey(key) && !core.privateKey(key)) return disk.removeItem(key);
      edit(key, null);
    },
    key(i) { return keys()[i] ?? null; },
    get length() { return keys().length; }
  };
  function keys() {
    const list = Object.keys(read().values).filter(k => read().values[k] !== null);
    for (let i = 0; i < disk.length; i++) {
      const key = disk.key(i);
      if (!key.startsWith('wof-account-v1:') && !core.syncKey(key) && !core.privateKey(key)) list.push(key);
    }
    return list;
  }
  window.WOFStorage = facade;
  window.WOFAccount = { config, core, disk, prefix, sessionKey, initial, session, owner, dataKey, read, write, guard, report, get error() { return error; } };
  window.addEventListener('storage', e => {
    if (e.key === sessionKey) { report('账号已在另一页面变更，正在重新载入。'); location.reload(); }
    else if (e.key === dataKey || e.key?.startsWith(editPrefix)) {
      let changed = e.key !== dataKey && e.newValue !== null;
      if (e.key === dataKey) {
        try {
          const before = JSON.parse(e.oldValue || '{}').values || {}, after = JSON.parse(e.newValue || '{}').values || {};
          changed = Object.keys({ ...before, ...after }).some(k => !core.same(before[k], after[k]));
        } catch { changed = true; }
      }
      if (changed) { stale = true; window.dispatchEvent(new Event('wof-other-tab')); location.reload(); }
    }
  });
})();
