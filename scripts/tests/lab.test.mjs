/* 实验室公共护栏（src/scripts/lab/_kit.js）的行为测试：用假的 DOM / rAF / 观察者驱动，不需要浏览器。
   运行：node --test scripts/tests/lab.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, boot, luminance, NO_WEBGPU } from '../../src/scripts/lab/_kit.js';

function env(opts = {}) {
  const docListeners = {};
  let rafQ = [], rafId = 0, ioCb = null, roCb = null;
  globalThis.requestAnimationFrame = (cb) => { rafQ.push({ id: ++rafId, cb }); return rafId; };
  globalThis.cancelAnimationFrame = (id) => { rafQ = rafQ.filter((r) => r.id !== id); };
  globalThis.IntersectionObserver = class { constructor(cb) { ioCb = cb; } observe() {} disconnect() { ioCb = null; } };
  globalThis.ResizeObserver = class { constructor(cb) { roCb = cb; } observe() {} disconnect() { roCb = null; } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.devicePixelRatio = opts.dpr || 1;
  const el = () => ({ textContent: '', hidden: true, style: {} });
  const hud = el();
  const note = opts.noNote ? null : el();
  const parent = { clientWidth: opts.parentW || 920 };
  /* border-box + 1px 边框：内容盒 = CSS 尺寸 − 2 */
  const cvs = {
    isConnected: true, style: {}, parentElement: parent, width: 300, height: 150,
    get clientWidth() { return this.style.display === 'none' ? 0 : parseInt(this.style.width, 10) - 2; },
    get clientHeight() { return this.style.display === 'none' ? 0 : parseInt(this.style.height, 10) - 2; },
  };
  globalThis.document = {
    hidden: !!opts.hidden,
    getElementById: (id) => ({ 'lab-cv': cvs, 'lab-hud': hud, 'lab-nogpu': note })[id] || null,
    addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
    removeEventListener: (t, f) => { docListeners[t] = (docListeners[t] || []).filter((g) => g !== f); },
  };
  return {
    cvs, hud, note, parent,
    frame(ts) { const q = rafQ; rafQ = []; q.forEach((r) => r.cb(ts)); },
    pending: () => rafQ.length,
    io(v) { if (ioCb) ioCb([{ isIntersecting: v }]); },
    ro() { if (roCb) roCb([]); },
    setHidden(v) { globalThis.document.hidden = v; (docListeners.visibilitychange || []).forEach((f) => f()); },
    listeners: (t) => (docListeners[t] || []).length,
  };
}

test('帧循环：逐帧运行，首帧前调用 onStart', () => {
  const e = env();
  const lab = createLab(e.cvs);
  const seen = [], starts = [];
  lab.loop((ts) => seen.push(ts), (ts) => starts.push(ts));
  e.frame(16); e.frame(32); e.frame(48);
  assert.deepEqual(seen, [16, 32, 48]);
  assert.deepEqual(starts, [16]);
  assert.equal(e.pending(), 1);
});

test('帧循环：画布离屏即停止续约，回到视口恢复并重新 onStart', () => {
  const e = env();
  const lab = createLab(e.cvs);
  const seen = [], starts = [];
  lab.loop((ts) => seen.push(ts), (ts) => starts.push(ts));
  e.frame(16);
  e.io(false);
  e.frame(32);                 /* 已排的那一帧到点后发现离屏：不执行、不续约 */
  assert.equal(e.pending(), 0);
  e.frame(48);
  assert.deepEqual(seen, [16]);
  e.io(true);
  assert.equal(e.pending(), 1);
  e.frame(5000);
  assert.deepEqual(seen, [16, 5000]);
  assert.deepEqual(starts, [16, 5000]);   /* 恢复时重置计时基准，dt 不会跨越暂停期 */
});

test('帧循环：标签页隐藏暂停，可见后恢复', () => {
  const e = env();
  const lab = createLab(e.cvs);
  let n = 0;
  lab.loop(() => n++);
  e.frame(1);
  e.setHidden(true);
  e.frame(2);
  assert.equal(e.pending(), 0);
  e.setHidden(false);
  e.frame(3);
  assert.equal(n, 2);
});

test('帧循环：初始即隐藏时不运行，显示后才开始', () => {
  const e = env({ hidden: true });
  const lab = createLab(e.cvs);
  let n = 0;
  lab.loop(() => n++);
  assert.equal(e.pending(), 0);
  e.setHidden(false);
  e.frame(1);
  assert.equal(n, 1);
});

test('帧循环：画布移出文档后彻底停止并释放监听', () => {
  const e = env();
  const lab = createLab(e.cvs);
  let n = 0;
  lab.loop(() => n++);
  e.frame(1);
  assert.equal(e.listeners('visibilitychange'), 1);
  e.cvs.isConnected = false;
  e.frame(2);
  assert.equal(n, 1);
  assert.equal(e.pending(), 0);
  assert.equal(lab.stopped, true);
  assert.equal(e.listeners('visibilitychange'), 0);
  e.cvs.isConnected = true;
  e.io(true);                  /* 停止是永久的 */
  assert.equal(e.pending(), 0);
});

test('帧内异常：停止循环，HUD 与提示段给出原因', () => {
  const e = env();
  const lab = createLab(e.cvs);
  const orig = console.error; console.error = () => {};
  try {
    lab.loop(() => { throw new Error('boom'); });
    e.frame(1);
  } finally { console.error = orig; }
  assert.equal(lab.stopped, true);
  assert.equal(e.pending(), 0);
  assert.match(e.hud.textContent, /运行出错：boom/);
  assert.equal(e.note.hidden, false);
  lab.hud('fps 60');           /* 停止后 HUD 仍保持错误信息 */
  assert.match(e.hud.textContent, /boom/);
});

function fakeDevice() {
  let resolveLost, errListener;
  const lost = new Promise((r) => { resolveLost = r; });
  return {
    lost,
    addEventListener: (t, f) => { if (t === 'uncapturederror') errListener = f; },
    lose: (info) => resolveLost(info),
    error: (message) => errListener({ error: { message } }),
  };
}

test('设备丢失：停循环 + 刷新提示；主动 destroy 不报', async () => {
  const e = env();
  const lab = createLab(e.cvs);
  const d = fakeDevice();
  lab.watch(d);
  lab.loop(() => {});
  e.frame(1);
  d.lose({ reason: 'unknown', message: 'GPU hung\nmore detail' });
  await d.lost; await Promise.resolve();
  assert.equal(lab.stopped, true);
  assert.match(e.hud.textContent, /GPU 设备丢失（GPU hung）.*刷新页面/);
  assert.equal(e.note.hidden, false);
  assert.equal(e.pending(), 0);

  const e2 = env();
  const lab2 = createLab(e2.cvs);
  const d2 = fakeDevice();
  lab2.watch(d2);
  d2.lose({ reason: 'destroyed', message: '' });
  await d2.lost; await Promise.resolve();
  assert.equal(lab2.stopped, false);
});

test('未捕获 GPU 错误：HUD 置顶提示，4 秒无新错误后让位', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const realPerf = globalThis.performance;
  globalThis.performance = { now: () => Date.now() };
  const orig = console.error; console.error = () => {};
  try {
    const e = env();
    const lab = createLab(e.cvs);
    const d = fakeDevice();
    lab.watch(d);
    d.error('Invalid BindGroup\n - while calling setBindGroup');
    assert.match(e.hud.textContent, /⚠ GPU 错误：Invalid BindGroup（详见控制台）/);
    lab.hud('60 fps');
    assert.match(e.hud.textContent, /GPU 错误/);
    t.mock.timers.tick(4500);
    lab.hud('60 fps');
    assert.equal(e.hud.textContent, '60 fps');
    assert.equal(lab.stopped, false);
  } finally {
    console.error = orig;
    globalThis.performance = realPerf;
  }
});

test('尺寸：背板取内容盒 × DPR（含上限），容器变化防抖后才回调且只在尺寸真变时回调', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = env({ dpr: 3, parentW: 1200 });
  const lab = createLab(e.cvs);
  const calls = [];
  const g = lab.fit({ aspect: 9 / 16, dprCap: 2 }, (n) => calls.push(n));
  assert.equal(e.cvs.style.width, '920px');
  assert.equal(e.cvs.style.height, '518px');
  assert.deepEqual([g.cw, g.ch, g.dpr, g.pw, g.ph], [918, 516, 2, 1836, 1032]);
  assert.deepEqual([e.cvs.width, e.cvs.height], [1836, 1032]);
  e.ro(); t.mock.timers.tick(200);
  assert.equal(calls.length, 0);           /* 尺寸没变：不回调 */
  e.parent.clientWidth = 400;
  e.ro(); e.ro(); e.ro();
  t.mock.timers.tick(100);
  assert.equal(calls.length, 0);           /* 防抖中 */
  t.mock.timers.tick(100);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].cw, calls[0].pw, e.cvs.width, e.cvs.style.width], [398, 796, 796, '400px']);
});

test('尺寸：scale 模式忽略 DPR；backing:false 不动背板', () => {
  const e = env({ dpr: 2 });
  const lab = createLab(e.cvs);
  const g = lab.fit({ aspect: 9 / 16, scale: 1 });
  assert.deepEqual([g.pw, g.ph], [918, 516]);
  const e2 = env({ dpr: 2 });
  const lab2 = createLab(e2.cvs);
  lab2.fit({ aspect: 9 / 16, backing: false });
  assert.deepEqual([e2.cvs.width, e2.cvs.height], [300, 150]);
});

test('初始化失败：GPU 页藏画布并亮出 #lab-nogpu；CPU 页（无 #lab-nogpu）写进 HUD 且不提 WebGPU', async () => {
  const e = env();
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });   /* 无 navigator.gpu */
  const lab = createLab(e.cvs);
  assert.equal(await lab.adapter(), null);
  assert.equal(e.note.hidden, false);
  assert.equal(e.note.textContent, NO_WEBGPU);
  assert.equal(e.cvs.style.display, 'none');
  assert.equal(e.hud.textContent, '');

  const e2 = env({ noNote: true });
  const orig = console.error; console.error = () => {};
  try {
    const lab2 = boot(() => { throw new Error('ctx is null'); }, { gpu: false });
    await new Promise((r) => setImmediate(r));
    assert.match(e2.hud.textContent, /实验初始化失败：ctx is null/);
    assert.doesNotMatch(e2.hud.textContent, /WebGPU/);
    assert.notEqual(e2.cvs.style.display, 'none');
    assert.equal(lab2.stopped, true);
  } finally { console.error = orig; }
});

test('luminance：解析 #rgb / #rrggbb / rgb()', () => {
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(luminance('#000'), 0);
  assert.ok(luminance('#e2e8f4') > 0.7);       /* 暗色主题 --ink */
  assert.ok(luminance('#292433') < 0.05);      /* 亮色主题 --ink */
  assert.ok(Math.abs(luminance('rgb(82, 200, 230)') - luminance('#52c8e6')) < 1e-9);
  assert.equal(luminance('transparent'), -1);
});
