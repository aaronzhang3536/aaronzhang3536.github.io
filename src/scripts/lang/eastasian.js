/* 东亚语言学习引擎：日语（五十音道场）/ 韩语（谚文道场）共享
   词汇包: /data/lang/<pack>.json → { name, words: [[表记, 读音, 罗马音, 中文], ...] }
   面板: dojo(道场) / rev(复习 SM-2) / game(闯关) / set(设置)，全部数据存 localStorage */

/* ---------- 五十音（平假名基表，片假名 = 码位 +0x60） ---------- */
const KANA_SEION = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'wo'], ['ん', 'n'],
];
const KANA_DAKUON = [
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
];
const KANA_YOUON = [
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'],
  ['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho'],
  ['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho'],
  ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'],
  ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo'],
  ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja'], ['じゅ', 'ju'], ['じょ', 'jo'],
  ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'],
];
const toKata = (s) => Array.from(s).map((c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).join('');

/* ---------- 谚文 ---------- */
const KO_CONS = [
  ['ㄱ', 'g', '기역'], ['ㄴ', 'n', '니은'], ['ㄷ', 'd', '디귿'], ['ㄹ', 'r', '리을'],
  ['ㅁ', 'm', '미음'], ['ㅂ', 'b', '비읍'], ['ㅅ', 's', '시옷'], ['ㅇ', 'ng', '이응'],
  ['ㅈ', 'j', '지읒'], ['ㅊ', 'ch', '치읓'], ['ㅋ', 'k', '키읔'], ['ㅌ', 't', '티읕'],
  ['ㅍ', 'p', '피읖'], ['ㅎ', 'h', '히읗'],
];
const KO_TENSE = [
  ['ㄲ', 'kk', '쌍기역'], ['ㄸ', 'tt', '쌍디귿'], ['ㅃ', 'pp', '쌍비읍'], ['ㅆ', 'ss', '쌍시옷'], ['ㅉ', 'jj', '쌍지읒'],
];
const KO_VOW = [
  ['ㅏ', 'a', '아'], ['ㅑ', 'ya', '야'], ['ㅓ', 'eo', '어'], ['ㅕ', 'yeo', '여'], ['ㅗ', 'o', '오'],
  ['ㅛ', 'yo', '요'], ['ㅜ', 'u', '우'], ['ㅠ', 'yu', '유'], ['ㅡ', 'eu', '으'], ['ㅣ', 'i', '이'],
];
const KO_VOW2 = [
  ['ㅐ', 'ae', '애'], ['ㅒ', 'yae', '얘'], ['ㅔ', 'e', '에'], ['ㅖ', 'ye', '예'],
  ['ㅘ', 'wa', '와'], ['ㅙ', 'wae', '왜'], ['ㅚ', 'oe', '외'], ['ㅝ', 'wo', '워'],
  ['ㅞ', 'we', '웨'], ['ㅟ', 'wi', '위'], ['ㅢ', 'ui', '의'],
];
/* 组字机（초성 19 / 중성 21 / 종성 27+无） */
const KO_CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const KO_CHO_R = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const KO_JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const KO_JUNG_R = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const KO_JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const KO_JONG_R = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
const koCompose = (ci, vi, ti) => String.fromCharCode(0xAC00 + (ci * 21 + vi) * 28 + ti);
const koRom = (ci, vi, ti) => (KO_CHO_R[ci] || '') + KO_JUNG_R[vi] + (KO_JONG_R[ti] || '');

/* ---------- 语言配置 ---------- */
const LANGS = {
  ja: {
    key: 'yzzn-ja', name: '日语', tts: 'ja-JP', pack: '/data/lang/ja-n5.json',
    packName: 'N5 核心词', dojoName: '五十音道场',
    ttsHint: '未检测到日语语音包 —— Windows「设置 → 时间和语言 → 语音」可添加日语，Chrome/Edge 亦自带在线语音。',
  },
  ko: {
    key: 'yzzn-ko', name: '韩语', tts: 'ko-KR', pack: '/data/lang/ko-topik1.json',
    packName: 'TOPIK I 核心词', dojoName: '谚文道场',
    ttsHint: '未检测到韩语语音包 —— Windows「设置 → 时间和语言 → 语音」可添加韩语，Chrome/Edge 亦自带在线语音。',
  },
};

const CHUNK = 24;
const STAGE_TYPES = ['配对', '选择', '听力'];

export function boot(langId) {
  const L = LANGS[langId];
  if (!L || !document.querySelector('.enx-side')) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const today = () => new Date().toISOString().slice(0, 10);

  const K = { words: L.key + '-words', cfg: L.key + '-cfg', dojo: L.key + '-dojo', game: L.key + '-game', daily: L.key + '-daily' };
  let cfg = load(K.cfg, { voice: '', rate: 0.9 });
  let words = load(K.words, []);           /* SRS: {w,r,rom,def,due,iv,ef,rep} */
  let dojoStore = load(K.dojo, {});        /* {itemKey: [right, wrong]} */
  let gameStore = load(K.game, { stars: {} });
  let dk = load(K.daily, {});
  let pack = null;                          /* {name, words:[[w,r,rom,def]]} */
  let G = null;

  /* ---------- TTS ---------- */
  let voices = [];
  function loadVoices() {
    if (!window.speechSynthesis) return;
    voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith(langId));
    const sel = $('ea-voice');
    if (sel) {
      sel.innerHTML = voices.length
        ? voices.map((v) => '<option value="' + esc(v.name) + '"' + (cfg.voice === v.name ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('')
        : '<option value="">（无 ' + L.name + ' 语音）</option>';
    }
    const warn = $('ea-tts-warn');
    if (warn) warn.hidden = voices.length > 0;
  }
  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = L.tts;
    u.rate = cfg.rate || 0.9;
    const v = voices.find((x) => x.name === cfg.voice) || voices[0];
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }

  /* ---------- SRS（SM-2 简化） ---------- */
  const DAY = 864e5;
  function grade(it, q) {                   /* q: 1 忘了 / 2 模糊 / 3 认识 */
    if (q === 1) { it.rep = 0; it.iv = 0; it.due = Date.now() + 6e5; }
    else {
      it.ef = Math.max(1.3, (it.ef || 2.5) + (q === 3 ? 0.1 : -0.15));
      it.rep = (it.rep || 0) + 1;
      it.iv = it.rep === 1 ? 1 : it.rep === 2 ? 6 : Math.round((it.iv || 6) * it.ef);
      if (q === 2) it.iv = Math.max(1, Math.round(it.iv * 0.6));
      it.due = Date.now() + it.iv * DAY;
    }
  }
  function dueList() { const now = Date.now(); return words.filter((x) => (x.due || 0) <= now); }
  let queue = [], cur = null, revealed = false;
  function revStats() {
    $('st-due').textContent = dueList().length;
    $('st-today').textContent = dk[today()] || 0;
    $('st-total').textContent = words.length;
    $('st-new').textContent = pack ? Math.max(0, pack.words.length - words.length) : '—';
    const nd = $('nav-due');
    if (nd) nd.textContent = dueList().length ? String(dueList().length) : '';
  }
  function buildQueue() { queue = shuffle(dueList()).slice(0, 60); nextCard(); }
  function nextCard() {
    cur = queue.find((x) => (x.due || 0) <= Date.now()) || null;
    revealed = false;
    renderCard();
  }
  function renderCard() {
    const el = $('rev-card');
    if (!el) return;
    revStats();
    if (!cur) {
      el.innerHTML = '<div class="ea-done mono">' +
        (words.length ? '今日复习完成 ✓ —— 去闯关或道场吧' : '生词本是空的 —— 点下方「导入新词」，或去闯关攒错词') + '</div>' +
        '<div class="bw-actions" style="justify-content:center; margin-top:14px;">' +
        '<button type="button" class="pie-btn primary" id="ea-import">＋ 导入 12 个新词</button></div>';
      const b = $('ea-import');
      if (b) b.addEventListener('click', importNew);
      return;
    }
    el.innerHTML =
      '<div class="ea-w">' + esc(cur.w) + '</div>' +
      (revealed
        ? '<div class="ea-r mono">' + esc(cur.r || '') + (cur.rom ? ' · ' + esc(cur.rom) : '') + '</div><div class="ea-def">' + esc(cur.def) + '</div>' +
          '<div class="bw-actions" style="justify-content:center;">' +
          '<button type="button" class="pie-btn" data-g="1">忘了 (1)</button>' +
          '<button type="button" class="pie-btn" data-g="2">模糊 (2)</button>' +
          '<button type="button" class="pie-btn primary" data-g="3">认识 (3)</button></div>'
        : '<div class="ea-hint mono">空格 显示答案 · P 发音</div>' +
          '<div class="bw-actions" style="justify-content:center;"><button type="button" class="pie-btn primary" id="ea-show">显示答案</button></div>');
    if ($('ea-show')) $('ea-show').addEventListener('click', () => { revealed = true; renderCard(); speak(cur.r || cur.w); });
    el.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => doGrade(parseInt(b.getAttribute('data-g'), 10))));
  }
  function doGrade(q) {
    if (!cur) return;
    grade(cur, q);
    dk[today()] = (dk[today()] || 0) + 1;
    store(K.daily, dk);
    store(K.words, words);
    nextCard();
  }
  function addWord(e) {                     /* e: [w,r,rom,def] */
    if (words.some((x) => x.w === e[0])) return false;
    words.push({ w: e[0], r: e[1], rom: e[2], def: e[3], due: Date.now(), iv: 0, ef: 2.5, rep: 0 });
    return true;
  }
  function importNew() {
    if (!pack) return;
    let n = 0;
    for (const e of pack.words) {
      if (n >= 12) break;
      if (addWord(e)) n++;
    }
    if (n) { store(K.words, words); buildQueue(); }
  }
  function revKeys(ev) {
    const panel = document.querySelector('.enx-panel[data-p="rev"]');
    if (!panel || panel.hidden || !cur) return;
    if (ev.key === ' ') { ev.preventDefault(); if (!revealed) { revealed = true; renderCard(); speak(cur.r || cur.w); } }
    if (revealed && (ev.key === '1' || ev.key === '2' || ev.key === '3')) doGrade(parseInt(ev.key, 10));
    if (ev.key === 'p' || ev.key === 'P') speak(cur.r || cur.w);
  }

  /* ---------- 道场 ---------- */
  const dojoSets = langId === 'ja'
    ? [
      { id: 'sei-h', name: '清音 · 平假名', items: KANA_SEION.map((e) => [e[0], e[1]]) },
      { id: 'sei-k', name: '清音 · 片假名', items: KANA_SEION.map((e) => [toKata(e[0]), e[1]]) },
      { id: 'dak-h', name: '浊音半浊 · 平', items: KANA_DAKUON.map((e) => [e[0], e[1]]) },
      { id: 'dak-k', name: '浊音半浊 · 片', items: KANA_DAKUON.map((e) => [toKata(e[0]), e[1]]) },
      { id: 'you-h', name: '拗音 · 平', items: KANA_YOUON.map((e) => [e[0], e[1]]) },
      { id: 'you-k', name: '拗音 · 片', items: KANA_YOUON.map((e) => [toKata(e[0]), e[1]]) },
    ]
    : [
      { id: 'cons', name: '基本辅音', items: KO_CONS.map((e) => [e[0], e[1], e[2]]) },
      { id: 'tense', name: '紧音', items: KO_TENSE.map((e) => [e[0], e[1], e[2]]) },
      { id: 'vow', name: '基本元音', items: KO_VOW.map((e) => [e[0], e[1], e[2]]) },
      { id: 'vow2', name: '复合元音', items: KO_VOW2.map((e) => [e[0], e[1], e[2]]) },
      { id: 'syl', name: '拼读（辅音×元音）', items: null },   /* 动态生成 CV 音节 */
    ];
  let dojoSet = dojoSets[0].id;
  function dojoItems(setId) {
    const s = dojoSets.find((x) => x.id === setId);
    if (!s) return [];
    if (s.items) return s.items;
    /* 韩语拼读：基本辅音 × 基本元音 的 CV 音节 */
    const out = [];
    for (let c = 0; c < KO_CONS.length; c++) {
      for (let v = 0; v < KO_VOW.length; v++) {
        const ci = KO_CHO.indexOf(KO_CONS[c][0]);
        const vi = KO_JUNG.indexOf(KO_VOW[v][0]);
        out.push([koCompose(ci, vi, 0), koRom(ci, vi, 0) || KO_JUNG_R[vi]]);
      }
    }
    return out;
  }
  function dojoSpeakText(setId, item) {
    if (langId === 'ja') return item[0];
    const s = dojoSets.find((x) => x.id === setId);
    if (s && (s.id === 'cons' || s.id === 'tense')) return item[2];   /* 辅音读字母名 */
    if (s && (s.id === 'vow' || s.id === 'vow2')) return item[2];     /* 元音读 아야어여 */
    return item[0];
  }
  function mastery(key) { const m = dojoStore[key] || [0, 0]; return m[0] >= 3 && m[0] > m[1] ? 2 : (m[0] + m[1] > 0 ? 1 : 0); }
  function renderDojo() {
    const bar = $('dj-sets');
    bar.innerHTML = dojoSets.map((s) =>
      '<button type="button" class="pie-btn mono' + (s.id === dojoSet ? ' primary' : '') + '" data-s="' + s.id + '">' + s.name + '</button>').join('');
    bar.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { dojoSet = b.getAttribute('data-s'); renderDojo(); }));
    const items = dojoItems(dojoSet);
    const mastered = items.filter((it) => mastery(dojoSet + ':' + it[0]) === 2).length;
    $('dj-prog').textContent = '掌握 ' + mastered + ' / ' + items.length;
    $('dj-grid').innerHTML = items.map((it) => {
      const m = mastery(dojoSet + ':' + it[0]);
      return '<button type="button" class="dj-it' + (m === 2 ? ' mast' : m === 1 ? ' seen' : '') + '" data-k="' + esc(it[0]) + '">' +
        '<b>' + esc(it[0]) + '</b><i class="mono">' + esc(it[1]) + '</i></button>';
    }).join('');
    $('dj-grid').querySelectorAll('.dj-it').forEach((b) => b.addEventListener('click', () => {
      const it = items.find((x) => x[0] === b.getAttribute('data-k'));
      if (it) speak(dojoSpeakText(dojoSet, it));
    }));
    $('dj-quiz-area').innerHTML = '';
    if ($('ea-composer')) renderComposer();
  }
  /* 韩语组字机 */
  let compC = 0, compV = 0, compT = 0;
  function renderComposer() {
    const el = $('ea-composer');
    if (!el) return;
    const ch = koCompose(compC, compV, compT);
    el.innerHTML =
      '<div class="dj-comp-out"><b id="comp-ch">' + ch + '</b><span class="mono">' + koRom(compC, compV, compT) + '</span>' +
      '<button type="button" class="pie-btn mono" id="comp-spk">🔊 读</button></div>' +
      '<div class="dj-comp-cols">' +
      '<div class="dj-comp-col"><em class="mono">초성 声母</em>' + KO_CHO.map((c, i) => '<button type="button" class="dj-mini' + (i === compC ? ' on' : '') + '" data-t="c" data-i="' + i + '">' + c + '</button>').join('') + '</div>' +
      '<div class="dj-comp-col"><em class="mono">중성 韵母</em>' + KO_JUNG.map((c, i) => '<button type="button" class="dj-mini' + (i === compV ? ' on' : '') + '" data-t="v" data-i="' + i + '">' + c + '</button>').join('') + '</div>' +
      '<div class="dj-comp-col"><em class="mono">종성 收音</em>' + KO_JONG.map((c, i) => '<button type="button" class="dj-mini' + (i === compT ? ' on' : '') + '" data-t="t" data-i="' + i + '">' + (c || '∅') + '</button>').join('') + '</div>' +
      '</div>';
    el.querySelectorAll('.dj-mini').forEach((b) => b.addEventListener('click', () => {
      const i = parseInt(b.getAttribute('data-i'), 10), t = b.getAttribute('data-t');
      if (t === 'c') compC = i; else if (t === 'v') compV = i; else compT = i;
      renderComposer();
      speak(koCompose(compC, compV, compT));
    }));
    $('comp-spk').addEventListener('click', () => speak(koCompose(compC, compV, compT)));
  }
  /* 道场测验：认读（字→音）/ 听辨（音→字），12 题一轮 */
  let DQ = null;
  function dojoQuiz(mode) {
    const items = dojoItems(dojoSet);
    if (items.length < 4) return;
    DQ = { mode, items, sample: shuffle(items).slice(0, 12), qi: 0, right: 0 };
    dojoAsk();
  }
  function dojoAsk() {
    if (!DQ) return;
    const area = $('dj-quiz-area');
    if (DQ.qi >= DQ.sample.length) {
      area.innerHTML = '<div class="gm-res"><div class="gm-stars">' + (DQ.right >= 10 ? '★★★' : DQ.right >= 8 ? '★★☆' : DQ.right >= 6 ? '★☆☆' : '☆☆☆') + '</div>' +
        '<div class="gm-acc mono">答对 ' + DQ.right + ' / ' + DQ.sample.length + '</div>' +
        '<div class="bw-actions" style="justify-content:center;">' +
        '<button type="button" class="pie-btn primary" id="dj-again">再来一轮</button>' +
        '<button type="button" class="pie-btn" id="dj-close">返回图表</button></div></div>';
      const m = DQ.mode;
      $('dj-again').addEventListener('click', () => dojoQuiz(m));
      $('dj-close').addEventListener('click', () => { DQ = null; renderDojo(); });
      return;
    }
    const cur = DQ.sample[DQ.qi];
    const dis = shuffle(DQ.items.filter((x) => x[0] !== cur[0] && x[1] !== cur[1])).slice(0, 3);
    const opts = shuffle([cur].concat(dis));
    const isRead = DQ.mode === 'read';
    area.innerHTML =
      '<div class="gm-hud mono"><span>' + (isRead ? '认读' : '听辨') + '</span><span>' + (DQ.qi + 1) + ' / ' + DQ.sample.length + '</span><span style="color:var(--good);">✓ ' + DQ.right + '</span></div>' +
      '<div class="qz-prompt">' +
      (isRead
        ? '<div class="dj-big">' + esc(cur[0]) + '</div><div class="mono" style="font-size:12px; color:var(--ink2);">选出读音</div>'
        : '<button type="button" class="en-spkbtn" id="dj-spk" style="font-size:24px; padding:12px 24px;">🔊</button><div class="mono" style="font-size:12px; color:var(--ink2); margin-top:8px;">听发音，选' + (langId === 'ja' ? '假名' : '谚文') + '</div>') +
      '</div><div class="qz-opts">' +
      opts.map((o) => '<button type="button" class="qz-opt' + (isRead ? ' mono' : ' dj-opt-big') + '" data-k="' + esc(o[0]) + '">' + esc(isRead ? o[1] : o[0]) + '</button>').join('') +
      '</div>';
    if (!isRead) {
      $('dj-spk').addEventListener('click', () => speak(dojoSpeakText(dojoSet, cur)));
      speak(dojoSpeakText(dojoSet, cur));
    }
    let answered = false;
    area.querySelectorAll('.qz-opt').forEach((b) => b.addEventListener('click', () => {
      if (answered || !DQ) return;
      answered = true;
      const okPick = b.getAttribute('data-k') === cur[0];
      b.classList.add(okPick ? 'ok' : 'bad');
      if (!okPick) area.querySelectorAll('.qz-opt').forEach((x) => { if (x.getAttribute('data-k') === cur[0]) x.classList.add('ok'); });
      const key = dojoSet + ':' + cur[0];
      const m = dojoStore[key] || [0, 0];
      m[okPick ? 0 : 1]++;
      dojoStore[key] = m;
      store(K.dojo, dojoStore);
      if (okPick) DQ.right++;
      if (isRead) speak(dojoSpeakText(dojoSet, cur));
      DQ.qi++;
      setTimeout(dojoAsk, okPick ? 450 : 1100);
    }));
  }

  /* ---------- 闯关 ---------- */
  let packObjs = null;
  function stageList() {
    if (!pack) return [];
    if (!packObjs) packObjs = pack.words.map((e) => ({ w: e[0], r: e[1], rom: e[2], def: e[3] }));
    return packObjs;
  }
  function renderGameMap() {
    const map = $('ea-map');
    G = null;
    $('ea-play').hidden = true;
    $('ea-result').hidden = true;
    map.hidden = false;
    const list = stageList();
    if (!list.length) { map.innerHTML = '<div class="mono" style="color:var(--ink2);">词汇包加载中…</div>'; return; }
    const nStage = Math.ceil(list.length / CHUNK);
    let cleared = 0;
    while (cleared < nStage && (gameStore.stars[cleared] || 0) > 0) cleared++;
    const unlocked = Math.min(nStage - 1, cleared + 2);
    $('ea-lvlname').textContent = L.packName + ' · ' + list.length + ' 词 · ' + nStage + ' 关';
    let stars = 0;
    for (let i = 0; i < nStage; i++) stars += gameStore.stars[i] || 0;
    $('ea-stars').textContent = '★ ' + stars + ' / ' + nStage * 3;
    map.innerHTML = Array.from({ length: nStage }, (_, i) => {
      const locked = i > unlocked;
      const st = gameStore.stars[i] || 0;
      return '<button type="button" class="gm-tile' + (locked ? ' lock' : '') + (st ? ' done' : '') + (i === cleared ? ' next' : '') + '" data-i="' + i + '"' + (locked ? ' disabled' : '') +
        ' title="第 ' + (i + 1) + ' 关 · 词 ' + (i * CHUNK + 1) + '–' + Math.min(list.length, (i + 1) * CHUNK) + '">' +
        '<b>' + (i + 1) + '</b>' +
        '<i>' + '★'.repeat(st) + '☆'.repeat(Math.max(0, 3 - st)) + '</i>' +
        '<em class="mono">' + (locked ? '🔒' : STAGE_TYPES[i % 3]) + '</em></button>';
    }).join('') +
      '<div class="mono" style="grid-column:1/-1; font-size:11px; color:var(--ink2); padding-top:4px;">正确率 ≥60% 得星过关，错词自动进「复习」。词按使用频度切关。</div>';
    map.querySelectorAll('.gm-tile:not(.lock)').forEach((b) => b.addEventListener('click', () => startStage(parseInt(b.getAttribute('data-i'), 10))));
  }
  function startStage(i) {
    const list = stageList();
    const pool = list.slice(i * CHUNK, (i + 1) * CHUNK);
    if (pool.length < 8) { renderGameMap(); return; }
    const type = i % 3;
    const nQ = type === 2 ? 10 : 12;
    G = { stage: i, type, pool, sample: shuffle(pool).slice(0, Math.min(nQ, pool.length)), qi: 0, right: 0, miss: 0, wrongSet: {} };
    $('ea-map').hidden = true;
    $('ea-result').hidden = true;
    $('ea-play').hidden = false;
    $('ea-gp-title').textContent = '第 ' + (i + 1) + ' 关 · ' + STAGE_TYPES[type];
    if (type === 0) matchRound(0); else quizAsk();
  }
  function hud() {
    if (!G) return;
    const done = G.type === 0 ? (G.matchDone || 0) : G.qi;
    $('ea-gp-progress').textContent = done + ' / ' + G.sample.length;
    $('ea-gp-score').textContent = '✓ ' + G.right;
  }
  function gWrong(e) { if (!G.wrongSet[e.w]) G.wrongSet[e.w] = e; }
  function matchRound(start) {
    if (!G) return;
    const seg = G.sample.slice(start, start + 6);
    if (!seg.length) { finishStage(); return; }
    hud();
    let selL = null;
    const Lh = shuffle(seg), Rh = shuffle(seg);
    $('ea-gp-stage').innerHTML =
      '<div class="mg-wrap"><div class="mg-col" id="ea-mg-l">' +
      Lh.map((e) => '<button type="button" class="mg-it" data-w="' + esc(e.w) + '">' + esc(e.w) + '</button>').join('') +
      '</div><div class="mg-col" id="ea-mg-r">' +
      Rh.map((e) => '<button type="button" class="mg-it" data-w="' + esc(e.w) + '">' + esc(e.def.slice(0, 26)) + '</button>').join('') +
      '</div></div>';
    const remain = new Set(seg.map((e) => e.w));
    $('ea-gp-stage').querySelectorAll('#ea-mg-l .mg-it').forEach((b) => b.addEventListener('click', () => {
      if (b.classList.contains('ok')) return;
      $('ea-gp-stage').querySelectorAll('#ea-mg-l .mg-it').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel'); selL = b;
      const e = seg.find((x) => x.w === b.getAttribute('data-w'));
      if (e) speak(e.r || e.w);
    }));
    $('ea-gp-stage').querySelectorAll('#ea-mg-r .mg-it').forEach((b) => b.addEventListener('click', () => {
      if (!selL || b.classList.contains('ok')) return;
      const lw = selL.getAttribute('data-w'), rw = b.getAttribute('data-w');
      if (lw === rw) {
        selL.classList.remove('sel'); selL.classList.add('ok'); b.classList.add('ok');
        G.right++; G.matchDone = (G.matchDone || 0) + 1;
        remain.delete(lw); selL = null;
        hud();
        if (!remain.size) setTimeout(() => matchRound(start + 6), 500);
      } else {
        const e = seg.find((x) => x.w === lw);
        if (e) gWrong(e);
        G.miss++;
        selL.classList.add('bad'); b.classList.add('bad');
        const l0 = selL; selL = null;
        setTimeout(() => { l0.classList.remove('bad', 'sel'); b.classList.remove('bad'); }, 450);
        hud();
      }
    }));
  }
  function quizAsk() {
    if (!G) return;
    if (G.qi >= G.sample.length) { finishStage(); return; }
    hud();
    const cur = G.sample[G.qi];
    const opts = shuffle([cur].concat(shuffle(G.pool.filter((e) => e.w !== cur.w)).slice(0, 3)));
    const isListen = G.type === 2;
    $('ea-gp-stage').innerHTML =
      '<div class="qz-prompt">' +
      (isListen
        ? '<button type="button" class="en-spkbtn" id="ea-qz-spk" style="font-size:26px; padding:14px 26px;">🔊</button><div class="mono" style="font-size:12px; color:var(--ink2); margin-top:8px;">听发音，选单词</div>'
        : '<div class="qz-def">' + esc(cur.def) + '</div><div class="mono" style="font-size:12px; color:var(--ink2); margin-top:8px;">选出对应的' + L.name + '词</div>') +
      '</div><div class="qz-opts">' +
      opts.map((o) => '<button type="button" class="qz-opt" data-w="' + esc(o.w) + '">' + esc(o.w) + '</button>').join('') +
      '</div><div class="ea-reveal mono" id="ea-reveal" hidden></div>';
    if (isListen) {
      $('ea-qz-spk').addEventListener('click', () => speak(cur.r || cur.w));
      speak(cur.r || cur.w);
    }
    let answered = false;
    $('ea-gp-stage').querySelectorAll('.qz-opt').forEach((b) => b.addEventListener('click', () => {
      if (answered || !G) return;
      answered = true;
      const okPick = b.getAttribute('data-w') === cur.w;
      b.classList.add(okPick ? 'ok' : 'bad');
      if (!okPick) {
        $('ea-gp-stage').querySelectorAll('.qz-opt').forEach((x) => { if (x.getAttribute('data-w') === cur.w) x.classList.add('ok'); });
        gWrong(cur);
      } else G.right++;
      const rv = $('ea-reveal');
      rv.hidden = false;
      rv.textContent = cur.w + (cur.r && cur.r !== cur.w ? ' · ' + cur.r : '') + (cur.rom ? ' · ' + cur.rom : '') + ' —— ' + cur.def;
      if (!isListen) speak(cur.r || cur.w);
      G.qi++;
      setTimeout(quizAsk, okPick ? 700 : 1400);
    }));
  }
  function finishStage() {
    if (!G) return;
    const total = G.sample.length;
    const acc = G.type === 0
      ? (G.right + G.miss > 0 ? G.right / (G.right + G.miss) : 0)
      : (total ? G.right / total : 0);
    const stars = acc >= 0.92 ? 3 : acc >= 0.75 ? 2 : acc >= 0.6 ? 1 : 0;
    if (stars > (gameStore.stars[G.stage] || 0)) gameStore.stars[G.stage] = stars;
    store(K.game, gameStore);
    const wrongs = Object.values(G.wrongSet);
    let added = 0;
    wrongs.forEach((e) => { if (addWord([e.w, e.r, e.rom, e.def])) added++; });
    if (added) { store(K.words, words); revStats(); }
    const stage = G.stage;
    G = null;
    $('ea-play').hidden = true;
    const res = $('ea-result');
    res.hidden = false;
    res.innerHTML = '<div class="gm-res">' +
      '<div class="gm-stars">' + (stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '未通关') + '</div>' +
      '<div class="gm-acc mono">正确率 ' + Math.round(acc * 100) + '%</div>' +
      (wrongs.length
        ? '<div class="gm-wrong mono">错词 ' + wrongs.length + ' 个' + (added ? '（已进复习队列）' : '') + '：' + wrongs.slice(0, 6).map((e) => esc(e.w)).join(' · ') + (wrongs.length > 6 ? ' …' : '') + '</div>'
        : '<div class="gm-wrong mono" style="color:var(--good);">全对，零错词！</div>') +
      '<div class="bw-actions" style="justify-content:center;">' +
      '<button type="button" class="pie-btn" id="ea-retry">再来一次</button>' +
      (stars ? '<button type="button" class="pie-btn primary" id="ea-next">下一关 →</button>' : '') +
      '<button type="button" class="pie-btn" id="ea-back">返回地图</button></div></div>';
    $('ea-retry').addEventListener('click', () => startStage(stage));
    if ($('ea-next')) $('ea-next').addEventListener('click', () => startStage(stage + 1));
    $('ea-back').addEventListener('click', renderGameMap);
  }

  /* ---------- 设置 ---------- */
  function setupSettings() {
    const sel = $('ea-voice');
    if (sel) sel.addEventListener('change', () => { cfg.voice = sel.value; store(K.cfg, cfg); });
    const rate = $('ea-rate');
    if (rate) {
      rate.value = String(cfg.rate || 0.9);
      rate.addEventListener('input', () => { cfg.rate = parseFloat(rate.value); store(K.cfg, cfg); $('ea-rate-v').textContent = rate.value; });
      $('ea-rate-v').textContent = rate.value;
    }
    if ($('ea-test')) $('ea-test').addEventListener('click', () => speak(langId === 'ja' ? 'こんにちは' : '안녕하세요'));
    if ($('ea-wipe')) $('ea-wipe').addEventListener('click', () => {
      if (!confirm('清空 ' + L.name + ' 的全部学习数据（生词、道场、闯关进度）？')) return;
      [K.words, K.dojo, K.game, K.daily].forEach((k) => localStorage.removeItem(k));
      words = []; dojoStore = {}; gameStore = { stars: {} }; dk = {};
      buildQueue(); renderDojo(); renderGameMap(); revStats();
    });
  }

  /* ---------- 标签页 & 启动 ---------- */
  function setupTabs() {
    const tabs = document.querySelectorAll('.enx-side button');
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('on'));
      tab.classList.add('on');
      const p = tab.getAttribute('data-p');
      document.querySelectorAll('.enx-panel').forEach((pan) => { pan.hidden = pan.getAttribute('data-p') !== p; });
      if (p === 'rev') buildQueue();
      if (p === 'dojo') renderDojo();
      if (p === 'game') renderGameMap();
      if (window.speechSynthesis) speechSynthesis.cancel();
    }));
  }
  async function init() {
    setupTabs();
    setupSettings();
    loadVoices();
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
    document.addEventListener('keydown', revKeys);
    $('dj-quiz-read').addEventListener('click', () => dojoQuiz('read'));
    $('dj-quiz-listen').addEventListener('click', () => dojoQuiz('listen'));
    if ($('ea-gp-quit')) $('ea-gp-quit').addEventListener('click', renderGameMap);
    renderDojo();
    revStats();
    try {
      pack = await (await fetch(L.pack)).json();
    } catch (e) { pack = null; }
    revStats();
  }
  init();
}
