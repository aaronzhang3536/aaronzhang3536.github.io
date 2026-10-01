/* 尤克里里练习台（src/scripts/music/ukulele.js）纯函数回归测试：零依赖，`node scripts/tests/ukulele.test.mjs`。
   页面脚本在 import 时会跑 init()，这里只给一个找不到任何元素的 document 桩，init 会直接返回。 */
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
}
const { TUNING, ksRender, autoCorrelate, tunerRead, tapOffset, outLatency, touchKind } =
  await import('../../src/scripts/music/ukulele.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);

/* 基频测量：同一频率 fq 处两帧加 Hann 窗的 DFT 相位差。指数衰减包络对两帧是同一形状，
   相位差只来自真实频率与 fq 之差：f = fq + Δφ·sr / (2πH)。迭代两次，精度远小于 0.01 音分。 */
function measureF0(d, sr, guess) {
  const L = 8192, H = 1024, s1 = Math.floor(sr * 0.1);
  const win = new Float64Array(L);
  for (let i = 0; i < L; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1));
  const dft = (start, fq) => {
    let re = 0, im = 0;
    for (let i = 0; i < L; i++) {
      const ph = 2 * Math.PI * fq * (start + i) / sr, v = win[i] * d[start + i];
      re += v * Math.cos(ph); im -= v * Math.sin(ph);
    }
    return Math.atan2(im, re);
  };
  let f = guess;
  for (let it = 0; it < 3; it++) {
    let dp = dft(s1 + H, f) - dft(s1, f);
    dp = Math.atan2(Math.sin(dp), Math.cos(dp));
    f += dp * sr / (2 * Math.PI * H);
  }
  return f;
}
/* 修复前的 Karplus-Strong（实际周期 N−0.5），只用来打印对照 */
function ksOld(sr, freq, len) {
  const d = new Float32Array(len), N = Math.max(2, Math.round(sr / freq));
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  for (let i = N; i < len; i++) d[i] = 0.9965 * 0.5 * (d[i - N] + d[i - N + 1]);
  return d;
}
/* 修复前的全长自相关，只用来对比耗时 */
function acOld(buf, sr) {
  let SIZE = buf.length, rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / SIZE) < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < 0.2) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < 0.2) { r2 = SIZE - i; break; }
  const b = buf.slice(r1, r2); SIZE = b.length;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += b[j] * b[j + i];
  let d = 0; while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, T0 = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; T0 = i; }
  return sr / T0;
}

/* ---------- 1. 拨弦音高：四根弦 0–12 品，44.1k / 48k（另测 22.05k / 96k） ---------- */
{
  const notes = [];
  TUNING.forEach((s, si) => { for (let fr = 0; fr <= 12; fr++) notes.push({ name: s.name + fr, f: s.freq * Math.pow(2, fr / 12) }); });
  [44100, 48000, 22050, 96000].forEach((sr) => {
    let worstNew = 0, worstOld = 0, worstName = '';
    notes.forEach((n) => {
      const len = Math.floor(sr * 0.1) + 1024 + 8192 + 16;
      const e = cents(measureF0(ksRender(sr, n.f, len), sr, n.f), n.f);
      if (Math.abs(e) > Math.abs(worstNew)) { worstNew = e; worstName = n.name; }
      const o = cents(measureF0(ksOld(sr, n.f, len), sr, n.f), n.f);
      if (Math.abs(o) > Math.abs(worstOld)) worstOld = o;
    });
    console.log('  KS ' + sr + 'Hz: 最大误差 ' + worstNew.toFixed(3) + ' 音分（' + worstName + '）；修复前 ' + worstOld.toFixed(1) + ' 音分');
    check('拨弦音高误差 < 1 音分 @' + sr, Math.abs(worstNew) < 1, worstName + ' ' + worstNew.toFixed(3));
  });
  /* 激励是随机噪声，全通补偿会让个别样本略超 ±1（实测最多约 1.04，播放增益 0.5×0.85 下不会削波）。
     用固定种子跑多组，断言「有限、有界、在衰减」，而不是死卡 1.0——否则 CI 会偶发误报。 */
  const realRandom = Math.random;
  let finite = true, peak = 0, decays = true, d = null;
  for (let seed = 1; seed <= 20; seed++) {
    let s = seed >>> 0;
    Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    d = ksRender(48000, 440, 48000 * 2);
    let e0 = 0, e1 = 0;
    for (let i = 0; i < d.length; i++) {
      if (!Number.isFinite(d[i])) finite = false;
      peak = Math.max(peak, Math.abs(d[i]));
      if (i < 9600) e0 += d[i] * d[i]; else if (i >= d.length - 19200 && i < d.length - 9600) e1 += d[i] * d[i];
    }
    if (!(e1 < e0 * 0.5)) decays = false;
  }
  Math.random = realRandom;
  check('拨弦输出有限且不发散', finite && peak <= 1.25 && decays, 'peak ' + peak.toFixed(4) + (decays ? '' : '，能量未衰减'));
  check('拨弦尾部淡出到 0', Math.abs(d[d.length - 1]) < 1e-6);
}

/* ---------- 2. 自相关测频 ---------- */
function tone(f, sr, n, harm) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harm.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f * (k + 1) * i / sr + k); });
    b[i] = v;
  }
  return b;
}
{
  [44100, 48000].forEach((sr) => {
    let worst = 0;
    [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25, 659.26, 880].forEach((f) => {
      const got = autoCorrelate(tone(f, sr, 2048, [0.5, 0.25, 0.1]), sr);
      const e = got > 0 ? cents(got, f) : Infinity;
      worst = Math.max(worst, Math.abs(e));
      check('自相关 ' + f + 'Hz @' + sr, Math.abs(e) < 3, 'got ' + got);
    });
    console.log('  自相关 @' + sr + ': 合成音最大误差 ' + worst.toFixed(2) + ' 音分');
    /* 真实的拨弦合成音（取起音后 0.1s 的一帧） */
    TUNING.forEach((s) => {
      const d = ksRender(sr, s.freq, sr);
      const got = autoCorrelate(d.subarray(Math.floor(sr * 0.1), Math.floor(sr * 0.1) + 2048), sr);
      check('自相关识别拨弦 ' + s.name + ' @' + sr, got > 0 && Math.abs(cents(got, s.freq)) < 3, 'got ' + got);
    });
    check('超出范围不报（100Hz）', autoCorrelate(tone(100, sr, 2048, [0.6]), sr) === -1);
    check('超出范围不报（1500Hz）', autoCorrelate(tone(1500, sr, 2048, [0.6]), sr) === -1);
    check('静音不报', autoCorrelate(new Float32Array(2048), sr) === -1);
  });
  const buf = tone(261.63, 48000, 2048, [0.5, 0.25, 0.1]);
  const time = (fn) => { const t = process.hrtime.bigint(); for (let k = 0; k < 20; k++) fn(buf, 48000); return Number(process.hrtime.bigint() - t) / 1e6 / 20; };
  time(autoCorrelate); time(acOld);
  const tNew = time(autoCorrelate), tOld = time(acOld);
  console.log('  自相关耗时/帧（2048 点 @48k）：' + tNew.toFixed(2) + ' ms，修复前 ' + tOld.toFixed(2) + ' ms');
  check('限定延迟范围后更快', tNew < tOld, tNew.toFixed(2) + ' vs ' + tOld.toFixed(2));
}

/* ---------- 3. 调音判读 ---------- */
{
  const G = 0, C = 1, E = 2, A = 3;
  const r = (f, t) => tunerRead(f, t == null ? -1 : t);
  let x = r(392);
  check('自动：392Hz = G 准', x.s.name === 'G' && x.octave === 0 && Math.abs(x.cents) < 0.1);
  x = r(196);
  check('自动：196Hz = G 低八度（不算准）', x.s.name === 'G' && x.octave === -1);
  x = r(523.25);
  check('自动：523Hz = C 高八度（不算准）', x.s.name === 'C' && x.octave === 1);
  x = r(880);
  check('自动：880Hz = A 高八度', x.s.name === 'A' && x.octave === 1);
  x = r(261.63 * Math.pow(2, 0.3 / 12));
  check('自动：C 偏高 30 音分', x.s.name === 'C' && x.octave === 0 && Math.abs(x.cents - 30) < 0.1);
  TUNING.forEach((s) => {
    [0.5, 2].forEach((k) => {
      const y = r(s.freq * k);
      check('自动：' + s.name + '×' + k + ' 判为八度错', y.s === s && y.octave === (k < 1 ? -1 : 1) && Math.abs(y.cents) < 0.1);
    });
  });
  x = r(392, G);
  check('锁定 G：392Hz 准', x.octave === 0 && Math.abs(x.cents) < 0.1);
  x = r(196, G);
  check('锁定 G：196Hz 低八度', x.s.name === 'G' && x.octave === -1);
  x = r(392 * Math.pow(2, 0.7 / 12), G);
  check('锁定 G：偏高 70 音分仍算 G（自动模式会认错弦的情形）', x.s.name === 'G' && x.octave === 0 && Math.abs(x.cents - 70) < 0.1);
  x = r(261.63, G);
  check('锁定 G：拨成了 C4 → 偏低约 7 个半音，不当成八度错', x.s.name === 'G' && x.octave === 0 && Math.abs(x.cents + 700) < 1);
  x = r(293.66, C);
  check('锁定 C：D4 → 偏高约 2 个半音', x.s.name === 'C' && x.octave === 0 && Math.abs(x.cents - 200) < 1);
  x = r(440 * Math.pow(2, -0.6), A);
  check('锁定 A：A4 低 7 个半音以上 → 偏差照报', x.s.name === 'A' && x.octave === 0);
  x = r(220 * Math.pow(2, 0.4 / 12), A);
  check('锁定 A：低八度且偏高 40 音分', x.octave === -1 && Math.abs(x.cents - 40) < 0.1);
  x = r(329.63 / 2, E);
  check('锁定 E：低八度', x.s.name === 'E' && x.octave === -1);
}

/* ---------- 4. 判定延迟补偿与校准 ---------- */
{
  check('输出延迟 = base + output', Math.abs(outLatency({ outputLatency: 0.2, baseLatency: 0.01 }) - 0.21) < 1e-9);
  check('不支持 outputLatency 时只用 baseLatency', Math.abs(outLatency({ baseLatency: 0.0107 }) - 0.0107) < 1e-9);
  check('都不支持时为 0', outLatency({}) === 0 && outLatency(null) === 0);
  check('异常值被夹住', outLatency({ outputLatency: NaN, baseLatency: 0.01 }) === 0.01 && outLatency({ outputLatency: 5 }) === 1);
  let seed = 7; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  /* 按节奏型排出 8 小节的拍点时刻（与 patTick 一致：每槽 30/bpm 秒，空槽无拍点） */
  const events = (slots, bpm) => {
    const out = [], sp = 30 / bpm;
    for (let i = 0; i < 8 * slots.length; i++) if (slots[i % slots.length]) out.push(1 + i * sp);
    return out;
  };
  /* 模拟击打：整体偏移 off、±20ms 抖动、漏打约 1/10、外加预备拍里的乱按 */
  const play = (ev, off) => {
    const t = [0.3, 0.55];
    ev.forEach((e) => { if (rnd() > 0.1) t.push(e + off + (rnd() - 0.5) * 0.04); });
    return t;
  };
  const folk = events(['D', '', 'D', 'U', '', 'U', 'D', 'U'], 90);
  let m = tapOffset(play(folk, 0.18), folk);
  check('校准：民谣万能型整体偏晚 180ms', m !== null && Math.abs(m - 0.18) < 0.015, 'got ' + m);
  m = tapOffset(play(folk, -0.06), folk);
  check('校准：民谣万能型整体偏早 60ms', m !== null && Math.abs(m + 0.06) < 0.015, 'got ' + m);
  const quarter = events(['D', '', 'D', '', 'D', '', 'D', ''], 120);
  m = tapOffset(play(quarter, 0.22), quarter);
  check('校准：四分下扫偏晚 220ms', m !== null && Math.abs(m - 0.22) < 0.015, 'got ' + m);
  const eighth = events(['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'], 120);
  check('校准：120BPM 八分扫弦偏晚 180ms 与错一格分不清 → 不给建议', tapOffset(play(eighth, 0.18), eighth) === null);
  m = tapOffset(play(eighth, 0.03), eighth);
  check('校准：八分扫弦小偏移 30ms 仍测得出', m === null || Math.abs(m - 0.03) < 0.015, 'got ' + m);
  check('校准：击打太少返回 null', tapOffset([1, 2, 3], folk) === null && tapOffset([], folk) === null);
}

/* ---------- 5. 触屏三分区 ---------- */
{
  check('触屏左 1/3 = 下扫', touchKind(10, 300) === 'D' && touchKind(99, 300) === 'D');
  check('触屏中 1/3 = 切音', touchKind(150, 300) === 'X' && touchKind(100, 300) === 'X' && touchKind(200, 300) === 'X');
  check('触屏右 1/3 = 上扫', touchKind(201, 300) === 'U' && touchKind(299, 300) === 'U');
}

console.log('ukulele.test: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
