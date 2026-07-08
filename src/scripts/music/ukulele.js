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
function strum(chord, dir, when) {
  const ctx = ac();
  const t0 = (when || ctx.currentTime) + 0.01;
  const order = dir === 'up' ? [3, 2, 1, 0] : [0, 1, 2, 3];
  order.forEach((s, i) => {
    const f = chord.frets[s];
    if (f < 0) return;
    pluck(noteFreq(s, f), t0 + i * 0.03, 0.5);
  });
}
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
  let s = '<svg viewBox="0 0 ' + SW + ' ' + SH + '" class="uke-diagram" role="img" aria-label="' + chord.name + ' 和弦指法">';
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

function init() {
  if (!$('uke-lib')) return;
  renderLibrary();
  showCurrent(current);
  renderSelected();
  beatDots(-1, bpc(), false);
  $('uke-bpm').addEventListener('input', () => { $('uke-bpmv').textContent = bpm(); });
  $('uke-bpc').addEventListener('change', () => beatDots(-1, bpc(), false));
  $('uke-bpmv').textContent = bpm();
  $('uke-start').addEventListener('click', () => { trainer.on ? stopTrainer() : startTrainer(); });
  $('uke-clear').addEventListener('click', () => { selected.length = 0; syncChips(); renderSelected(); });
  /* 常用套路一键装入 */
  document.querySelectorAll('.uke-preset').forEach((b) => {
    b.addEventListener('click', () => {
      selected.length = 0;
      b.getAttribute('data-set').split(',').forEach((n) => { if (CHORDS.find((c) => c.name === n)) selected.push(n); });
      syncChips(); renderSelected();
    });
  });
}
init();
