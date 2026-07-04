/* 用 Proxy 万能桩执行 site.js，抓模块求值期的第一个真实异常 */
const fs = require('fs');
const vm = require('vm');

function mkStub() {
  const fn = function () {};
  const p = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'toString') return () => '';
      if (k === 'valueOf') return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return p;
    },
    apply() { return p; },
    construct() { return p; },
    has() { return true; },
  });
  return p;
}
const stub = mkStub();

const sandbox = {
  console,
  Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite, String, Number,
  Array, Object, Boolean, RegExp, Error, TypeError, Promise, Symbol, Proxy,
  Uint8Array, Float32Array, Uint16Array, Uint32Array, Int32Array, ArrayBuffer, DataView,
  Map, Set, WeakMap, encodeURIComponent, decodeURIComponent, escape, unescape,
  setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  performance: { now: () => 0 },
  document: stub, navigator: stub, location: stub, history: stub,
  localStorage: stub, sessionStorage: stub, screen: stub,
  matchMedia: () => stub, getComputedStyle: () => stub,
  fetch: () => new Promise(() => {}),
  Image: function () { return stub; }, Audio: function () { return stub; },
  AudioContext: function () { return stub; }, webkitAudioContext: undefined,
  IntersectionObserver: function () { return stub; },
  MutationObserver: function () { return stub; },
  ResizeObserver: function () { return stub; },
  URL: stub, Blob: function () { return stub; },
  addEventListener: () => {}, removeEventListener: () => {},
  devicePixelRatio: 1, innerWidth: 1200, innerHeight: 800,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const src = fs.readFileSync(process.argv[2], 'utf-8');
try {
  vm.runInNewContext(src, sandbox, { filename: 'site.js' });
  console.log('EVAL_COMPLETED_NO_THROW');
} catch (e) {
  console.log('THREW:', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
}
