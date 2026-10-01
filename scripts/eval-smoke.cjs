/* 用 Proxy 万能桩执行 site.js，抓模块求值期的第一个真实异常
 *
 * 用法: node scripts/eval-smoke.cjs <classic-script.js>
 * 输出（其他工具会 grep 这两个标记，勿改）:
 *   EVAL_COMPLETED_NO_THROW  → 退出码 0
 *   THREW: <message>         → 退出码 1
 * 只能执行经典脚本（如 site.js 这种 IIFE）。ES module（顶层 import/export）
 * 会被识别为不支持的输入，打印 THREW: UNSUPPORTED INPUT … 并以退出码 1 失败，
 * 绝不会静默通过。缺参数 / 文件不存在同样退出码 1。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 用 exitCode 而不是 process.exit()：stdout 写入在部分平台/管道上是异步的，让它自然刷完再退出
let failed = false;
function fail(msg, detail) {
  if (failed) return;
  failed = true;
  process.exitCode = 1;
  console.log('THREW: ' + msg);
  if (detail) console.log(detail);
}

function firstStackLines(e) {
  const s = e && typeof e.stack === 'string' ? e.stack : String(e);
  return s.split('\n').slice(0, 6).join('\n');
}

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

// ES module 识别：编译期报 "import/export 只能出现在 module 里" 一类错误，
// 或源码里有顶层 import/export 语句。vm 只能跑经典脚本，这类输入一律判失败。
const ESM_SYNTAX_MSG = /Cannot use import statement outside a module|Unexpected token 'export'|Cannot use 'import\.meta' outside a module|await is only valid in async functions and the top level bodies of modules/;
const ESM_SOURCE = /^[ \t]*(import[ \t]*[\w{*'"]|export[ \t]+(default|const|let|var|function|async|class|\{|\*))/m;

function main() {
  const file = process.argv[2];
  if (!file) {
    return fail('UNSUPPORTED INPUT — no file given. Usage: node scripts/eval-smoke.cjs <classic-script.js>');
  }

  let src;
  try {
    src = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    return fail('UNSUPPORTED INPUT — cannot read ' + file + ': ' + (e && e.message));
  }

  let script;
  try {
    script = new vm.Script(src, { filename: path.resolve(file) });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (ESM_SYNTAX_MSG.test(msg) || ESM_SOURCE.test(src)) {
      return fail(
        'UNSUPPORTED INPUT — ' + file + ' is an ES module (static import/export). ' +
          'eval-smoke only evaluates classic scripts such as src/scripts/site.js; ' +
          'test ES modules with a scripts/tests/*.test.mjs file instead.',
        firstStackLines(e)
      );
    }
    return fail(msg, firstStackLines(e));
  }

  // 顶层 async 初始化里抛出的异常（被拒绝且无人处理的 Promise）同样算失败
  process.on('unhandledRejection', (e) => {
    fail('(async) ' + ((e && e.message) || String(e)), firstStackLines(e));
  });

  try {
    script.runInNewContext(sandbox);
  } catch (e) {
    return fail((e && e.message) || String(e), firstStackLines(e));
  }
  // 等微任务队列清空、未处理的 rejection 上报完再宣布通过
  setImmediate(() => {
    if (!failed) console.log('EVAL_COMPLETED_NO_THROW');
  });
}

main();
