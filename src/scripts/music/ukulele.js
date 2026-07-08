/* 尤克里里练习台：和弦图 + Karplus-Strong 拨弦合成 + 换和弦节拍训练（全本地，零采样） */

/* 高音 G 定弦（re-entrant GCEA）：G4 C4 E4 A4 */
const TUNING = [
  { name: 'G', freq: 392.00 },
  { name: 'C', freq: 261.63 },
  { name: 'E', freq: 329.63 },
  { name: 'A', freq: 440.00 },
];

/* frets 按 G C E A 四弦，0=空弦；fingers 为建议指法(0=不按/空弦) */
const CHORDS = [
  { name: 'C', frets: [0, 0, 0, 3], fingers: [0, 0, 0, 3], g: '大调' },
  { name: 'A', frets: [2, 1, 0, 0], fingers: [2, 1, 0, 0], g: '大调' },
  { name: 'G', frets: [0, 2, 3, 2], fingers: [0, 1, 3, 2], g: '大调' },
  { name: 'F', frets: [2, 0, 1, 0], fingers: [2, 0, 1, 0], g: '大调' },
  { name: 'D', frets: [2, 2, 2, 0], fingers: [1, 2, 3, 0], g: '大调' },
  { name: 'E', frets: [4, 4, 4, 2], fingers: [3, 3, 3, 1], g: '大调' },
  { name: 'Am', frets: [2, 0, 0, 0], fingers: [2, 0, 0, 0], g: '小调' },
  { name: 'Em', frets: [0, 4, 3, 2], fingers: [0, 3, 2, 1], g: '小调' },
  { name: 'Dm', frets: [2, 2, 1, 0], fingers: [2, 3, 1, 0], g: '小调' },
  { name: 'Bm', frets: [4, 2, 2, 2], fingers: [4, 1, 1, 1], g: '小调' },
  { name: 'C7', frets: [0, 0, 0, 1], fingers: [0, 0, 0, 1], g: '属七' },
  { name: 'G7', frets: [0, 2, 1, 2], fingers: [0, 2, 1, 3], g: '属七' },
  { name: 'D7', frets: [2, 0, 2, 0], fingers: [2, 0, 3, 0], g: '属七' },
  { name: 'A7', frets: [0, 1, 0, 0], fingers: [0, 1, 0, 0], g: '属七' },
  { name: 'E7', frets: [1, 2, 0, 2], fingers: [1, 2, 0, 3], g: '属七' },
  { name: 'B7', frets: [2, 3, 2, 2], fingers: [1, 3, 1, 1], g: '属七' },
  { name: 'Cmaj7', frets: [0, 0, 0, 2], fingers: [0, 0, 0, 2], g: '大七/小七' },
  { name: 'Am7', frets: [0, 0, 0, 0], fingers: [0, 0, 0, 0], g: '大七/小七' },
];

function $(id) { return document.getElementById(id); }

/* ---------- 音频：Karplus-Strong 拨弦 ---------- */
let actx = null, master = null;
const ksCache = {};
function ac() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = 0.85;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function ksBuffer(freq) {
  const ctx = ac();
  const key = Math.round(freq * 4);
  if (ksCache[key]) return ksCache[key];
  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / freq));
  const len = Math.floor(sr * 1.8);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  const decay = 0.9965;
  for (let i = N; i < len; i++) d[i] = decay * 0.5 * (d[i - N] + d[i - N + 1]);
  const fade = Math.floor(sr * 0.12);
  for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  ksCache[key] = buf;
  return buf;
}
function pluck(freq, when, gain) {
  const ctx = ac();
  const src = ctx.createBufferSource();
  src.buffer = ksBuffer(freq);
  const g = ctx.createGain();
  g.gain.value = gain == null ? 0.5 : gain;
  src.connect(g).connect(master);
  src.start(when || ctx.currentTime);
}
function noteFreq(string, fret) { return TUNING[string].freq * Math.pow(2, fret / 12); }
function strum(chord, dir, when, gain) {
  const ctx = ac();
  const t0 = (when || ctx.currentTime) + 0.01;
  const order = dir === 'up' ? [3, 2, 1, 0] : [0, 1, 2, 3];
  order.forEach((s, i) => {
    const f = chord.frets[s];
    if (f < 0) return;
    pluck(noteFreq(s, f), t0 + i * (dir === 'up' ? 0.02 : 0.03), gain == null ? 0.5 : gain);
  });
}
const chordByName = (n) => CHORDS.find((c) => c.name === n);
function click(when, accent) {
  const ctx = ac();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1050;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(master);
  o.start(when); o.stop(when + 0.06);
}

/* ---------- 和弦图（SVG，展示 0–4 品） ---------- */
function chordSVG(chord, big) {
  const SW = big ? 118 : 74, SH = big ? 150 : 92;
  const padX = big ? 22 : 15, padTop = big ? 30 : 20, padBot = big ? 14 : 10;
  const nStr = 4, nFret = 4;
  const gw = SW - padX * 2, gh = SH - padTop - padBot;
  const sx = (i) => padX + (gw * i) / (nStr - 1);
  const fy = (f) => padTop + (gh * f) / nFret;
  let s = '<svg width="' + SW + '" height="' + SH + '" viewBox="0 0 ' + SW + ' ' + SH + '" class="uke-diagram" role="img" aria-label="' + chord.name + ' 和弦指法">';
  /* 品丝 */
  for (let f = 0; f <= nFret; f++) {
    const w = f === 0 ? (big ? 3.4 : 2.6) : 1;
    s += '<line x1="' + padX + '" y1="' + fy(f) + '" x2="' + (SW - padX) + '" y2="' + fy(f) + '" stroke="var(--ink2)" stroke-width="' + w + '"/>';
  }
  /* 弦 */
  for (let i = 0; i < nStr; i++) {
    s += '<line x1="' + sx(i) + '" y1="' + padTop + '" x2="' + sx(i) + '" y2="' + (SH - padBot) + '" stroke="var(--ink2)" stroke-width="1"/>';
  }
  /* 指位 / 空弦 */
  const r = big ? 9 : 5.6;
  for (let i = 0; i < nStr; i++) {
    const f = chord.frets[i];
    if (f <= 0) {
      s += '<circle cx="' + sx(i) + '" cy="' + (padTop - (big ? 12 : 8)) + '" r="' + (big ? 4 : 2.6) + '" fill="none" stroke="var(--ink2)" stroke-width="1.4"/>';
    } else {
      const cy = (fy(f - 1) + fy(f)) / 2;
      s += '<circle cx="' + sx(i) + '" cy="' + cy + '" r="' + r + '" fill="var(--accent)"/>';
      const fg = chord.fingers[i];
      if (big && fg) s += '<text x="' + sx(i) + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="var(--bg)">' + fg + '</text>';
    }
  }
  s += '</svg>';
  return s;
}

/* ---------- 和弦库 ---------- */
const selected = [];   /* 训练所选和弦名 */
let current = CHORDS[0];

function renderLibrary() {
  $('uke-lib').innerHTML = CHORDS.map((c) =>
    '<button type="button" class="uke-chip" data-name="' + c.name + '">' +
    chordSVG(c, false) +
    '<span class="mono nm">' + c.name + '</span></button>'
  ).join('');
  $('uke-lib').querySelectorAll('.uke-chip').forEach((btn) => {
    const c = CHORDS.find((x) => x.name === btn.getAttribute('data-name'));
    btn.addEventListener('click', () => {
      current = c;
      strum(c, 'down');
      showCurrent(c);
      toggleSelect(c.name);
    });
  });
  syncChips();
}
function showCurrent(c) {
  $('uke-now').innerHTML =
    '<div class="uke-bigwrap">' + chordSVG(c, true) + '</div>' +
    '<div class="uke-nowmeta"><b>' + c.name + '</b><span class="mono">' + c.g +
    '　指法 ' + c.frets.map((f, i) => TUNING[i].name + f).join(' ') + '</span>' +
    '<div class="uke-strum"><button type="button" class="pie-btn" id="uke-down">↓ 下扫</button>' +
    '<button type="button" class="pie-btn" id="uke-up">↑ 上扫</button></div></div>';
  $('uke-down').addEventListener('click', () => strum(c, 'down'));
  $('uke-up').addEventListener('click', () => strum(c, 'up'));
}
function toggleSelect(name) {
  const i = selected.indexOf(name);
  if (i >= 0) selected.splice(i, 1); else selected.push(name);
  syncChips();
  renderSelected();
}
function syncChips() {
  $('uke-lib').querySelectorAll('.uke-chip').forEach((btn) => {
    btn.classList.toggle('sel', selected.indexOf(btn.getAttribute('data-name')) >= 0);
  });
}
function renderSelected() {
  const box = $('uke-selected');
  if (!selected.length) {
    box.innerHTML = '<span class="mono" style="color:var(--ink2); font-size:12px;">点上方和弦加入训练序列（至少 2 个）</span>';
    return;
  }
  box.innerHTML = selected.map((n, i) =>
    '<span class="uke-seq mono">' + (i + 1) + '. ' + n + '</span>').join('<span class="uke-arrow">→</span>');
}

/* ---------- 换和弦训练器（前瞻调度） ---------- */
let trainer = { on: false, beat: 0, next: 0, idx: 0, timer: null, countIn: 0 };
function bpm() { return Math.max(30, Math.min(200, parseInt($('uke-bpm').value, 10) || 60)); }
function bpc() { return Math.max(1, Math.min(8, parseInt($('uke-bpc').value, 10) || 4)); }

function startTrainer() {
  if (selected.length < 2) { $('uke-hint').textContent = '请先选择至少 2 个和弦'; return; }
  const ctx = ac();
  trainer.on = true; trainer.beat = 0; trainer.idx = 0;
  trainer.countIn = bpc();                 /* 预备一小节 */
  trainer.next = ctx.currentTime + 0.25;
  $('uke-start').textContent = '■ 停止';
  $('uke-hint').textContent = '';
  scheduler();
}
function stopTrainer() {
  trainer.on = false;
  if (trainer.timer) { clearTimeout(trainer.timer); trainer.timer = null; }
  $('uke-start').textContent = '▶ 开始训练';
  $('uke-stage').classList.remove('go');
  $('uke-count').textContent = '';
}
function scheduler() {
  const ctx = ac();
  const spb = 60 / bpm();
  while (trainer.next < ctx.currentTime + 0.12) {
    scheduleBeat(trainer.beat, trainer.next, spb);
    trainer.beat++;
    trainer.next += spb;
  }
  if (trainer.on) trainer.timer = setTimeout(scheduler, 25);
}
function scheduleBeat(beat, when, spb) {
  const ctx = ac();
  const per = bpc();
  const inCount = beat < trainer.countIn;
  const local = inCount ? beat : (beat - trainer.countIn) % per;
  const accent = local === 0;
  click(when, accent);
  /* 换和弦 + 自动示范扫弦：正式第一拍 */
  let chordAtBeat = null, nextChord = null, isCount = inCount;
  if (!inCount) {
    const barIdx = Math.floor((beat - trainer.countIn) / per);
    const ci = ((barIdx % selected.length) + selected.length) % selected.length;
    chordAtBeat = CHORDS.find((c) => c.name === selected[ci]);
    nextChord = CHORDS.find((c) => c.name === selected[(ci + 1) % selected.length]);
    if (accent && $('uke-demo').checked) strum(chordAtBeat, 'down', when);
  }
  /* 对齐时间做可视更新 */
  const delayMs = Math.max(0, (when - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (!trainer.on) return;
    beatDots(local, per, isCount);
    if (isCount) {
      $('uke-count').textContent = '预备 ' + (per - local);
      $('uke-stage').classList.remove('go');
    } else if (accent) {
      $('uke-count').textContent = '';
      $('uke-stage').classList.add('go');
      current = chordAtBeat;
      $('uke-nowbig').innerHTML = chordSVG(chordAtBeat, true);
      $('uke-nowname').textContent = chordAtBeat.name;
      $('uke-nextname').textContent = '下一个　' + nextChord.name;
    }
  }, delayMs);
}
function beatDots(local, per, isCount) {
  const dots = [];
  for (let i = 0; i < per; i++) {
    dots.push('<span class="uke-dot' + (i === local ? (isCount ? ' count' : ' on') : '') + '"></span>');
  }
  $('uke-beats').innerHTML = dots.join('');
}

/* ---------- 调音器：标准音 + 麦克风 ---------- */
function tone(freq) {
  const ctx = ac();
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  o2.type = 'triangle'; o2.frequency.value = freq; o2.detune.value = 3;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.04);
  g.gain.setValueAtTime(0.32, t + 2.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  o.connect(g); o2.connect(g); g.connect(master);
  o.start(t); o2.start(t); o.stop(t + 2.9); o2.stop(t + 2.9);
}
let mic = { on: false, stream: null, analyser: null, buf: null, raf: null };
function autoCorrelate(buf, sr) {
  let SIZE = buf.length, rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / SIZE) < 0.01) return -1;
  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < 0.2) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < 0.2) { r2 = SIZE - i; break; }
  const b = buf.slice(r1, r2); SIZE = b.length;
  if (SIZE < 8) return -1;
  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] += b[j] * b[j + i];
  let d = 0; while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, T0 = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; T0 = i; }
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);
  return sr / T0;
}
function nearestString(freq) {
  let best = TUNING[0], bestC = 1e9;
  TUNING.forEach((s) => {
    let f = freq;
    while (f < s.freq / 1.4142) f *= 2;
    while (f > s.freq * 1.4142) f /= 2;
    const cents = 1200 * Math.log2(f / s.freq);
    if (Math.abs(cents) < Math.abs(bestC)) { bestC = cents; best = s; }
  });
  return { s: best, cents: bestC };
}
async function micToggle() {
  if (mic.on) { stopMic(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $('uke-micnote').textContent = '此浏览器不支持麦克风调音'; return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false } });
    const ctx = ac();
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(an);
    mic = { on: true, stream, analyser: an, buf: new Float32Array(an.fftSize), raf: null };
    $('uke-mic').textContent = '■ 停止麦克风';
    $('uke-micnote').textContent = '拨响一根弦，对照指针微调弦钮';
    micLoop();
  } catch (e) {
    $('uke-micnote').textContent = '未获得麦克风权限';
  }
}
function stopMic() {
  if (!mic.on) return;
  mic.on = false;
  if (mic.raf) cancelAnimationFrame(mic.raf);
  if (mic.stream) mic.stream.getTracks().forEach((t) => t.stop());
  const b = $('uke-mic'); if (b) b.textContent = '🎤 用麦克风调音';
  const box = $('uke-tunerbox'); if (box) box.classList.remove('intune');
  if ($('uke-tunernote')) $('uke-tunernote').textContent = '—';
  if ($('uke-tunercents')) $('uke-tunercents').textContent = '';
  if ($('uke-needle')) $('uke-needle').style.transform = 'translateX(-50%) rotate(0deg)';
}
function micLoop() {
  if (!mic.on) return;
  const ctx = ac();
  mic.analyser.getFloatTimeDomainData(mic.buf);
  const f = autoCorrelate(mic.buf, ctx.sampleRate);
  if (f > 60 && f < 1200) {
    const r = nearestString(f);
    $('uke-tunernote').textContent = r.s.name;
    const good = Math.abs(r.cents) < 5;
    $('uke-tunercents').textContent = good ? '✓ 准了' :
      (Math.round(Math.abs(r.cents)) + ' 音分 · ' + (r.cents > 0 ? '偏高，松一点' : '偏低，紧一点'));
    const deg = Math.max(-45, Math.min(45, r.cents / 50 * 45));
    $('uke-needle').style.transform = 'translateX(-50%) rotate(' + deg + 'deg)';
    $('uke-tunerbox').classList.toggle('intune', good);
  }
  mic.raf = requestAnimationFrame(micLoop);
}

/* ---------- 入门·跟我扫弦（单和弦超慢速） ---------- */
let beg = { on: false, timer: null, next: 0, beat: 0 };
function begBpm() { return Math.max(30, Math.min(120, parseInt($('beg-bpm').value, 10) || 50)); }
function begStart() {
  const ctx = ac(); beg.on = true; beg.beat = 0; beg.next = ctx.currentTime + 0.25;
  $('beg-start').textContent = '■ 停止'; begSched();
}
function begStop() {
  beg.on = false; if (beg.timer) clearTimeout(beg.timer);
  const b = $('beg-start'); if (b) b.textContent = '▶ 开始跟练';
  if ($('beg-prompt')) $('beg-prompt').textContent = '';
  if ($('beg-arrow')) $('beg-arrow').classList.remove('hit');
}
function begSched() {
  const ctx = ac(); const spb = 60 / begBpm();
  while (beg.next < ctx.currentTime + 0.12) { begBeat(beg.beat, beg.next); beg.beat++; beg.next += spb; }
  if (beg.on) beg.timer = setTimeout(begSched, 25);
}
function begBeat(beat, when) {
  const ctx = ac();
  const inCount = beat < 4, local = inCount ? beat : (beat - 4) % 4;
  click(when, local === 0);
  const chord = CHORDS.find((c) => c.name === $('beg-chord').value) || CHORDS[0];
  if (!inCount && $('beg-demo').checked) strum(chord, 'down', when);
  const delay = Math.max(0, (when - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (!beg.on) return;
    if (inCount) { $('beg-prompt').textContent = '预备 ' + (4 - local); }
    else {
      $('beg-prompt').textContent = String(local + 1);
      const a = $('beg-arrow'); a.classList.add('hit'); setTimeout(() => a.classList.remove('hit'), 130);
    }
  }, delay);
}

/* ---------- 通用：音频前瞻循环器 ---------- */
function makeLooper(tick, interval) {
  const L = { on: false, i: 0, next: 0, timer: null };
  L.start = function () { const ctx = ac(); L.on = true; L.i = 0; L.next = ctx.currentTime + 0.2; run(); };
  L.stop = function () { L.on = false; if (L.timer) { clearTimeout(L.timer); L.timer = null; } };
  function run() {
    const ctx = ac();
    while (L.next < ctx.currentTime + 0.12) { tick(L.i, L.next); L.i++; L.next += interval(); }
    if (L.on) L.timer = setTimeout(run, 25);
  }
  return L;
}
function uiAt(when, fn) { const ctx = ac(); setTimeout(fn, Math.max(0, (when - ctx.currentTime) * 1000)); }
/* 切音「恰」声：短噪声经带通 */
let noiseBuf = null;
function chnk(when) {
  const ctx = ac();
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0.5;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(when || ctx.currentTime);
}

/* ---------- 扫弦节奏型（8 个八分槽位；D 下扫 U 上扫 X 切音） ---------- */
const PATTERNS = [
  { name: '四分下扫', slots: ['D', '', 'D', '', 'D', '', 'D', ''], hint: '最基础：每拍一个下扫，手腕放松像甩水' },
  { name: '八分扫弦', slots: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'], hint: '下上交替：下扫踩在拍点上，上扫在半拍，手腕匀速摆动不停' },
  { name: '民谣万能型', slots: ['D', '', 'D', 'U', '', 'U', 'D', 'U'], hint: '口诀「下、下上、上下上」——先慢速念口诀再扫，会了这个能弹一半的歌' },
  { name: '慢摇抒情', slots: ['D', '', '', 'U', '', 'U', 'D', ''], hint: '留白多，适合慢歌；空拍时手继续虚挥保持节奏' },
  { name: '切音型', slots: ['D', '', 'X', 'U', '', 'U', 'X', 'U'], hint: 'X=切音：扫完立刻用右手掌侧面捂住琴弦发出「恰」' },
  { name: '华尔兹 3/4', slots: ['D', '', 'U', '', 'U', ''], hint: '三拍子「蹦-恰-恰」，生日快乐就用它' },
];
let patIdx = 2;
function patBpm() { return Math.max(30, Math.min(140, parseInt($('pat-bpm').value, 10) || 60)); }
const patLoop = makeLooper(patTick, () => 30 / patBpm());
function patTick(i, when) {
  const p = PATTERNS[patIdx], n = p.slots.length;
  const inCount = i < n, s = i % n, onBeat = s % 2 === 0;
  if (onBeat) click(when, s === 0);
  if (!inCount) {
    const ch = chordByName($('pat-chord').value) || CHORDS[0];
    const slot = p.slots[s];
    if (slot === 'D') strum(ch, 'down', when, 0.5);
    else if (slot === 'U') strum(ch, 'up', when, 0.3);
    else if (slot === 'X') chnk(when);
  }
  uiAt(when, () => {
    if (!patLoop.on) return;
    $('pat-count').textContent = inCount ? '预备 ' + Math.ceil((n - s) / 2) : '';
    document.querySelectorAll('#pat-row .uke-slot').forEach((el, k) => {
      el.classList.toggle('on', !inCount && k === s);
      el.classList.toggle('count', inCount && k === s);
    });
  });
}
function renderPatterns() {
  $('pat-list').innerHTML = PATTERNS.map((p, i) =>
    '<button type="button" class="pie-btn uke-patbtn' + (i === patIdx ? ' on' : '') + '" data-i="' + i + '">' + p.name + '</button>').join('');
  $('pat-list').querySelectorAll('.uke-patbtn').forEach((b) => b.addEventListener('click', () => {
    patStop(); patIdx = parseInt(b.getAttribute('data-i'), 10);
    $('pat-list').querySelectorAll('.uke-patbtn').forEach((x, i) => x.classList.toggle('on', i === patIdx));
    renderPatRow();
  }));
  renderPatRow();
}
function renderPatRow() {
  const p = PATTERNS[patIdx];
  const SYM = { D: '↓', U: '↑', X: '✕', '': '·' };
  $('pat-row').innerHTML = p.slots.map((s, i) =>
    '<span class="uke-slot' + (i % 2 === 0 ? ' beat' : '') + (s === '' ? ' rest' : '') + '">' + SYM[s] + '</span>').join('');
  $('pat-hint').textContent = p.hint;
}
function patStop() {
  patLoop.stop();
  const b = $('pat-start'); if (b) b.textContent = '▶ 开始';
  if ($('pat-count')) $('pat-count').textContent = '';
  document.querySelectorAll('#pat-row .uke-slot').forEach((el) => el.classList.remove('on', 'count'));
}

/* ---------- 弹唱曲库（公版/传统曲目，简化编配） ---------- */
const SONGS = [
  { name: '小星星', key: 'C', bpm: 70, bpb: 4, step: 2, chords: ['C', 'F', 'G7'], seg: [
    ['C', '一闪'], ['C', '一闪'], ['F', '亮晶'], ['C', '晶～'],
    ['F', '满天'], ['C', '都是'], ['G7', '小星'], ['C', '星～'],
    ['C', '挂在'], ['F', '天空'], ['C', '放光'], ['G7', '明～'],
    ['C', '好像'], ['F', '许多'], ['C', '小眼'], ['G7', '睛～'],
    ['C', '一闪'], ['C', '一闪'], ['F', '亮晶'], ['C', '晶～'],
    ['F', '满天'], ['C', '都是'], ['G7', '小星'], ['C', '星～'],
  ] },
  { name: '两只老虎', key: 'C', bpm: 84, bpb: 4, step: 2, chords: ['C', 'F', 'G7'], seg: [
    ['C', '两只'], ['C', '老虎'], ['C', '两只'], ['C', '老虎'],
    ['C', '跑得'], ['C', '快～'], ['C', '跑得'], ['C', '快～'],
    ['F', '一只没'], ['C', '有眼睛'], ['F', '一只没'], ['C', '有尾巴'],
    ['G7', '真奇'], ['C', '怪～'], ['G7', '真奇'], ['C', '怪～'],
  ] },
  { name: '送别', key: 'C', bpm: 66, bpb: 4, step: 2, chords: ['C', 'F', 'G7', 'Am'], seg: [
    ['C', '长亭'], ['C', '外～'], ['F', '古道'], ['C', '边～'],
    ['C', '芳草'], ['Am', '碧连'], ['G7', '天～'], ['G7', '～～'],
    ['C', '晚风'], ['C', '拂柳'], ['F', '笛声'], ['G7', '残～'],
    ['C', '夕阳'], ['G7', '山外'], ['C', '山～'], ['C', '～～'],
    ['F', '天之'], ['C', '涯～'], ['F', '地之'], ['C', '角～'],
    ['C', '知交'], ['Am', '半零'], ['G7', '落～'], ['G7', '～～'],
    ['C', '一壶'], ['C', '浊酒'], ['F', '尽余'], ['G7', '欢～'],
    ['C', '今宵'], ['G7', '别梦'], ['C', '寒～'], ['C', '～～'],
  ] },
  { name: '生日快乐', key: 'C', bpm: 78, bpb: 3, step: 3, chords: ['C', 'F', 'G7'], seg: [
    ['C', '祝你生日'], ['G7', '快乐～'], ['G7', '祝你生日'], ['C', '快乐～'],
    ['C', '祝你生日'], ['F', '快乐～'], ['C', '祝你'], ['G7', '生日'], ['C', '快乐～'],
  ] },
];
let songIdx = 0, songSegStarts = [], songTotal = 0;
function songData() { return SONGS[songIdx]; }
function songBpm() { return Math.max(40, Math.min(140, parseInt($('song-bpm').value, 10) || songData().bpm)); }
function songPrep() {
  const s = songData(); songSegStarts = []; let acc = 0;
  s.seg.forEach((seg) => { songSegStarts.push(acc); acc += seg[2] || s.step; });
  songTotal = acc;
}
function segAt(beat) { let k = 0; for (let i = 0; i < songSegStarts.length; i++) if (songSegStarts[i] <= beat) k = i; return k; }
const songLoop = makeLooper(songTick, () => 60 / songBpm());
function songTick(i, when) {
  const s = songData(), cnt = s.bpb || 4;
  if (i < cnt) {
    click(when, i === 0);
    uiAt(when, () => { if (songLoop.on) $('song-count').textContent = '预备 ' + (cnt - i); });
    return;
  }
  const beat = (i - cnt) % songTotal;
  const segI = segAt(beat);
  const isStart = songSegStarts[segI] === beat;
  click(when, isStart);
  if (isStart && $('song-demo').checked) strum(chordByName(s.seg[segI][0]) || CHORDS[0], 'down', when, 0.5);
  uiAt(when, () => {
    if (!songLoop.on) return;
    $('song-count').textContent = '';
    if (isStart) songShowSeg(segI);
  });
}
function songShowSeg(k) {
  const s = songData();
  const spans = document.querySelectorAll('#song-lyrics .seg');
  spans.forEach((el, i) => el.classList.toggle('on', i === k));
  if (spans[k] && spans[k].scrollIntoView) spans[k].scrollIntoView({ block: 'nearest' });
  $('song-nowname').textContent = s.seg[k][0];
  let nx = '';
  for (let i = k + 1; i < s.seg.length; i++) if (s.seg[i][0] !== s.seg[k][0]) { nx = s.seg[i][0]; break; }
  if (!nx) for (let i = 0; i < s.seg.length; i++) if (s.seg[i][0] !== s.seg[k][0]) { nx = s.seg[i][0]; break; }
  $('song-nextname').textContent = nx ? '下一个　' + nx : '全曲同一和弦';
  $('song-nowdiagram').innerHTML = chordSVG(chordByName(s.seg[k][0]) || CHORDS[0], true);
}
function loadSong() {
  const s = songData();
  songPrep();
  document.querySelectorAll('#song-list .uke-patbtn').forEach((b, i) => b.classList.toggle('on', i === songIdx));
  $('song-bpm').value = s.bpm; $('song-bpmv').textContent = s.bpm;
  $('song-meta').innerHTML = '调式 ' + s.key + ' · ' + (s.bpb || 4) + ' 拍子 · 用到 ' +
    s.chords.map((c) => '<b>' + c + '</b>').join(' ') + ' · 简化编配';
  $('song-chords').innerHTML = s.chords.map((n) =>
    '<span class="uke-songchord">' + chordSVG(chordByName(n), false) + '<i class="mono">' + n + '</i></span>').join('');
  $('song-lyrics').innerHTML = s.seg.map((seg) =>
    '<span class="seg"><i class="mono">' + seg[0] + '</i>' + seg[1] + '</span>').join('');
  songShowSeg(0);
}
function renderSongs() {
  $('song-list').innerHTML = SONGS.map((s, i) =>
    '<button type="button" class="pie-btn uke-patbtn' + (i === songIdx ? ' on' : '') + '" data-i="' + i + '">' + s.name + '</button>').join('');
  $('song-list').querySelectorAll('.uke-patbtn').forEach((b) => b.addEventListener('click', () => {
    songStop(); songIdx = parseInt(b.getAttribute('data-i'), 10); loadSong();
  }));
  loadSong();
}
function songStop() {
  songLoop.stop();
  const b = $('song-start'); if (b) b.textContent = '▶ 播放伴奏';
  if ($('song-count')) $('song-count').textContent = '';
}

/* ---------- 单音旋律 TAB（弦序 0=G 1=C 2=E 3=A；[弦,品,拍,字]） ---------- */
const MELODIES = [
  { name: '小星星（旋律）', bpm: 80, notes: [
    [1, 0, 1, '一'], [1, 0, 1, '闪'], [2, 3, 1, '一'], [2, 3, 1, '闪'], [3, 0, 1, '亮'], [3, 0, 1, '晶'], [2, 3, 2, '晶'],
    [2, 1, 1, '满'], [2, 1, 1, '天'], [2, 0, 1, '都'], [2, 0, 1, '是'], [1, 2, 1, '小'], [1, 2, 1, '星'], [1, 0, 2, '星'],
    [2, 3, 1, '挂'], [2, 3, 1, '在'], [2, 1, 1, '天'], [2, 1, 1, '空'], [2, 0, 1, '放'], [2, 0, 1, '光'], [1, 2, 2, '明'],
    [2, 3, 1, '好'], [2, 3, 1, '像'], [2, 1, 1, '许'], [2, 1, 1, '多'], [2, 0, 1, '小'], [2, 0, 1, '眼'], [1, 2, 2, '睛'],
    [1, 0, 1, '一'], [1, 0, 1, '闪'], [2, 3, 1, '一'], [2, 3, 1, '闪'], [3, 0, 1, '亮'], [3, 0, 1, '晶'], [2, 3, 2, '晶'],
    [2, 1, 1, '满'], [2, 1, 1, '天'], [2, 0, 1, '都'], [2, 0, 1, '是'], [1, 2, 1, '小'], [1, 2, 1, '星'], [1, 0, 2, '星'],
  ] },
  { name: '欢乐颂（旋律）', bpm: 92, notes: [
    [2, 0, 1], [2, 0, 1], [2, 1, 1], [2, 3, 1], [2, 3, 1], [2, 1, 1], [2, 0, 1], [1, 2, 1],
    [1, 0, 1], [1, 0, 1], [1, 2, 1], [2, 0, 1], [2, 0, 1.5], [1, 2, 0.5], [1, 2, 2],
    [2, 0, 1], [2, 0, 1], [2, 1, 1], [2, 3, 1], [2, 3, 1], [2, 1, 1], [2, 0, 1], [1, 2, 1],
    [1, 0, 1], [1, 0, 1], [1, 2, 1], [2, 0, 1], [1, 2, 1.5], [1, 0, 0.5], [1, 0, 2],
  ] },
];
let melIdx = 0;
const mel = { on: false, idx: 0, next: 0, timer: null };
function melBpm() { return Math.max(40, Math.min(140, parseInt($('mel-bpm').value, 10) || MELODIES[melIdx].bpm)); }
function melStart() {
  const ctx = ac(), spb = 60 / melBpm();
  mel.on = true; mel.idx = 0; mel.next = ctx.currentTime + 0.2;
  for (let k = 0; k < 4; k++) click(mel.next + k * spb, k === 0);
  mel.next += 4 * spb;
  $('mel-start').textContent = '■ 停止';
  melRun();
}
function melRun() {
  if (!mel.on) return;
  const ctx = ac(), spb = 60 / melBpm();
  const notes = MELODIES[melIdx].notes;
  while (mel.next < ctx.currentTime + 0.15) {
    if (mel.idx >= notes.length) { mel.idx = 0; mel.next += spb; continue; }
    const n = notes[mel.idx], at = mel.next, ii = mel.idx;
    pluck(noteFreq(n[0], n[1]), at, 0.6);
    uiAt(at, () => { if (mel.on) melHi(ii); });
    mel.next += n[2] * spb; mel.idx++;
  }
  mel.timer = setTimeout(melRun, 25);
}
function melStop() {
  mel.on = false; if (mel.timer) { clearTimeout(mel.timer); mel.timer = null; }
  const b = $('mel-start'); if (b) b.textContent = '▶ 播放';
  document.querySelectorAll('#mel-tab .col.on').forEach((el) => el.classList.remove('on'));
}
function melHi(i) {
  const cols = document.querySelectorAll('#mel-tab .col');
  cols.forEach((el, k) => el.classList.toggle('on', k === i));
  if (cols[i] && cols[i].scrollIntoView) cols[i].scrollIntoView({ block: 'nearest', inline: 'center' });
}
function renderMelody() {
  document.querySelectorAll('#mel-list .uke-patbtn').forEach((b, i) => b.classList.toggle('on', i === melIdx));
  const m = MELODIES[melIdx];
  $('mel-bpm').value = m.bpm; $('mel-bpmv').textContent = m.bpm;
  const ROWS = [3, 2, 1, 0], LBL = ['A', 'E', 'C', 'G'];
  $('mel-tab').innerHTML =
    '<span class="lbl mono">' + LBL.map((l) => '<i>' + l + '</i>').join('') + '<b>弦</b></span>' +
    m.notes.map((n) =>
      '<span class="col mono">' + ROWS.map((r) => '<i>' + (n[0] === r ? n[1] : '·') + '</i>').join('') +
      '<b>' + (n[3] || '') + '</b></span>').join('');
}

/* ---------- 和弦听辨（练耳小游戏） ---------- */
const EAR_LEVELS = [
  { name: '入门 · 2 个', set: ['C', 'F'] },
  { name: '初级 · 3 个', set: ['C', 'F', 'G'] },
  { name: '进阶 · 4 个', set: ['C', 'F', 'G', 'Am'] },
  { name: '挑战 · 6 个', set: ['C', 'F', 'G', 'Am', 'Dm', 'Em'] },
];
let earLv = 0, earAns = null, earScore = 0, earStreak = 0, earLock = false, earBest = 0;
try { earBest = parseInt(localStorage.getItem('yzzn-uke-ear') || '0', 10) || 0; } catch (e) {}
function earNew() {
  const set = EAR_LEVELS[earLv].set;
  earAns = set[Math.floor(Math.random() * set.length)];
  earLock = false;
  $('ear-btns').querySelectorAll('.uke-earbtn').forEach((b) => b.classList.remove('good', 'bad'));
  $('ear-msg').textContent = '听！这是哪个和弦？';
  strum(chordByName(earAns), 'down');
}
function renderEarBtns() {
  $('ear-btns').innerHTML = EAR_LEVELS[earLv].set.map((n) =>
    '<button type="button" class="pie-btn uke-earbtn" data-n="' + n + '">' + n + '</button>').join('');
  $('ear-btns').querySelectorAll('.uke-earbtn').forEach((b) => b.addEventListener('click', () => earGuess(b)));
}
function earGuess(btn) {
  if (earLock || !earAns) return;
  const n = btn.getAttribute('data-n');
  if (n === earAns) {
    earLock = true; btn.classList.add('good');
    earScore++; earStreak++;
    if (earStreak > earBest) { earBest = earStreak; try { localStorage.setItem('yzzn-uke-ear', String(earBest)); } catch (e) {} }
    $('ear-msg').textContent = '✓ 答对了，是 ' + earAns + '！';
    setTimeout(() => { if ($('ear-btns')) earNew(); }, 950);
  } else {
    btn.classList.add('bad'); earStreak = 0;
    $('ear-msg').textContent = '不是 ' + n + '，再听一次';
    strum(chordByName(earAns), 'down');
  }
  earStat();
}
function earStat() { $('ear-stat').textContent = '答对 ' + earScore + ' · 连对 ' + earStreak + ' · 最佳连对 ' + earBest; }

/* ---------- 7 天入门计划（进度存本地） ---------- */
const PLAN = [
  { d: '第 1 天', title: '把琴调准 + 认识它', tasks: ['用「① 调音」把四根弦全部调准', '记住四根弦名 G · C · E · A', '右手拇指逐根空弦拨 20 下，听音色'] },
  { d: '第 2 天', title: '第一个和弦 C', tasks: ['按响 C 和弦，四根弦都清晰不闷', '「② 入门第一课」跟练下扫 3 分钟', 'C 按下-放开-再按下，重复 20 次'] },
  { d: '第 3 天', title: '第二个和弦 Am + 互换', tasks: ['按响 Am（比 C 只多动一根手指）', 'C ⇄ Am 慢速互换 20 次', '「⑤ 换和弦训练」C-Am · 50BPM · 2 分钟'] },
  { d: '第 4 天', title: '节奏型：八分扫弦', tasks: ['「③ 节奏型」跟练八分扫弦 2 分钟', 'C 和弦配八分扫弦 2 分钟', 'Am 和弦配八分扫弦 2 分钟'] },
  { d: '第 5 天', title: '新和弦 F 和 G7', tasks: ['按响 F（两根手指）', '按响 G7（三根手指，慢慢来）', '「⑤ 换和弦训练」C-F、C-G7 各 2 分钟'] },
  { d: '第 6 天', title: '民谣万能节奏型', tasks: ['「③ 节奏型」慢速跟练「下、下上、上下上」', '边念口诀边扫，连续 10 遍不断', '配 C 和弦完整扫 10 遍'] },
  { d: '第 7 天', title: '第一首歌！', tasks: ['「⑥ 弹唱曲库」开小星星伴奏跟弹', '不看图能按出 C、F、G7', '完整弹完一遍，给自己录一段 🎉'] },
];
let planState = {};
try { planState = JSON.parse(localStorage.getItem('yzzn-uke-plan') || '{}') || {}; } catch (e) { planState = {}; }
function planSave() { try { localStorage.setItem('yzzn-uke-plan', JSON.stringify(planState)); } catch (e) {} }
function renderPlan() {
  const total = PLAN.reduce((t, d) => t + d.tasks.length, 0);
  const done = Object.keys(planState).filter((k) => planState[k]).length;
  $('plan-prog').innerHTML = '<i style="width:' + Math.round((done / total) * 100) + '%"></i>';
  $('plan-progtext').textContent = done + ' / ' + total + ' 项完成' + (done >= total ? '　🎉 一周入门达成！' : '');
  $('plan-list').innerHTML = PLAN.map((d, di) => {
    const dayDone = d.tasks.every((_, ti) => planState[di + '-' + ti]);
    return '<div class="uke-planday' + (dayDone ? ' done' : '') + '">' +
      '<div class="pd-h mono">' + d.d + '　<b>' + d.title + '</b>' + (dayDone ? '<span class="ok">✓</span>' : '') + '</div>' +
      d.tasks.map((t, ti) => {
        const k = di + '-' + ti;
        return '<label class="pd-t"><input type="checkbox" data-k="' + k + '"' + (planState[k] ? ' checked' : '') + '/><span>' + t + '</span></label>';
      }).join('') + '</div>';
  }).join('');
  $('plan-list').querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
    planState[cb.getAttribute('data-k')] = cb.checked; planSave(); renderPlan();
  }));
}

/* ---------- 标签页 ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.uke-tab');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('on'));
    tab.classList.add('on');
    const p = tab.getAttribute('data-p');
    document.querySelectorAll('.uke-panel').forEach((pan) => { pan.hidden = pan.getAttribute('data-p') !== p; });
    if (p !== 'tune') stopMic();
    if (p !== 'start') begStop();
    if (p !== 'trainer' && trainer.on) stopTrainer();
    if (p !== 'rhythm') patStop();
    if (p !== 'songs') songStop();
    if (p !== 'melody') melStop();
  }));
}

function init() {
  if (!$('uke-lib')) return;
  setupTabs();
  renderLibrary();
  showCurrent(current);
  renderSelected();
  beatDots(-1, bpc(), false);
  /* 调音 */
  document.querySelectorAll('.uke-ref').forEach((b) => b.addEventListener('click', () => tone(parseFloat(b.getAttribute('data-f')))));
  if ($('uke-mic')) $('uke-mic').addEventListener('click', micToggle);
  /* 入门 */
  if ($('beg-cdiagram')) $('beg-cdiagram').innerHTML = chordSVG(CHORDS.find((c) => c.name === 'C'), true);
  if ($('beg-first')) $('beg-first').addEventListener('click', () => strum(CHORDS.find((c) => c.name === 'C'), 'down'));
  if ($('beg-chord')) $('beg-chord').innerHTML = ['C', 'Am', 'F'].map((n) => '<option>' + n + '</option>').join('');
  if ($('beg-bpm')) { $('beg-bpmv').textContent = begBpm(); $('beg-bpm').addEventListener('input', () => { $('beg-bpmv').textContent = begBpm(); }); }
  if ($('beg-start')) $('beg-start').addEventListener('click', () => { beg.on ? begStop() : begStart(); });
  /* 换和弦训练 */
  $('uke-bpm').addEventListener('input', () => { $('uke-bpmv').textContent = bpm(); });
  $('uke-bpc').addEventListener('change', () => beatDots(-1, bpc(), false));
  $('uke-bpmv').textContent = bpm();
  $('uke-start').addEventListener('click', () => { trainer.on ? stopTrainer() : startTrainer(); });
  $('uke-clear').addEventListener('click', () => { selected.length = 0; syncChips(); renderSelected(); });
  document.querySelectorAll('.uke-preset').forEach((b) => {
    b.addEventListener('click', () => {
      selected.length = 0;
      b.getAttribute('data-set').split(',').forEach((n) => { if (CHORDS.find((c) => c.name === n)) selected.push(n); });
      syncChips(); renderSelected();
    });
  });
  /* 节奏型 */
  if ($('pat-list')) {
    $('pat-chord').innerHTML = ['C', 'Am', 'F', 'G', 'G7', 'Em'].map((n) => '<option>' + n + '</option>').join('');
    renderPatterns();
    $('pat-bpm').addEventListener('input', () => { $('pat-bpmv').textContent = patBpm(); });
    $('pat-start').addEventListener('click', () => {
      if (patLoop.on) { patStop(); } else { patLoop.start(); $('pat-start').textContent = '■ 停止'; }
    });
  }
  /* 弹唱曲库 */
  if ($('song-list')) {
    renderSongs();
    $('song-bpm').addEventListener('input', () => { $('song-bpmv').textContent = songBpm(); });
    $('song-start').addEventListener('click', () => {
      if (songLoop.on) { songStop(); } else { songPrep(); songLoop.start(); $('song-start').textContent = '■ 停止'; }
    });
  }
  /* 单音旋律 */
  if ($('mel-list')) {
    $('mel-list').innerHTML = MELODIES.map((m, i) =>
      '<button type="button" class="pie-btn uke-patbtn' + (i === melIdx ? ' on' : '') + '" data-i="' + i + '">' + m.name + '</button>').join('');
    $('mel-list').querySelectorAll('.uke-patbtn').forEach((b) => b.addEventListener('click', () => {
      melStop(); melIdx = parseInt(b.getAttribute('data-i'), 10); renderMelody();
    }));
    renderMelody();
    $('mel-bpm').addEventListener('input', () => { $('mel-bpmv').textContent = melBpm(); });
    $('mel-start').addEventListener('click', () => { mel.on ? melStop() : melStart(); });
  }
  /* 和弦听辨 */
  if ($('ear-btns')) {
    $('ear-lvs').innerHTML = EAR_LEVELS.map((l, i) =>
      '<button type="button" class="pie-btn uke-patbtn' + (i === earLv ? ' on' : '') + '" data-i="' + i + '">' + l.name + '</button>').join('');
    $('ear-lvs').querySelectorAll('.uke-patbtn').forEach((b) => b.addEventListener('click', () => {
      earLv = parseInt(b.getAttribute('data-i'), 10); earAns = null;
      $('ear-lvs').querySelectorAll('.uke-patbtn').forEach((x, i) => x.classList.toggle('on', i === earLv));
      renderEarBtns();
      $('ear-msg').textContent = '点「播放和弦」开始';
    }));
    renderEarBtns();
    earStat();
    $('ear-play').addEventListener('click', () => { (!earAns || earLock) ? earNew() : strum(chordByName(earAns), 'down'); });
  }
  /* 7 天计划 */
  if ($('plan-list')) {
    renderPlan();
    $('plan-reset').addEventListener('click', () => { planState = {}; planSave(); renderPlan(); });
  }
}
init();
