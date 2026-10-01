/* 外语中心各页面共用的小工具：本地日期、删除墓碑 / 清空标记、云同步合并后的通知。
   english.js / eastasian.js / cloudsync.js 共用；合并规则本身见 synccore.js。 */
import { META_KEY, normMeta, pruneMeta, entryId } from './synccore.js';

/* 「今天」按本地时区算（以前用 toISOString 的 UTC 日期，北京时间早上 8 点才换日） */
export function localDay(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* 旧数据用 UTC 日期做键：本地某天的一部分活动记在了相邻的 UTC 日期上（东八区记在前一天）。
   返回本地日期 d 在旧格式下可能对应的另一个键；UTC 时区返回 '' */
export function legacyAltDay(d) {
  const off = d.getTimezoneOffset();
  if (!off) return '';
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + (off < 0 ? -1 : 1));
  return localDay(x);
}

function readMeta() {
  try { return normMeta(JSON.parse(localStorage.getItem(META_KEY))); } catch (e) { return normMeta(null); }
}
function writeMeta(m) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
}
/* 用户主动删除词条：记墓碑，让其他设备同步时也删掉（而不是把它复活） */
export function noteDelete(key, w, now) {
  now = now || Date.now();
  const m = readMeta();
  const id = entryId(key, w);
  if (id === '__proto__') return;
  m.del[key] = m.del[key] || {};
  m.del[key][id] = now;
  writeMeta(pruneMeta(m, now));
}
/* 用户主动清空若干键：记清空时间，其他设备上更早的数据同步时一并清掉 */
export function noteWipe(keys, now) {
  now = now || Date.now();
  const m = readMeta();
  keys.forEach((k) => { m.wipe[k] = now; delete m.del[k]; });
  writeMeta(m);
}
/* 云同步把合并结果写回 localStorage 后会派发 yzzn-sync-applied（detail.keys = 变化的键）。
   页面在回调里重新读取内存状态；回调返回 false 表示没处理，cloudsync 会提示用户刷新。 */
export function onSyncApplied(fn) {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  window.addEventListener('yzzn-sync-applied', (e) => {
    let handled = false;
    try { handled = fn((e.detail && e.detail.keys) || []) !== false; } catch (err) { handled = false; }
    if (handled) e.preventDefault();
  });
}
