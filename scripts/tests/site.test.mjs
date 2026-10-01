/* site.js 行为回归测试：最小假 DOM + 假时钟 / 假 rAF，在 vm 里执行整份 site.js。
 * 覆盖：主题不擅自持久化且跟随系统、背景图只在看得见时拉取、减少动态效果、
 *       天气 / 光标 rAF 循环停表、定位不无手势弹窗、框选不劫持选字、PIE 菜单键盘与焦点。
 * 运行：node scripts/tests/site.test.mjs（或 node scripts/run-tests.mjs） */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/* 线上经 Vite 打成 ES module 执行，天然是严格模式：这里也按严格模式跑，隐式全局等问题会直接抛出 */
const SRC = '"use strict";' + fs.readFileSync(path.join(ROOT, 'src', 'scripts', 'site.js'), 'utf-8');

/* 万能桩：canvas 2D 上下文等用不到返回值的对象 */
function mkStub() {
  const fn = function () {};
  const p = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      return p;
    },
    set() { return true; },
    apply() { return p; },
    construct() { return p; },
  });
  return p;
}
const STUB = mkStub();

/* 极简选择器匹配：tag / .class / #id / [attr] / [attr="v"]，支持逗号并列与 :not([tabindex="-1"]) 忽略 */
function matchesSimple(el, sel) {
  sel = sel.trim().replace(/:not\([^)]*\)/g, '');
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g;
  let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !el.classList.contains(m[2])) return false;
    if (m[3] && el.id !== m[3]) return false;
    if (m[4]) {
      const v = el.getAttribute(m[4]);
      if (v == null) return false;
      if (m[5] != null && m[5] !== '' && v !== m[5]) return false;
    }
  }
  return any;
}
function matches(el, sel) { return sel.split(',').some((s) => matchesSimple(el, s)); }

function makeEnv(opts = {}) {
  const env = {
    t: 1000,
    timers: [], timerSeq: 0,
    raf: [], rafSeq: 0,
    store: new Map(Object.entries(opts.storage || {})),
    imgSrcs: [], fetches: [], geoCalls: 0,
    cssVars: Object.assign({ '--bgimg': '0.22' }, opts.cssVars || {}),
    media: {
      '(prefers-color-scheme: light)': !!opts.light,
      '(prefers-reduced-motion: reduce)': !!opts.reduced,
      '(pointer: fine)': !!opts.fine,
      '(pointer: coarse)': !!opts.coarse,
    },
    mqLs: {},
    styleWrites: 0,
  };

  class ClassList {
    constructor() { this.s = new Set(); }
    add(...c) { c.forEach((x) => this.s.add(x)); }
    remove(...c) { c.forEach((x) => this.s.delete(x)); }
    contains(c) { return this.s.has(c); }
    toggle(c, f) { const on = f === undefined ? !this.s.has(c) : !!f; on ? this.s.add(c) : this.s.delete(c); return on; }
  }
  const doc = { _ids: {}, _ls: {}, hidden: !!opts.hidden, title: 't', activeElement: null };

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.nodeType = 1;
      this._attrs = {}; this._ls = {}; this.dataset = {};
      this.children = []; this.parentNode = null; this._text = '';
      this.classList = new ClassList();
      const self = this;
      this.style = new Proxy({}, {
        set(o, k, v) { o[k] = v; if (self._trackStyle) env.styleWrites++; return true; },
      });
      if (this.tagName === 'IMG') {
        let src = '';
        Object.defineProperty(this, 'src', {
          get() { return src; },
          set(v) { src = v; env.imgSrcs.push(v); },
        });
      }
    }
    get id() { return this._attrs.id || ''; }
    set id(v) { this._attrs.id = String(v); doc._ids[v] = this; }
    get className() { return [...this.classList.s].join(' '); }
    set className(v) { this.classList = new ClassList(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
    setAttribute(k, v) { if (k === 'id') this.id = v; else if (k === 'class') this.className = v; else this._attrs[k] = String(v); }
    getAttribute(k) { if (k === 'class') return this.className; return k in this._attrs ? this._attrs[k] : null; }
    hasAttribute(k) { return k in this._attrs; }
    removeAttribute(k) { delete this._attrs[k]; }
    addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
    removeEventListener(t, f) { const a = this._ls[t]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
    insertBefore(c) { return this.appendChild(c); }
    remove() { if (this.parentNode) { const a = this.parentNode.children; a.splice(a.indexOf(this), 1); this.parentNode = null; } }
    get firstChild() { return this._text ? { nodeType: 3, nodeValue: this._text, nextSibling: this.children[0] || null } : (this.children[0] || null); }
    get nextSibling() { if (!this.parentNode) return null; const a = this.parentNode.children; return a[a.indexOf(this) + 1] || null; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
    set innerHTML(v) { this._html = String(v); this.children = []; this._text = ''; parseInto(this, this._html); }
    get innerHTML() { return this._html || ''; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => n.children.forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); });
      walk(this);
      return out;
    }
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    getContext() { return STUB; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }; }
    getClientRects() { return [1]; }
    get offsetWidth() { return 10; }
    get offsetHeight() { return 10; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    focus() { doc.activeElement = this; }
    click() { fire(this, 'click', { detail: 0 }); }
  }
  function fire(target, type, ev = {}) {
    let stopped = false;
    const e = Object.assign({ type, target, button: 0, defaultPrevented: false }, ev, {
      preventDefault() { e.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
    });
    for (let n = target; n && !stopped; n = n.parentNode) {
      (n._ls && n._ls[type] ? [...n._ls[type]] : []).forEach((f) => f.call(n, e));
    }
    if (!stopped) (doc._ls[type] ? [...doc._ls[type]] : []).forEach((f) => f.call(doc, e));
    return e;
  }
  /* 够用的 innerHTML 解析：标签 + 属性 + 文本，供 PIE 各模式的 querySelector 使用 */
  const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
  function parseInto(root, html) {
    const stack = [root];
    const re = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      if (m[2]) {
        const el = new El(m[2]);
        const are = /([\w:-]+)(?:="([^"]*)")?/g;
        let a;
        while ((a = are.exec(m[3] || ''))) el.setAttribute(a[1], a[2] == null ? '' : a[2]);
        top.appendChild(el);
        if (!VOID.has(m[2].toLowerCase())) stack.push(el);
        continue;
      }
      if (m[4] && m[4].trim()) top._text += m[4];
    }
  }

  const html = new El('html');
  const body = new El('body');
  html.appendChild(body);
  Object.defineProperty(html, 'clientWidth', { value: 1200 });
  Object.defineProperty(html, 'clientHeight', { value: 800 });
  doc.documentElement = html;
  doc.body = body;
  doc.activeElement = body;
  doc.createElement = (t) => new El(t);
  doc.createElementNS = (_, t) => new El(t);
  doc.getElementById = (id) => {
    if (!doc._ids[id]) { const e = new El(id === 'cmd' ? 'input' : 'div'); e.id = id; body.appendChild(e); }
    return doc._ids[id];
  };
  doc.querySelector = (s) => html.querySelector(s);
  doc.querySelectorAll = (s) => html.querySelectorAll(s);
  doc.addEventListener = (t, f) => { (doc._ls[t] = doc._ls[t] || []).push(f); };
  doc.removeEventListener = (t, f) => { const a = doc._ls[t]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } };

  /* PIE 菜单：Base.astro 里的 5 个 .gm 项 */
  const menu = doc.getElementById('pie-menu');
  ['arcade', 'tea', 'workout', 'idle', 'zen'].forEach((g) => {
    const it = new El('div'); it.className = 'gm'; it.setAttribute('role', 'menuitem'); it.setAttribute('data-gm', g);
    menu.appendChild(it);
  });
  const pie = doc.getElementById('pie');
  const banner = new El('div');
  pie.appendChild(banner);
  const exitBtn = new El('button'); exitBtn.id = 'pie-exit'; banner.appendChild(exitBtn);
  const stage = new El('div'); stage.id = 'pie-stage'; pie.appendChild(stage);
  const hdr = new El('header'); body.appendChild(hdr);
  ['btn-theme', 'btn-wx', 'btn-snd', 'btn-pie'].forEach((id) => { const b = new El('button'); b.id = id; hdr.appendChild(b); });

  function mm(q) {
    const o = {
      get matches() { return !!env.media[q]; },
      addEventListener(_, f) { (env.mqLs[q] = env.mqLs[q] || []).push(f); },
    };
    return o;
  }
  const FDate = function (...a) { return a.length ? new Date(...a) : new Date(env.t); };
  FDate.now = () => env.t;
  FDate.prototype = Date.prototype;

  const sandbox = {
    console, Math, JSON, parseInt, parseFloat, isNaN, isFinite, String, Number, Array, Object, Boolean, RegExp,
    Error, TypeError, Promise, Symbol, Proxy, Map, Set, WeakMap, Float32Array, Uint8Array, Uint16Array, Uint32Array,
    Int32Array, ArrayBuffer, DataView, encodeURIComponent, decodeURIComponent,
    Date: FDate,
    document: doc,
    location: { hostname: 'localhost', hash: '', href: '' },
    navigator: opts.navigator || {},
    localStorage: {
      getItem: (k) => (env.store.has(k) ? env.store.get(k) : null),
      setItem: (k, v) => env.store.set(k, String(v)),
      removeItem: (k) => env.store.delete(k),
    },
    matchMedia: mm,
    getComputedStyle: (el) => ({ getPropertyValue: (k) => env.cssVars[k] || '', cursor: (el && el._cursor) || 'auto' }),
    getSelection: () => ({ isCollapsed: !env.selText, toString: () => env.selText || '' }),
    performance: { now: () => env.t },
    setTimeout: (f, ms) => { const id = ++env.timerSeq; env.timers.push({ id, at: env.t + (ms || 0), f }); return id; },
    clearTimeout: (id) => { env.timers = env.timers.filter((x) => x.id !== id); },
    setInterval: (f, ms) => { const id = ++env.timerSeq; env.timers.push({ id, at: env.t + ms, f, every: ms }); return id; },
    clearInterval: (id) => { env.timers = env.timers.filter((x) => x.id !== id); },
    requestAnimationFrame: (f) => { const id = ++env.rafSeq; env.raf.push({ id, f }); return id; },
    cancelAnimationFrame: (id) => { env.raf = env.raf.filter((x) => x.id !== id); },
    fetch: (u) => { env.fetches.push(String(u)); return new Promise(() => {}); },
    Image: function () { return new El('img'); },
    Audio: function () { return STUB; },
    AudioContext: function () { return STUB; },
    URL: STUB, Blob: function () { return STUB; },
    addEventListener: () => {}, removeEventListener: () => {},
    devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  env.doc = doc; env.body = body; env.html = html; env.El = El; env.fire = fire; env.sandbox = sandbox;
  env.advance = (ms) => {
    const end = env.t + ms;
    for (;;) {
      env.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const tm = env.timers[0];
      if (!tm || tm.at > end) break;
      env.t = tm.at;
      if (tm.every) tm.at += tm.every; else env.timers.shift();
      tm.f();
    }
    env.t = end;
  };
  env.frame = (ms = 16) => {
    env.t += ms;
    const q = env.raf; env.raf = [];
    q.forEach((x) => x.f(env.t));
    return q.length;
  };
  env.setMedia = (q, v) => { env.media[q] = v; (env.mqLs[q] || []).forEach((f) => f()); };
  env.setHidden = (v) => { doc.hidden = v; env.fire(body, 'visibilitychange'); };
  env.run = () => { vm.runInNewContext(SRC, sandbox, { filename: 'site.js' }); return env; };
  return env;
}
const flush = () => new Promise((r) => setImmediate(r));
const bgFetches = (env) => env.imgSrcs.filter((u) => /^https?:/.test(u));

/* ---------------- 主题 ---------------- */
test('首访不写 yzzn-theme，并实时跟随系统明暗；用户点击后才持久化', () => {
  const env = makeEnv({ light: false, reduced: true }).run();
  assert.equal(env.store.has('yzzn-theme'), false);
  assert.equal(env.html.getAttribute('data-theme'), 'dark');
  env.setMedia('(prefers-color-scheme: light)', true);
  assert.equal(env.html.getAttribute('data-theme'), 'light');
  assert.equal(env.store.has('yzzn-theme'), false);
  env.doc.getElementById('btn-theme').click();          /* light → wire */
  assert.equal(env.store.get('yzzn-theme'), 'wire');
  env.setMedia('(prefers-color-scheme: light)', false);  /* 选过之后不再跟随系统 */
  assert.equal(env.body.classList.contains('vm-wire'), true);
});

/* ---------------- 背景图 ---------------- */
test('背景图默认开启：只用 picsum，且只在定时器里拉取', () => {
  const env = makeEnv({ reduced: true }).run();
  assert.equal(bgFetches(env).length, 0, '求值期不应同步拉图');
  env.advance(1);
  const f = bgFetches(env);
  assert.equal(f.length, 1);
  assert.match(f[0], /^https:\/\/picsum\.photos\//);
});
test('bg off / 线框主题 / 隐藏标签页时不发任何图片请求', () => {
  for (const o of [
    { storage: { 'yzzn-bg': 'off' } },
    { storage: { 'yzzn-theme': 'wire' }, cssVars: { '--bgimg': '0' } },
    { hidden: true },
  ]) {
    const env = makeEnv(Object.assign({ reduced: true }, o)).run();
    env.advance(10 * 60 * 1000);
    assert.equal(bgFetches(env).length, 0, JSON.stringify(o));
  }
});
test('隐藏期间暂停轮换，回到前台后补拉；失败按上限重试后等一个完整间隔', () => {
  const env = makeEnv({ reduced: false }).run();
  env.advance(1);
  assert.equal(bgFetches(env).length, 1);
  const img = env.body.querySelectorAll('img').find((i) => i.src) || null;
  img.onload();
  env.setHidden(true);
  env.advance(5 * 60 * 1000);
  assert.equal(bgFetches(env).length, 1, '隐藏时不应再拉');
  env.setHidden(false);
  env.advance(1);
  assert.equal(bgFetches(env).length, 2, '回到前台应立即补一张');
  const img2 = env.body.querySelectorAll('img').filter((i) => i.src).pop();
  img2.onerror();               /* 第一次失败 → 换源重试 */
  assert.equal(bgFetches(env).length, 3);
  img2.onerror();               /* 达到上限 → 不再立刻重试 */
  assert.equal(bgFetches(env).length, 3);
  env.advance(59 * 1000);
  assert.equal(bgFetches(env).length, 3);
  env.advance(2 * 1000);
  assert.equal(bgFetches(env).length, 4, '一个间隔后再试');
});
test('减少动态效果：只取一张静态图，不轮换', () => {
  const env = makeEnv({ reduced: true }).run();
  env.advance(1);
  const img = env.body.querySelectorAll('img').find((i) => i.src);
  img.onload();
  env.advance(30 * 60 * 1000);
  assert.equal(bgFetches(env).length, 1);
});

/* ---------------- 天气 ---------------- */
test('减少动态效果时不创建天气画布；运行中关闭该设置后再创建', () => {
  const env = makeEnv({ reduced: true }).run();
  assert.equal(env.doc._ids['wx-canvas'], undefined);
  env.setMedia('(prefers-reduced-motion: reduce)', false);
  assert.ok(env.doc._ids['wx-canvas']);
});
test('天气 rAF：隐藏标签页 / 不透明 PIE 时停表，恢复后重启；禅模式不停', () => {
  const env = makeEnv({ storage: { 'yzzn-wx': 'snow' } }).run();
  assert.equal(env.frame(), 1);
  assert.equal(env.raf.length, 1);
  env.doc.hidden = true;
  env.frame();
  assert.equal(env.raf.length, 0, '隐藏后不再排帧');
  env.setHidden(false);
  assert.equal(env.raf.length, 1, 'visibilitychange 唤醒');
  env.doc.querySelector('.gm[data-gm="workout"]').click();
  env.frame();
  assert.equal(env.raf.length, 0, '不透明 PIE 盖住时停表');
  env.fire(env.body, 'keydown', { key: 'Escape' });
  assert.equal(env.raf.length, 1, '退出 PIE 后恢复');
  env.doc.querySelector('.gm[data-gm="zen"]').click();
  env.frame();
  assert.equal(env.raf.length, 1, '禅模式是透明层，天气继续');
});
test('实时天气：未授权定位时页面加载不调用 getCurrentPosition，改走 IP；用户亲手切换时才允许', async () => {
  for (const [state, byUser, expectGeo] of [['prompt', false, 0], ['granted', false, 1], ['prompt', true, 1]]) {
    let geo = 0;
    const navigator = {
      geolocation: { getCurrentPosition: () => { geo++; } },
      permissions: { query: () => Promise.resolve({ state }) },
    };
    const env = makeEnv({ storage: { 'yzzn-wx': byUser ? 'fog' : 'auto' }, navigator }).run();
    if (byUser) {   /* fog → clear → auto：按钮循环到「实时」 */
      env.doc.getElementById('btn-wx').click();
      env.doc.getElementById('btn-wx').click();
    }
    await flush(); await flush();
    assert.equal(geo, expectGeo, state + ' byUser=' + byUser);
    if (!expectGeo) assert.ok(env.fetches.some((u) => u.indexOf('ipwho.is') >= 0), '应直接走 IP 定位');
  }
});
test('实时天气 20 分钟刷新：后台标签页跳过', async () => {
  const env = makeEnv({
    storage: { 'yzzn-wx': 'auto', 'yzzn-wx-live': JSON.stringify({ t: 1000, code: 0, temp: 20, wind: 0, day: 1, cloud: 10, name: 'X' }) },
    navigator: { permissions: { query: () => Promise.resolve({ state: 'prompt' }) } },
  }).run();
  await flush();
  const n0 = env.fetches.length;
  env.doc.hidden = true;
  env.advance(41 * 60 * 1000);
  await flush();
  assert.equal(env.fetches.length, n0, '隐藏时不应发天气请求');
});

/* ---------------- 光标特效 ---------------- */
test('光标 rAF：静止收敛后停表，不再每帧写样式；下一次移动重新唤醒', () => {
  const env = makeEnv({ fine: true, storage: { 'yzzn-wx': 'clear' } }).run();
  const light = env.doc._ids['cursor-light'];
  light._trackStyle = true;
  const ticks = () => env.raf.filter((x) => x.f.name === 'tick').length;
  env.fire(env.body, 'mousemove', { clientX: 300, clientY: 200 });
  assert.equal(ticks(), 1, '指针移动唤醒光标循环');
  let frames = 0;
  while (ticks() && frames < 1000) { env.frame(); frames++; }   /* env.frame 不推进定时器：微尘定时器不会触发 */
  assert.ok(frames < 1000, '光晕追上指针、星屑散尽后应停表，实际跑了 ' + frames + ' 帧');
  const w0 = env.styleWrites;
  for (let i = 0; i < 120; i++) env.frame();
  assert.equal(ticks(), 0);
  assert.equal(env.styleWrites, w0, '停表后不再写光晕样式');
  assert.ok(env.raf.length >= 1, '天气循环不受影响');
  env.advance(1500);                                             /* 静止 1.4 s：定时器唤醒一次撒微尘 */
  assert.equal(ticks(), 1, '静止微尘定时唤醒');
  while (ticks() && frames < 3000) { env.frame(); frames++; }
  assert.equal(ticks(), 0, '微尘散尽后再次停表');
  env.fire(env.body, 'mousemove', { clientX: 400, clientY: 260 });
  env.frame();
  assert.ok(env.styleWrites > w0, '移动后恢复写样式');
});

/* ---------------- 框选 ---------------- */
test('框选只在空白背景上起框：文字、canvas、文章区、已有选区都不劫持', () => {
  const env = makeEnv({ fine: true, reduced: true }).run();
  const main = new env.El('main'); main.className = 'wrap'; env.body.appendChild(main);
  const p = new env.El('p'); p.textContent = '一段可以选中的文字'; main.appendChild(p);
  const cv = new env.El('canvas'); main.appendChild(cv);
  const article = new env.El('article'); article.className = 'md-body'; main.appendChild(article);
  const inner = new env.El('div'); article.appendChild(inner);
  const mq = env.doc._ids.marquee;
  function drag(target) {
    mq.style.display = 'none';
    env.fire(target, 'mousedown', { clientX: 100, clientY: 100 });
    env.fire(target, 'mousemove', { clientX: 220, clientY: 180 });
    const shown = mq.style.display === 'block';
    const us = env.body.style.userSelect;
    env.fire(target, 'mouseup', {});
    return { shown, us };
  }
  assert.equal(drag(p).shown, false, '文字上不起框');
  assert.equal(drag(cv).shown, false, 'canvas 上不起框');
  assert.equal(drag(inner).shown, false, '.md-body 内不起框');
  env.selText = 'abc';
  assert.equal(drag(main).shown, false, '已有选区时不起框');
  env.selText = '';
  const r = drag(main);
  assert.equal(r.shown, true, '空白背景照常起框');
});

/* ---------------- PIE 菜单 / 焦点 ---------------- */
test('PIE 菜单键盘：项可聚焦、方向键移动、Esc 关闭并回到按钮；进入后焦点进对话框，退出后归还', () => {
  const env = makeEnv({ reduced: true }).run();
  const btn = env.doc.getElementById('btn-pie');
  const menu = env.doc.getElementById('pie-menu');
  const items = menu.querySelectorAll('.gm');
  assert.ok(items.every((i) => i.getAttribute('tabindex') === '-1'));
  btn.focus();
  env.fire(btn, 'click', { detail: 0, stopPropagation() {} });
  assert.ok(menu.classList.contains('open'));
  assert.equal(env.doc.activeElement, items[0]);
  env.fire(items[0], 'keydown', { key: 'ArrowDown' });
  assert.equal(env.doc.activeElement, items[1]);
  env.fire(items[1], 'keydown', { key: 'Escape' });
  assert.equal(menu.classList.contains('open'), false);
  assert.equal(env.doc.activeElement, btn);
  env.fire(btn, 'click', { detail: 0, stopPropagation() {} });
  env.fire(items[0], 'keydown', { key: 'ArrowUp' });       /* 回绕到最后一项（禅） */
  env.fire(env.doc.activeElement, 'keydown', { key: 'Enter' });
  const pie = env.doc.getElementById('pie');
  assert.ok(pie.classList.contains('on') && pie.classList.contains('zen'));
  assert.equal(env.doc.activeElement, pie, '焦点进入 aria-modal 对话框');
  env.fire(env.body, 'keydown', { key: 'Escape' });
  assert.equal(pie.classList.contains('on'), false);
  assert.equal(env.doc.activeElement, btn, '退出后焦点回到 ▶ 按钮');
});
test('禅模式：触屏双击退出，且退出后 #pie-stage 上的监听全部移除', () => {
  const env = makeEnv({ reduced: true, coarse: true }).run();
  const stage = env.doc.getElementById('pie-stage');
  const n0 = Object.values(stage._ls).reduce((a, l) => a + l.length, 0);
  env.doc.querySelector('.gm[data-gm="zen"]').click();
  assert.ok(env.doc.getElementById('pie').classList.contains('on'));
  const tap = () => {
    env.fire(stage, 'pointerdown', { pointerType: 'touch', clientX: 50, clientY: 50 });
    env.fire(stage, 'pointerup', { pointerType: 'touch' });
    env.fire(stage, 'click', { clientX: 50, clientY: 50 });
  };
  tap();
  assert.ok(env.doc.getElementById('pie').classList.contains('on'), '单击只换句子');
  env.advance(150);
  tap();
  assert.equal(env.doc.getElementById('pie').classList.contains('on'), false, '双击退出');
  const n1 = Object.values(stage._ls).reduce((a, l) => a + l.length, 0);
  assert.equal(n1, n0, '监听已清理');
});
test('禅模式：触屏长按退出', () => {
  const env = makeEnv({ reduced: true, coarse: true }).run();
  const stage = env.doc.getElementById('pie-stage');
  env.doc.querySelector('.gm[data-gm="zen"]').click();
  env.fire(stage, 'pointerdown', { pointerType: 'touch', clientX: 50, clientY: 50 });
  env.advance(700);
  assert.equal(env.doc.getElementById('pie').classList.contains('on'), false);
});
