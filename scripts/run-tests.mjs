#!/usr/bin/env node
/* 零依赖测试运行器：每个 *.test.mjs / *.test.cjs 在独立的 node 子进程里跑，带超时。
 *
 * 用法:
 *   node scripts/run-tests.mjs                 跑 scripts/tests/ 下所有测试（递归）
 *   node scripts/run-tests.mjs <dir|file> ...  跑指定目录 / 文件
 *   node scripts/run-tests.mjs --list          只列出会跑哪些文件
 *   选项: --timeout=<ms>（单文件超时，默认 60000）  --verbose / -v（通过的文件也打印输出）
 *
 * 判定: 子进程退出码 0 = PASS；非 0、被信号杀掉、超时、无法启动 = FAIL。
 * 用 node:test 或 node:assert 写的测试都适用（node:test 直接 `node file` 运行时失败会置退出码 1）。
 * 子进程的 cwd 是仓库根目录。
 * 退出码: 0 全部通过；1 有失败 / 没找到任何测试文件 / 路径不存在；2 参数错误。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(REPO_ROOT, 'scripts', 'tests');
const TEST_RE = /\.test\.(mjs|cjs)$/;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CAPTURE_BYTES = 1 << 20; // 每个文件最多保留 1 MB 输出
const FAIL_TAIL_LINES = 200; // 失败时打印输出的最后 N 行

function usage(msg) {
  const text = 'usage: node scripts/run-tests.mjs [--list] [--timeout=<ms>] [--verbose] [dir|file ...]';
  if (!msg) {
    console.log(text);
    process.exit(0);
  }
  console.error(`run-tests: ${msg}\n${text}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { list: false, verbose: false, timeout: DEFAULT_TIMEOUT_MS, targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--help' || a === '-h') usage();
    else if (a === '--timeout' || a.startsWith('--timeout=')) {
      const v = a === '--timeout' ? argv[++i] : a.slice('--timeout='.length);
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) usage(`bad --timeout value: ${v}`);
      opts.timeout = n;
    } else if (a === '--') {
      opts.targets.push(...argv.slice(i + 1));
      break;
    } else if (a.startsWith('-')) usage(`unknown option: ${a}`);
    else opts.targets.push(a);
  }
  return opts;
}

const rel = (p) => {
  const r = path.relative(REPO_ROOT, p);
  return (r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p).split(path.sep).join('/');
};

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, out);
    } else if (ent.isFile() && TEST_RE.test(ent.name)) out.push(p);
  }
}

// 返回 [{ file, label }]：目录里找到的文件以「相对该目录」的路径显示，单独给出的文件以仓库相对路径显示
function collect(targets) {
  const byFile = new Map();
  const dirs = [];
  const problems = [];
  for (const t of targets.length ? targets : [DEFAULT_DIR]) {
    const p = path.resolve(t);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      problems.push(`path does not exist: ${rel(p)}`);
      continue;
    }
    if (st.isDirectory()) {
      dirs.push(rel(p));
      const found = [];
      walk(p, found);
      for (const f of found) {
        if (!byFile.has(f)) byFile.set(f, path.relative(p, f).split(path.sep).join('/'));
      }
    } else if (!byFile.has(p)) byFile.set(p, rel(p));
  }
  const tests = [...byFile].map(([file, label]) => ({ file, label }));
  tests.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { tests, dirs, problems };
}

function runOne(file, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError = null;
    let exitCode = null;
    let exitSignal = null;
    let settled = false;

    const capture = (buf) => {
      if (bytes >= MAX_CAPTURE_BYTES) {
        truncated = true;
        return;
      }
      chunks.push(buf);
      bytes += buf.length;
    };

    let child;
    try {
      child = spawn(process.execPath, [file], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        windowsHide: true,
      });
    } catch (e) {
      spawnError = e;
    }

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      let output = Buffer.concat(chunks).toString('utf8');
      if (truncated) output += `\n[run-tests] output truncated at ${MAX_CAPTURE_BYTES} bytes\n`;
      let reason = '';
      if (spawnError) reason = `could not start: ${spawnError.message}`;
      else if (timedOut) reason = `timed out after ${timeoutMs} ms`;
      else if (exitSignal) reason = `killed by ${exitSignal}`;
      else if (exitCode !== 0) reason = `exit code ${exitCode}`;
      resolve({ file, ok: !reason, reason, ms, output });
    };

    let graceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child && child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    if (!child) return finish();
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (e) => {
      spawnError = spawnError || e;
      finish();
    });
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      // 孙进程可能还占着管道导致 'close' 不来——最多再等 2 秒
      graceTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish();
      }, 2000);
    });
    child.on('close', finish);
  });
}

const fmtSec = (ms) => `${(ms / 1000).toFixed(2)}s`.padStart(8);

function tail(text, n) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  if (lines.length <= n) return lines.join('\n');
  return `[... ${lines.length - n} earlier lines omitted ...]\n` + lines.slice(-n).join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { tests, dirs, problems } = collect(opts.targets);

  for (const p of problems) console.error(`run-tests: ${p}`);
  if (!tests.length) {
    const where = dirs.length ? ` in ${dirs.join(', ')}` : '';
    console.error(`run-tests: no *.test.mjs / *.test.cjs files found${where}`);
    process.exitCode = 1;
    return;
  }

  if (opts.list) {
    for (const t of tests) console.log(rel(t.file));
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  const width = Math.max(4, ...tests.map((t) => t.label.length));
  const where = dirs.length ? ` in ${dirs.join(', ')}` : '';
  console.log(`run-tests: ${tests.length} file(s)${where}, timeout ${opts.timeout} ms each, node ${process.version}\n`);
  console.log(`  ${'RESULT'.padEnd(6)}  ${'TIME'.padStart(8)}  ${'FILE'.padEnd(width)}  NOTE`);
  console.log(`  ${'-'.repeat(6)}  ${'-'.repeat(8)}  ${'-'.repeat(width)}  ${'-'.repeat(4)}`);

  const results = [];
  for (const t of tests) {
    const r = { ...(await runOne(t.file, opts.timeout)), label: t.label };
    results.push(r);
    console.log(`  ${(r.ok ? 'PASS' : 'FAIL').padEnd(6)}  ${fmtSec(r.ms)}  ${r.label.padEnd(width)}  ${r.reason}`.trimEnd());
    if (opts.verbose && r.ok && r.output.trim()) {
      console.log(r.output.trimEnd().replace(/^/gm, '        | '));
    }
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of failed) {
    console.log(`\n===== FAIL ${rel(r.file)} (${r.reason}) =====`);
    console.log(r.output.trim() ? tail(r.output, opts.verbose ? Infinity : FAIL_TAIL_LINES) : '(no output)');
  }

  const passed = results.length - failed.length;
  console.log(`\nrun-tests: ${passed} passed, ${failed.length} failed, ${results.length} total`);
  if (failed.length) console.log('failed: ' + failed.map((r) => r.label).join(', '));
  process.exitCode = failed.length || problems.length ? 1 : 0;
}

main().catch((e) => {
  console.error('run-tests: internal error:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
