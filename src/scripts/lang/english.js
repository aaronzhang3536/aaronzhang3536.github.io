/* 英语学习中心：SRS 生词本（SM-2）+ 听写拼写 + TTS 发音 + AI 讲解/对话（BYOK）
   所有数据存 localStorage；AI 为可选功能，Key 只存本地、直连 OpenAI 兼容接口 */

const K = { words: 'yzzn-en-words', cfg: 'yzzn-en-cfg', stats: 'yzzn-en-stats', cache: 'yzzn-en-ai', dict: 'yzzn-en-dict', daily: 'yzzn-en-daily', game: 'yzzn-en-game' };

/* ---------- 内置词包 ---------- */
const PACKS = [
  { id: 'daily', name: '日常核心 50', words: [
    ['appreciate', '感激；欣赏'], ['available', '可用的；有空的'], ['schedule', '日程；安排'],
    ['convenient', '方便的'], ['recommend', '推荐'], ['confirm', '确认'], ['apologize', '道歉'],
    ['negotiate', '谈判；协商'], ['estimate', '估计'], ['efficient', '高效的'], ['flexible', '灵活的'],
    ['familiar', '熟悉的'], ['opportunity', '机会'], ['responsibility', '责任'], ['experience', '经验；经历'],
    ['suggestion', '建议'], ['decision', '决定'], ['attitude', '态度'], ['patient', '耐心的；病人'],
    ['confident', '自信的'], ['nervous', '紧张的'], ['exhausted', '筋疲力尽的'], ['delicious', '美味的'],
    ['expensive', '昂贵的'], ['reasonable', '合理的'], ['necessary', '必要的'], ['immediately', '立刻'],
    ['occasionally', '偶尔'], ['frequently', '频繁地'], ['eventually', '最终'], ['actually', '实际上'],
    ['probably', '大概'], ['definitely', '肯定地'], ['exactly', '确切地'], ['especially', '尤其'],
    ['purchase', '购买'], ['receive', '收到'], ['deliver', '递送；交付'], ['cancel', '取消'],
    ['postpone', '推迟'], ['attend', '参加'], ['invite', '邀请'], ['celebrate', '庆祝'],
    ['complain', '抱怨'], ['describe', '描述'], ['explain', '解释'], ['improve', '改进'],
    ['achieve', '达成'], ['borrow', '借入'], ['lend', '借出'],
  ] },
  { id: 'tech', name: '技术工程 50', words: [
    ['iterate', '迭代'], ['render', '渲染'], ['latency', '延迟'], ['throughput', '吞吐量'],
    ['bottleneck', '瓶颈'], ['concurrency', '并发'], ['asynchronous', '异步的'], ['synchronous', '同步的'],
    ['allocate', '分配（内存/资源）'], ['deprecate', '弃用'], ['refactor', '重构'], ['debug', '调试'],
    ['compile', '编译'], ['execute', '执行'], ['implement', '实现'], ['interface', '接口'],
    ['inherit', '继承'], ['instantiate', '实例化'], ['traverse', '遍历'], ['recursion', '递归'],
    ['cache', '缓存'], ['buffer', '缓冲区'], ['queue', '队列'], ['scheduler', '调度器'],
    ['pipeline', '管线；流水线'], ['shader', '着色器'], ['vertex', '顶点'], ['fragment', '片元；片段'],
    ['texture', '纹理'], ['mesh', '网格'], ['occlusion', '遮挡'], ['culling', '剔除'],
    ['sampling', '采样'], ['interpolate', '插值'], ['extrapolate', '外推'], ['quaternion', '四元数'],
    ['matrix', '矩阵'], ['probability', '概率'], ['distribution', '分布'], ['variance', '方差'],
    ['gradient', '梯度'], ['convergence', '收敛'], ['optimization', '优化'], ['benchmark', '基准测试'],
    ['profiling', '性能分析'], ['bandwidth', '带宽'], ['redundancy', '冗余'], ['robust', '健壮的'],
    ['deterministic', '确定性的'], ['heuristic', '启发式的'],
  ] },
];

function $(id) { return document.getElementById(id); }
function load(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') || fb; } catch (e) { return fb; } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let words = load(K.words, []);
let cfg = load(K.cfg, { base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat', voice: '', rate: 0.95, aud: 'auto', acc: 'us', level: '', daily: 0 });
let stats = load(K.stats, {});
let aiCache = load(K.cache, {});

function saveWords() { store(K.words, words); }
function today() { return new Date().toISOString().slice(0, 10); }
function bumpStat() { stats[today()] = (stats[today()] || 0) + 1; store(K.stats, stats); }
function streak() {
  let n = 0; const d = new Date();
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    if (stats[k] > 0) { n++; d.setDate(d.getDate() - 1); } else break;
  }
  return n;
}

/* ---------- TTS 发音 ---------- */
let voices = [];
function loadVoices() {
  if (!window.speechSynthesis) return;
  voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  const sel = $('en-voice');
  if (sel && voices.length) {
    sel.innerHTML = voices.map((v) =>
      `<option value="${esc(v.name)}"${v.name === cfg.voice ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  }
}
function bestVoice() {
  if (!voices.length) return null;
  return voices.find((v) => v.name === cfg.voice) ||
    voices.find((v) => /Google US English/i.test(v.name)) ||
    voices.find((v) => /en[-_]US/i.test(v.lang) && /natural/i.test(v.name)) ||
    voices.find((v) => /en[-_]US/i.test(v.lang)) ||
    voices[0];
}
function speak(text) {
  if (!window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = cfg.rate || 0.95;
    const v = bestVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
/* 发音统一入口：真人音频优先（词典源 mp3，本地缓存），拿不到/超时才回退 TTS */
async function pronounce(word) {
  const w = String(word || '').trim();
  if (!w) return null;
  if (cfg.aud === 'tts' || /\s/.test(w)) { speak(w); return null; }
  let d = dictCache[w.toLowerCase()] || null;
  if (!d) {
    try { d = await Promise.race([dictLookup(w), new Promise((r) => setTimeout(() => r(null), 2500))]); }
    catch (e) { d = null; }
  }
  const list = (d && d.audios) || [];
  const pick = (cfg.acc === 'uk')
    ? (list.find((a) => a.tag === '英') || list.find((a) => a.tag === '美') || list[0])
    : (list.find((a) => a.tag === '美') || list.find((a) => a.tag === '英') || list[0]);
  if (pick) playUrl(pick.url, w);
  else speak(w);
  return d;
}

/* ---------- SRS（SM-2 简化版）：忘了0 / 模糊3 / 认识5 ---------- */
function sm2(it, q) {
  const s = it.srs || { ef: 2.5, n: 0, i: 0, d: 0 };
  if (q < 3) { s.n = 0; s.i = 0; s.d = Date.now() + 10 * 60 * 1000; }
  else {
    s.ef = Math.max(1.3, s.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    s.n++;
    s.i = s.n === 1 ? 1 : s.n === 2 ? 6 : Math.round(s.i * s.ef);
    s.d = Date.now() + s.i * 86400000;
  }
  it.srs = s;
}
function dueWords() { const now = Date.now(); return words.filter((w) => !w.srs || w.srs.d <= now); }

/* ---------- ① 今日复习 ---------- */
let queue = [], cur = null, revDone = 0;
function buildQueue() {
  queue = dueWords().slice();
  revDone = 0;
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
}
function revStats() {
  const due = dueWords().length;
  if ($('st-due')) {
    $('st-due').textContent = due;
    $('st-today').textContent = stats[today()] || 0;
    $('st-streak').textContent = streak();
    $('st-total').textContent = words.length;
  }
  const badge = $('nav-due');
  if (badge) badge.textContent = due > 0 ? due : '';
  const total = revDone + queue.length + (cur ? 1 : 0);
  const bar = $('rev-prog');
  if (bar) bar.style.width = total > 0 ? Math.round((revDone / total) * 100) + '%' : '0%';
}
function nextCard() {
  cur = queue.shift() || null;
  const box = $('rev-card');
  revStats();
  if (!cur) {
    box.innerHTML = words.length
      ? '<div class="en-done">🎉 今日复习完成<span class="mono">明天再来，或去「听写拼写」巩固</span></div>'
      : '<div class="en-done">生词本是空的<span class="mono">去「生词本」导入词包或手动添加</span></div>';
    return;
  }
  const w = cur.w;
  const cached = dictCache[w.toLowerCase()];
  box.innerHTML =
    '<div class="en-word">' + esc(w) + '</div>' +
    '<div class="en-ph" id="rev-ph">' + esc((cached && cached.ph) || '') + '</div>' +
    '<div class="en-def" id="rev-def" hidden>' + esc(cur.def) + '</div>' +
    '<div class="en-actions" id="rev-actions">' +
    '<button type="button" class="en-spkbtn" id="rev-spk" title="发音 (P)">🔊</button>' +
    '<button type="button" class="en-reveal" id="rev-show">显示释义</button></div>';
  $('rev-spk').addEventListener('click', () => pronounce(w));
  pronounce(w).then((d) => {
    if (d && d.ph && cur && cur.w === w && $('rev-ph')) $('rev-ph').textContent = d.ph;
  });
  $('rev-show').addEventListener('click', revReveal);
}
function revReveal() {
  if (!cur || !$('rev-show')) return;
  $('rev-def').hidden = false;
  $('rev-actions').innerHTML =
    '<button type="button" class="en-grade g0" data-q="0"><b>忘了</b><kbd>1</kbd></button>' +
    '<button type="button" class="en-grade g3" data-q="3"><b>模糊</b><kbd>2</kbd></button>' +
    '<button type="button" class="en-grade g5" data-q="5"><b>认识</b><kbd>3</kbd></button>';
  $('rev-actions').querySelectorAll('.en-grade').forEach((b) => b.addEventListener('click', () => revGrade(parseInt(b.getAttribute('data-q'), 10))));
}
function revGrade(q) {
  if (!cur) return;
  sm2(cur, q); bumpStat(); saveWords();
  revDone++;
  if (q < 3) queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, cur);
  nextCard();
}
/* 键盘：空格=显示释义，1/2/3=评分，P=发音（仅复习面板可见且不在输入框时） */
function revKeys(e) {
  const panel = document.querySelector('.enx-panel[data-p="rev"]');
  if (!panel || panel.hidden) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.key === ' ' || e.key === 'Enter') {
    if ($('rev-show')) { e.preventDefault(); revReveal(); }
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    if (!$('rev-show') && $('rev-actions') && cur) revGrade(e.key === '1' ? 0 : e.key === '2' ? 3 : 5);
  } else if (e.key === 'p' || e.key === 'P') {
    if (cur) pronounce(cur.w);
  }
}

/* ---------- ② 生词本 ---------- */
function fmtDue(w) {
  if (!w.srs) return '<i class="en-new">新</i>';
  const dd = w.srs.d - Date.now();
  if (dd <= 0) return '<i class="en-due">到期</i>';
  return '<i>' + Math.ceil(dd / 86400000) + '天后</i>';
}
function renderBook() {
  const q = ($('book-q').value || '').trim().toLowerCase();
  const list = words.filter((w) => !q || w.w.toLowerCase().includes(q) || w.def.includes(q));
  $('book-count').textContent = '共 ' + words.length + ' 词' + (q ? '，匹配 ' + list.length : '');
  $('book-list').innerHTML = list.map((w, i) =>
    '<div class="en-row"><b>' + esc(w.w) + (w.lv ? ' <u class="en-lvchip mono">' + esc(levelName(w.lv)) + '</u>' : '') + '</b><span>' + esc(w.def) + '</span>' + fmtDue(w) +
    '<button type="button" class="pie-btn en-spk" data-s="' + esc(w.w) + '">🔊</button>' +
    '<button type="button" class="pie-btn en-del" data-w="' + esc(w.w) + '">✕</button></div>').join('') ||
    '<div class="mono" style="color:var(--ink2); font-size:12.5px; padding:10px 0;">还没有词——导入下面的词包，或在上方手动添加。</div>';
  $('book-list').querySelectorAll('.en-spk').forEach((b) => b.addEventListener('click', () => pronounce(b.getAttribute('data-s'))));
  $('book-list').querySelectorAll('.en-del').forEach((b) => b.addEventListener('click', () => {
    const w = b.getAttribute('data-w');
    words = words.filter((x) => x.w !== w);
    saveWords(); renderBook(); revStats();
  }));
}
function addWord(w, def) {
  w = w.trim(); def = def.trim();
  if (!w || !def) return false;
  if (words.some((x) => x.w.toLowerCase() === w.toLowerCase())) return false;
  words.push({ w, def, t: Date.now() });
  return true;
}

/* ---------- 添加生词：查词预览卡（义项点选 + 可编辑 + AI 中文释义） ---------- */
let bwWord = '';
const POS_SHORT = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', pronoun: 'pron.', preposition: 'prep.', conjunction: 'conj.', interjection: 'int.', numeral: 'num.' };
async function bwLookup() {
  const w = ($('book-w').value || '').trim();
  if (!w) { $('book-msg').textContent = '先输入单词'; return; }
  bwWord = w;
  const card = $('bw-card');
  card.hidden = false;
  $('book-msg').textContent = '';
  $('bw-head').innerHTML = '<b>' + esc(w) + '</b><span class="mono" style="color:var(--ink2);">查询中…</span>';
  $('bw-senses').innerHTML = '';
  $('bw-def').value = '';
  const d = await dictLookup(w);
  if (bwWord !== w) return;   /* 用户已换词 */
  $('bw-head').innerHTML =
    '<b>' + esc((d && d.w) || w) + '</b>' +
    (d && d.ph ? '<span class="mono">' + esc(d.ph) + '</span>' : '') +
    ((d && d.audios && d.audios.length)
      ? d.audios.map((a) => '<button type="button" class="pie-btn en-audio" data-u="' + esc(a.url) + '">🔊 ' + a.tag + '</button>').join('')
      : '<button type="button" class="pie-btn en-audio" data-tts="1">🔊</button>');
  $('bw-head').querySelectorAll('.en-audio').forEach((b) => b.addEventListener('click', () => {
    b.getAttribute('data-tts') ? pronounce(w) : playUrl(b.getAttribute('data-u'), w);
  }));
  if (!d || !d.meanings.length) {
    $('bw-senses').innerHTML = '<div class="mono" style="font-size:12px; color:var(--ink2);">词典没查到义项 —— 直接在下面手写释义，或点「AI 中文释义」。</div>';
    return;
  }
  $('bw-senses').innerHTML = d.meanings.map((m) => {
    const ps = POS_SHORT[m.pos] || m.pos;
    return '<div class="bw-pos mono">' + esc(m.pos) + '</div>' +
      m.defs.map((df) =>
        '<button type="button" class="bw-sense" data-t="' + esc(ps + ' ' + df.def) + '">' + esc(df.def) +
        (df.ex ? '<em>' + esc(df.ex) + '</em>' : '') + '</button>').join('');
  }).join('');
  $('bw-senses').querySelectorAll('.bw-sense').forEach((b) => b.addEventListener('click', () => {
    const t = b.getAttribute('data-t');
    const ta = $('bw-def');
    ta.value = ta.value.trim() ? ta.value.trim().replace(/；$/, '') + '；' + t : t;
    b.classList.add('used');
  }));
  if (d.audios && d.audios.length) {
    const pick = (cfg.acc === 'uk')
      ? (d.audios.find((a) => a.tag === '英') || d.audios[0])
      : (d.audios.find((a) => a.tag === '美') || d.audios[0]);
    playUrl(pick.url, w);
  }
}
async function bwAIDef() {
  if (!bwWord) return;
  const key = 'zhdef:' + bwWord.toLowerCase() + '@' + cfg.model;
  if (aiCache[key]) { $('bw-def').value = aiCache[key]; return; }
  $('book-msg').textContent = 'AI 生成中…';
  try {
    const t = await ai([
      { role: 'system', content: '你是英汉词典编辑。只输出释义本身，不要任何多余文字。' },
      { role: 'user', content: '给出英文单词 "' + bwWord + '" 的简明中文词典释义，格式如「adj. 有弹性的；能恢复的」，多义项用；分隔，总长不超过 40 字。' },
    ], 120);
    if (t) {
      aiCache[key] = t; store(K.cache, aiCache);
      $('bw-def').value = t;
      $('book-msg').textContent = '';
    }
  } catch (e) { $('book-msg').textContent = aiErrText(e); }
}
function bwAdd() {
  if (!bwWord) return;
  if (addWord(bwWord, $('bw-def').value)) {
    saveWords(); renderBook(); revStats();
    $('book-msg').textContent = '✓ 已添加 ' + bwWord;
    $('bw-card').hidden = true;
    $('book-w').value = ''; bwWord = '';
    $('book-w').focus();
  } else {
    $('book-msg').textContent = $('bw-def').value.trim() ? bwWord + ' 已在生词本里' : '释义不能为空';
  }
}

/* ---------- ③ 听写拼写 ---------- */
let dictCur = null, dictStreak = 0;
async function dictPool() {
  const scope = $('dict-scope').value;
  if (scope === 'level') {
    if (!cfg.level) return [];
    const p = await loadLevel(cfg.level);
    return p ? p.words.map((e) => ({ w: e[0], def: e[2] })) : [];
  }
  return scope === 'due' ? dueWords() : words;
}
async function dictNext() {
  const pool = await dictPool();
  if (!pool.length) { $('dict-msg').textContent = $('dict-scope').value === 'level' ? '先在「设置」选择考试等级。' : '没有可听写的词——先去导入词包。'; dictCur = null; return; }
  let w = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && dictCur && w.w === dictCur.w) w = pool[(pool.indexOf(w) + 1) % pool.length];
  dictCur = w;
  $('dict-input').value = '';
  $('dict-msg').innerHTML = '听音拼写，回车提交　<span class="mono" style="color:var(--ink2);">连对 ' + dictStreak + '</span>';
  $('dict-input').focus();
  pronounce(w.w);
}
function dictCheck() {
  if (!dictCur) return;
  const val = $('dict-input').value.trim().toLowerCase();
  if (!val) { pronounce(dictCur.w); return; }
  if (val === dictCur.w.toLowerCase()) {
    dictStreak++; bumpStat();
    $('dict-msg').innerHTML = '<span style="color:var(--good);">✓ 正确</span>　' + esc(dictCur.w) + ' — ' + esc(dictCur.def) +
      '　<span class="mono" style="color:var(--ink2);">连对 ' + dictStreak + '</span>';
    setTimeout(dictNext, 1100);
  } else {
    dictStreak = 0;
    $('dict-msg').innerHTML = '<span style="color:var(--c-render);">✗ 不对</span>　正确拼写：<b>' + esc(dictCur.w) + '</b> — ' + esc(dictCur.def);
    pronounce(dictCur.w);
  }
}

/* ---------- AI（OpenAI 兼容，BYOK） ---------- */
async function ai(messages, maxTokens) {
  if (!cfg.key) throw new Error('NOKEY');
  const r = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7, max_tokens: maxTokens || 900 }),
  });
  if (!r.ok) {
    const tx = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + '：' + tx.slice(0, 140));
  }
  const j = await r.json();
  return ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
}
function aiErrText(e) {
  if (e && e.message === 'NOKEY') return '尚未配置 API Key —— 去「⑥ 设置」填入（推荐 DeepSeek，或智谱 GLM-4-Flash 免费档）。Key 只存在你自己的浏览器里。';
  if (e && /Failed to fetch|NetworkError|TypeError/.test(String(e))) return '请求失败：网络不可达，或该服务不允许浏览器直连（CORS）。可在设置里换一个服务商。';
  return '出错了：' + (e && e.message || e);
}

/* ---------- 免费词典查询（dictionaryapi.dev 主源 → freedictionaryapi.com 备源）---------- */
let dictCache = load(K.dict, {});
let curAudio = null;
function playUrl(url, fbWord) {
  try {
    if (curAudio) curAudio.pause();
    curAudio = new Audio(url);
    if (fbWord) curAudio.onerror = () => speak(fbWord);
    const p = curAudio.play();
    if (p && p.catch) p.catch(() => { if (fbWord) speak(fbWord); });
  } catch (e) { if (fbWord) speak(fbWord); }
}
async function dictLookup(word) {
  const w = word.toLowerCase();
  if (dictCache[w]) return dictCache[w];
  let norm = null;
  try {   /* 主源：dictionaryapi.dev */
    const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w));
    if (r.ok) {
      const j = await r.json();
      const e0 = Array.isArray(j) && j[0];
      if (e0) {
        norm = {
          w: e0.word,
          ph: e0.phonetic || ((e0.phonetics || []).map((p) => p.text).filter(Boolean)[0] || ''),
          audios: (e0.phonetics || []).filter((p) => p.audio).map((p) => ({
            url: p.audio, tag: /-us\./.test(p.audio) ? '美' : /-uk\./.test(p.audio) ? '英' : /-au\./.test(p.audio) ? '澳' : '▶',
          })).slice(0, 3),
          meanings: (e0.meanings || []).slice(0, 4).map((m) => ({
            pos: m.partOfSpeech,
            defs: (m.definitions || []).slice(0, 3).map((d) => ({ def: d.definition, ex: d.example || '' })),
            syns: (m.synonyms || []).slice(0, 6),
          })),
          src: 'dictionaryapi.dev',
        };
      }
    }
  } catch (e) {}
  if (!norm) {
    try {   /* 备源：freedictionaryapi.com（Wiktionary 数据） */
      const r2 = await fetch('https://freedictionaryapi.com/api/v1/entries/en/' + encodeURIComponent(w));
      if (r2.ok) {
        const j2 = await r2.json();
        if (j2 && j2.entries && j2.entries.length) {
          norm = {
            w: j2.word,
            ph: (((j2.entries[0] || {}).pronunciations || []).find((p) => p.type === 'ipa') || {}).text || '',
            audios: [],
            meanings: j2.entries.slice(0, 4).map((en) => ({
              pos: en.partOfSpeech,
              defs: (en.senses || []).slice(0, 3).map((s) => ({ def: s.definition, ex: (s.examples || [])[0] || '' })),
              syns: ((en.synonyms || [])).slice(0, 6),
            })),
            src: 'freedictionaryapi.com',
          };
        }
      }
    } catch (e) {}
  }
  if (norm) {
    dictCache[w] = norm;
    const keys = Object.keys(dictCache);
    if (keys.length > 80) delete dictCache[keys[0]];
    store(K.dict, dictCache);
  }
  return norm;
}
async function lookupWord() {
  const w = ($('ai-word').value || '').trim();
  if (!w) return;
  const out = $('lookup-out');
  out.hidden = false;
  out.innerHTML = '<span class="mono" style="color:var(--ink2);">查询中…</span>';
  const d = await dictLookup(w);
  if (!d) {
    out.innerHTML = '<span class="mono" style="color:var(--ink2);">没查到 "' + esc(w) + '" —— 检查拼写，或该词太生僻（词典源不可达时也会失败）。</span>';
    return;
  }
  out.innerHTML =
    '<div class="en-lk-head"><b>' + esc(d.w) + '</b>' +
    (d.ph ? '<span class="mono">' + esc(d.ph) + '</span>' : '') +
    d.audios.map((a) => '<button type="button" class="pie-btn en-audio" data-u="' + esc(a.url) + '">🔊 ' + a.tag + '</button>').join('') +
    '</div>' +
    d.meanings.map((m) =>
      '<div class="en-lk-m"><i class="mono">' + esc(m.pos) + '</i>' +
      '<ol>' + m.defs.map((df) =>
        '<li>' + esc(df.def) + (df.ex ? '<em>' + esc(df.ex) + '</em>' : '') + '</li>').join('') + '</ol>' +
      (m.syns.length ? '<div class="en-lk-syn mono">近义：' + m.syns.map(esc).join(' · ') + '</div>' : '') +
      '</div>').join('') +
    '<div class="mono en-lk-src">数据：' + d.src + '（免费公开源）· 音频为真人发音</div>';
  out.querySelectorAll('.en-audio').forEach((b) => b.addEventListener('click', () => playUrl(b.getAttribute('data-u'))));
  if (d.audios.length) playUrl(d.audios[d.audios.length - 1].url);
}

/* ④ AI 讲解 */
async function explainWord() {
  const w = ($('ai-word').value || '').trim();
  if (!w) return;
  const key = w.toLowerCase() + '@' + cfg.model;
  const out = $('ai-out');
  if (aiCache[key]) { out.textContent = aiCache[key]; return; }
  out.textContent = '生成中…';
  try {
    const text = await ai([
      { role: 'system', content: '你是资深英语老师，面向中文母语学习者。用纯文本回复，不要用 Markdown 记号。' },
      { role: 'user', content: '讲解英文单词 "' + w + '"：\n1. 美式音标\n2. 核心词义（按词性，中文）\n3. 词源与词根词缀拆解（来自哪个语言/词根，如何演变成现在的意思，简短）\n4. 三个地道例句（英文+中文，由易到难）\n5. 高频搭配 2-3 个\n6. 一句话记忆技巧\n简洁直接。' },
    ]);
    aiCache[key] = text;
    const keys = Object.keys(aiCache);
    if (keys.length > 120) delete aiCache[keys[0]];
    store(K.cache, aiCache);
    out.textContent = text;
  } catch (e) { out.textContent = aiErrText(e); }
}

/* ⑤ AI 对话 */
let chat = [];
function chatSys() {
  let s = '你是友好耐心的英语口语陪练 Alex。用简单自然的英语和用户聊天，每次回复不超过三句，多提问引导对方开口。';
  if ($('chat-fix').checked) s += ' 如果用户的英语有明显错误，先用一行简短中文指出并给出正确说法（行首加 ✏️），再继续英语对话。';
  return s;
}
function renderChat(pending) {
  $('chat-log').innerHTML = chat.map((m) =>
    '<div class="en-msg ' + (m.role === 'user' ? 'me' : 'bot') + '">' + esc(m.content).replace(/\n/g, '<br>') + '</div>').join('') +
    (pending ? '<div class="en-msg bot mono">…</div>' : '');
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
async function chatSend() {
  const inp = $('chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  chat.push({ role: 'user', content: text });
  renderChat(true);
  $('chat-send').disabled = true;
  try {
    const reply = await ai([{ role: 'system', content: chatSys() }].concat(chat.slice(-16)), 400);
    chat.push({ role: 'assistant', content: reply || '(空回复)' });
  } catch (e) {
    chat.push({ role: 'assistant', content: aiErrText(e) });
  }
  $('chat-send').disabled = false;
  renderChat(false);
  inp.focus();
}

/* ---------- ⑥ 设置 ---------- */
const PRESETS = {
  deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  glm: { base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  kimi: { base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};
function cfgSave() {
  cfg.base = $('set-base').value.trim() || cfg.base;
  cfg.key = $('set-key').value.trim();
  cfg.model = $('set-model').value.trim() || cfg.model;
  cfg.voice = $('en-voice').value || cfg.voice;
  cfg.rate = parseFloat($('en-rate').value) || 0.95;
  cfg.aud = $('en-aud').value || 'auto';
  cfg.acc = $('en-acc').value || 'us';
  cfg.level = $('set-level').value || '';
  cfg.daily = parseInt($('set-daily').value, 10) || 0;
  store(K.cfg, cfg);
  $('set-msg').textContent = '✓ 已保存（仅存于本机浏览器）';
}
async function cfgTest() {
  cfgSave();
  $('set-msg').textContent = '测试中…';
  try {
    const t = await ai([{ role: 'user', content: 'Reply with the single word: ok' }], 8);
    $('set-msg').textContent = '✓ 连接成功：' + t.slice(0, 40);
  } catch (e) { $('set-msg').textContent = aiErrText(e); }
}
function exportData() {
  const blob = new Blob([JSON.stringify({ words, stats }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'english-words-' + today() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function importData(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      if (Array.isArray(j.words)) {
        let n = 0;
        j.words.forEach((w) => { if (w && w.w && w.def && addWord(w.w, w.def)) { words[words.length - 1].srs = w.srs; n++; } });
        saveWords(); renderBook(); revStats();
        $('set-msg').textContent = '✓ 导入 ' + n + ' 个新词';
      } else $('set-msg').textContent = '文件格式不对';
    } catch (e) { $('set-msg').textContent = '解析失败：不是有效的 JSON'; }
  };
  rd.readAsText(file);
}

/* ---------- 考试等级词库（构建期从 ECDICT/MIT 生成，站内自托管，按需懒加载） ---------- */
const LEVELS = [
  ['zk', '中考'], ['gk', '高考'], ['cet4', 'CET-4'], ['cet6', 'CET-6'],
  ['ky', '考研'], ['toefl', 'TOEFL'], ['ielts', 'IELTS'], ['gre', 'GRE'],
];
const levelCache = {};
async function loadLevel(lv) {
  if (!lv) return null;
  if (levelCache[lv]) return levelCache[lv];
  try {
    const r = await fetch('/data/en/levels/' + lv + '.json');
    if (!r.ok) return null;
    const j = await r.json();
    j.id = lv;
    levelCache[lv] = j;
    return j;
  } catch (e) { return null; }
}
function levelName(lv) { const e = LEVELS.find((x) => x[0] === lv); return e ? e[1] : (lv === 'book' ? '生词本' : lv); }

/* 等级词库卡：进度 + 分批导入 */
async function renderLevelCard() {
  const box = $('book-level');
  if (!box) return;
  if (!cfg.level) {
    box.innerHTML = '<div class="mono" style="font-size:12.5px; color:var(--ink2); padding:4px 0;">还没设置考试等级 —— 去「设置」选一个（中考 → GRE），这里就会出现整套考纲词库。</div>';
    return;
  }
  box.innerHTML = '<div class="mono" style="font-size:12px; color:var(--ink2);">词库加载中…</div>';
  const p = await loadLevel(cfg.level);
  if (!p) { box.innerHTML = '<div class="mono" style="font-size:12px; color:var(--ink2);">词库加载失败（离线？）稍后再试。</div>'; return; }
  const have = new Set(words.map((w) => w.w.toLowerCase()));
  const done = p.words.reduce((t, e) => t + (have.has(e[0].toLowerCase()) ? 1 : 0), 0);
  const pct = ((done / p.n) * 100).toFixed(1);
  box.innerHTML =
    '<div class="lvl-card"><div class="lvl-head"><b>' + esc(p.name) + ' 考纲词库</b>' +
    '<span class="mono">' + done + ' / ' + p.n + ' 已入生词本 · ' + pct + '%</span></div>' +
    '<div class="enx-prog" style="margin:8px 0 12px;"><i style="width:' + pct + '%;"></i></div>' +
    '<div class="bw-actions" style="margin:0;">' +
    '<button type="button" class="pie-btn primary" id="lvl-imp">导入下一批 50 词（按词频）</button>' +
    '<span class="mono enx-msg" id="lvl-msg"></span></div></div>';
  $('lvl-imp').addEventListener('click', () => {
    const haveNow = new Set(words.map((w) => w.w.toLowerCase()));
    let n = 0;
    for (const e of p.words) {
      if (n >= 50) break;
      if (haveNow.has(e[0].toLowerCase())) continue;
      if (addWord(e[0], e[2])) {
        const it = words[words.length - 1];
        it.ph = e[1]; it.lv = cfg.level;
        n++;
      }
    }
    saveWords(); renderBook(); revStats(); renderLevelCard();
    if ($('lvl-msg')) $('lvl-msg').textContent = n ? '✓ 新增 ' + n + ' 词' : '词库已全部导入 🎉';
  });
}

/* 每日新词：进入复习时按计划从等级词库补充 */
async function ensureDailyNew() {
  if (!cfg.level || !(cfg.daily > 0)) return 0;
  const dk = load(K.daily, {});
  const got = dk[today()] || 0;
  if (got >= cfg.daily) return 0;
  const p = await loadLevel(cfg.level);
  if (!p) return 0;
  const have = new Set(words.map((w) => w.w.toLowerCase()));
  let n = 0;
  for (const e of p.words) {
    if (n >= cfg.daily - got) break;
    if (have.has(e[0].toLowerCase())) continue;
    if (addWord(e[0], e[2])) {
      const it = words[words.length - 1];
      it.ph = e[1]; it.lv = cfg.level;
      n++;
    }
  }
  if (n) { saveWords(); dk[today()] = got + n; store(K.daily, dk); }
  return n;
}

/* ---------- 闯关：等级词库切关，配对 / 四选一 / 听音辨词轮换，错词进 SRS ---------- */
const CHUNK = 50;
const STAGE_TYPES = ['配对', '选择', '听力'];
let gameStore = load(K.game, {});
let G = null;   /* 当前局 { src, stage, type, pool, sample, qi, right, wrongSet, combo } */
function gShuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function gameSrcId() {
  if (cfg.gameLv === 'book') return 'book';
  return cfg.gameLv || cfg.level || 'book';
}
async function gameWordList() {
  const src = gameSrcId();
  if (src !== 'book') {
    const p = await loadLevel(src);
    return p ? p.words.map((e) => ({ w: e[0], def: e[2] })) : [];
  }
  return words.map((x) => ({ w: x.w, def: x.def }));
}
function renderGameSrcSel() {
  const sel = $('game-src');
  if (!sel) return;
  const cur = gameSrcId();
  sel.innerHTML = LEVELS.map((l) =>
    '<option value="' + l[0] + '"' + (cur === l[0] ? ' selected' : '') + '>' + l[1] + '</option>').join('') +
    '<option value="book"' + (cur === 'book' ? ' selected' : '') + '>我的生词本</option>';
  if (!sel._wired) {
    sel._wired = true;
    sel.addEventListener('change', () => {
      cfg.gameLv = sel.value;
      store(K.cfg, cfg);
      renderGameMap();
    });
  }
}
function gameProg() { const id = gameSrcId(); if (!gameStore[id]) gameStore[id] = { stars: {} }; return gameStore[id]; }
function starsTotal(prog, nStage) { let t = 0; for (let i = 0; i < nStage; i++) t += prog.stars[i] || 0; return t; }
async function renderGameMap() {
  const map = $('game-map');
  renderGameSrcSel();
  $('game-play').hidden = true;
  $('game-result').hidden = true;
  map.hidden = false;
  const list = await gameWordList();
  const cont = $('game-cont');
  if (list.length < 12) {
    map.innerHTML = '<div class="mono" style="font-size:12.5px; color:var(--ink2);">词太少开不了关 —— 去「设置」选考试等级，或先在生词本攒 12 个词。</div>';
    $('game-lvlname').textContent = ''; $('game-stars').textContent = '';
    if (cont) cont.hidden = true;
    return;
  }
  const nStage = Math.ceil(list.length / CHUNK);
  const prog = gameProg();
  let cleared = 0;
  while (cleared < nStage && (prog.stars[cleared] || 0) > 0) cleared++;
  const unlocked = Math.min(nStage - 1, cleared + 2);   /* 通关进度 + 前方 2 关可玩 */
  $('game-lvlname').textContent = levelName(gameSrcId()) + ' · ' + list.length + ' 词 · ' + nStage + ' 关';
  $('game-stars').textContent = '★ ' + starsTotal(prog, nStage) + ' / ' + nStage * 3;
  if (cont) {
    const allDone = cleared >= nStage;
    cont.hidden = false;
    cont.disabled = allDone;
    cont.textContent = allDone ? '★ 全部通关' : '▶ 继续 · 第 ' + (cleared + 1) + ' 关';
    cont.dataset.i = String(Math.min(cleared, nStage - 1));
    if (!cont._wired) {
      cont._wired = true;
      cont.addEventListener('click', () => { if (!cont.disabled) startStage(parseInt(cont.dataset.i, 10)); });
    }
  }
  map.innerHTML = list.length ? Array.from({ length: nStage }, (_, i) => {
    const locked = i > unlocked;
    const st = prog.stars[i] || 0;
    return '<button type="button" class="gm-tile' + (locked ? ' lock' : '') + (st ? ' done' : '') + (i === cleared ? ' next' : '') + '" data-i="' + i + '"' + (locked ? ' disabled' : '') +
      ' title="第 ' + (i + 1) + ' 关 · 词 ' + (i * CHUNK + 1) + '–' + Math.min(list.length, (i + 1) * CHUNK) + '">' +
      '<b>' + (i + 1) + '</b>' +
      '<i>' + '★'.repeat(st) + '☆'.repeat(Math.max(0, 3 - st)) + '</i>' +
      '<em class="mono">' + (locked ? '🔒' : STAGE_TYPES[i % 3]) + '</em></button>';
  }).join('') : '';
  map.querySelectorAll('.gm-tile:not(.lock)').forEach((b) => b.addEventListener('click', () => startStage(parseInt(b.getAttribute('data-i'), 10))));
  map.insertAdjacentHTML('beforeend',
    '<div class="mono" style="grid-column:1/-1; font-size:11px; color:var(--ink2); padding-top:4px;">规则：正确率 ≥60% 得星过关；任意时刻开放「已通关进度 + 前方 2 关」。词按考纲词频从高到低切关——第 1 关就是最常用的 ' + CHUNK + ' 个词。</div>');
  /* 关卡多时地图内滚动到当前进度（面板隐藏时 rect 为 0，自动跳过） */
  const nx = map.querySelector('.gm-tile.next');
  if (nx && map.scrollHeight > map.clientHeight + 4) {
    const mr = map.getBoundingClientRect();
    if (mr.height > 0) map.scrollTop += nx.getBoundingClientRect().top - mr.top - map.clientHeight * 0.38;
  }
}
async function startStage(i) {
  const list = await gameWordList();
  const pool = list.slice(i * CHUNK, (i + 1) * CHUNK);
  if (pool.length < 8) { renderGameMap(); return; }
  const type = i % 3;
  const nQ = type === 0 ? 12 : type === 1 ? 12 : 10;
  G = {
    stage: i, type, pool,
    sample: gShuffle(pool).slice(0, Math.min(nQ, pool.length)),
    qi: 0, right: 0, miss: 0, combo: 0, wrongSet: {},
  };
  $('game-map').hidden = true;
  $('game-result').hidden = true;
  $('game-play').hidden = false;
  if ($('game-cont')) $('game-cont').hidden = true;
  $('gp-title').textContent = '第 ' + (i + 1) + ' 关 · ' + STAGE_TYPES[type];
  gUpdateHud();
  if (type === 0) matchRound(0);
  else quizAsk();
}
function gUpdateHud() {
  if (!G) return;
  const total = G.type === 0 ? G.sample.length : G.sample.length;
  const done = G.type === 0 ? G.matchDone || 0 : G.qi;
  $('gp-progress').textContent = done + ' / ' + total;
  $('gp-score').textContent = '✓ ' + G.right + (G.combo > 1 ? ' · 连击 ' + G.combo : '');
}
function gWrong(w, def) { if (!G.wrongSet[w]) G.wrongSet[w] = def; }
/* 配对：每轮 6 对 */
function matchRound(start) {
  const seg = G.sample.slice(start, start + 6);
  if (!seg.length) { finishStage(); return; }
  G.matchStart = start;
  let selL = null;
  const L = gShuffle(seg), R = gShuffle(seg);
  $('gp-stage').innerHTML =
    '<div class="mg-wrap"><div class="mg-col" id="mg-l">' +
    L.map((e) => '<button type="button" class="mg-it mono" data-w="' + esc(e.w) + '">' + esc(e.w) + '</button>').join('') +
    '</div><div class="mg-col" id="mg-r">' +
    R.map((e) => '<button type="button" class="mg-it" data-w="' + esc(e.w) + '">' + esc(e.def.slice(0, 42)) + '</button>').join('') +
    '</div></div>';
  const remain = new Set(seg.map((e) => e.w));
  $('gp-stage').querySelectorAll('#mg-l .mg-it').forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('ok')) return;
    $('gp-stage').querySelectorAll('#mg-l .mg-it').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel'); selL = b;
    pronounce(b.getAttribute('data-w'));
  }));
  $('gp-stage').querySelectorAll('#mg-r .mg-it').forEach((b) => b.addEventListener('click', () => {
    if (!selL || b.classList.contains('ok')) return;
    const lw = selL.getAttribute('data-w'), rw = b.getAttribute('data-w');
    if (lw === rw) {
      selL.classList.remove('sel'); selL.classList.add('ok'); b.classList.add('ok');
      G.right++; G.combo++; G.matchDone = (G.matchDone || 0) + 1;
      remain.delete(lw); selL = null;
      gUpdateHud();
      if (!remain.size) setTimeout(() => matchRound(start + 6), 500);
    } else {
      const e = seg.find((x) => x.w === lw);
      gWrong(lw, e ? e.def : '');
      G.miss++; G.combo = 0;
      selL.classList.add('bad'); b.classList.add('bad');
      const l0 = selL; selL = null;
      setTimeout(() => { l0.classList.remove('bad', 'sel'); b.classList.remove('bad'); }, 450);
      gUpdateHud();
    }
  }));
}
/* 四选一 / 听音辨词 */
function quizAsk() {
  if (G.qi >= G.sample.length) { finishStage(); return; }
  const cur = G.sample[G.qi];
  const opts = gShuffle([cur].concat(gShuffle(G.pool.filter((e) => e.w !== cur.w)).slice(0, 3)));
  const isListen = G.type === 2;
  $('gp-stage').innerHTML =
    '<div class="qz-prompt">' +
    (isListen
      ? '<button type="button" class="en-spkbtn" id="qz-spk" style="font-size:26px; padding:14px 26px;">🔊</button><div class="mono" style="font-size:12px; color:var(--ink2); margin-top:8px;">听发音，选单词</div>'
      : '<div class="qz-def">' + esc(cur.def.slice(0, 80)) + '</div><div class="mono" style="font-size:12px; color:var(--ink2); margin-top:8px;">选出对应的单词</div>') +
    '</div><div class="qz-opts">' +
    opts.map((o) => '<button type="button" class="qz-opt mono" data-w="' + esc(o.w) + '">' + esc(o.w) + '</button>').join('') +
    '</div>';
  if (isListen) {
    $('qz-spk').addEventListener('click', () => pronounce(cur.w));
    pronounce(cur.w);
  }
  let answered = false;
  $('gp-stage').querySelectorAll('.qz-opt').forEach((b) => b.addEventListener('click', () => {
    if (answered) return;
    answered = true;
    const pick = b.getAttribute('data-w');
    if (pick === cur.w) {
      b.classList.add('ok'); G.right++; G.combo++;
    } else {
      b.classList.add('bad'); G.combo = 0;
      gWrong(cur.w, cur.def);
      $('gp-stage').querySelectorAll('.qz-opt').forEach((x) => { if (x.getAttribute('data-w') === cur.w) x.classList.add('ok'); });
      if (!isListen) pronounce(cur.w);
    }
    G.qi++;
    gUpdateHud();
    setTimeout(quizAsk, pick === cur.w ? 550 : 1300);
  }));
}
function finishStage() {
  const total = G.sample.length;
  /* 配对：失误次数计入分母，否则怎么错都是满分 */
  const acc = G.type === 0
    ? (G.right + G.miss > 0 ? G.right / (G.right + G.miss) : 0)
    : (total ? G.right / total : 0);
  const stars = acc >= 0.92 ? 3 : acc >= 0.75 ? 2 : acc >= 0.6 ? 1 : 0;
  const prog = gameProg();
  if (stars > (prog.stars[G.stage] || 0)) prog.stars[G.stage] = stars;
  store(K.game, gameStore);
  /* 错词进生词本（立即到期，进 SRS） */
  const wrongs = Object.keys(G.wrongSet);
  let added = 0;
  wrongs.forEach((w) => { if (addWord(w, G.wrongSet[w])) { words[words.length - 1].lv = cfg.level || ''; added++; } });
  if (added) { saveWords(); revStats(); }
  $('game-play').hidden = true;
  const res = $('game-result');
  res.hidden = false;
  res.innerHTML =
    '<div class="gm-res">' +
    '<div class="gm-stars">' + (stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '未通关') + '</div>' +
    (stars ? '' : '<div class="mono" style="font-size:12px; color:var(--c-render);">正确率不足 60%，没拿到星 —— 错词已进生词本，复习后再来。</div>') +
    '<div class="gm-acc mono">正确率 ' + Math.round(acc * 100) + '% · ' + G.right + ' / ' + total + '</div>' +
    (wrongs.length ? '<div class="gm-wrong mono">错词 ' + wrongs.length + ' 个' + (added ? '（' + added + ' 个新词已加入生词本，将进入复习）' : '（已在生词本中）') + '：' + wrongs.slice(0, 8).map(esc).join(' · ') + (wrongs.length > 8 ? ' …' : '') + '</div>' : '<div class="gm-wrong mono" style="color:var(--good);">全对，零错词！</div>') +
    '<div class="bw-actions" style="justify-content:center;">' +
    '<button type="button" class="pie-btn" id="gm-retry">再来一次</button>' +
    (stars ? '<button type="button" class="pie-btn primary" id="gm-next">下一关 →</button>' : '') +
    '<button type="button" class="pie-btn" id="gm-back">返回地图</button>' +
    '</div></div>';
  $('gm-retry').addEventListener('click', () => startStage(G.stage));
  if ($('gm-next')) $('gm-next').addEventListener('click', () => startStage(G.stage + 1));
  $('gm-back').addEventListener('click', renderGameMap);
}

/* ---------- 标签页 & 初始化 ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.enx-side button');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('on'));
    tab.classList.add('on');
    const p = tab.getAttribute('data-p');
    document.querySelectorAll('.enx-panel').forEach((pan) => { pan.hidden = pan.getAttribute('data-p') !== p; });
    if (p === 'rev') {
      ensureDailyNew().then((n) => {
        buildQueue(); nextCard();
        if (n > 0 && $('rev-card')) {
          const tip = document.createElement('div');
          tip.className = 'mono enx-msg';
          tip.style.cssText = 'margin-bottom:8px;';
          tip.textContent = '☀ 已按每日计划加入 ' + n + ' 个新词';
          $('rev-card').parentNode.insertBefore(tip, $('rev-card'));
          setTimeout(() => tip.remove(), 4000);
        }
      });
    }
    if (p === 'book') { renderBook(); renderLevelCard(); }
    if (p === 'game') renderGameMap();
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (curAudio) try { curAudio.pause(); } catch (e) {}
  }));
}

function init() {
  if (!$('rev-card')) return;
  setupTabs();
  document.addEventListener('keydown', revKeys);
  loadVoices();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
  /* ① 复习 */
  buildQueue(); nextCard();
  /* ② 生词本 */
  $('book-packs').innerHTML = PACKS.map((p) =>
    '<button type="button" class="enx-pack" data-p="' + p.id + '"><b>' + p.name + '</b><span>' + p.words.length + ' 词 · 点击导入</span></button>').join('');
  $('book-packs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const p = PACKS.find((x) => x.id === b.getAttribute('data-p'));
    let n = 0;
    p.words.forEach((pair) => { if (addWord(pair[0], pair[1])) n++; });
    saveWords(); renderBook(); revStats();
    $('book-msg').textContent = n ? '✓ 新增 ' + n + ' 词' : '这些词都已在生词本里';
  }));
  $('bw-go').addEventListener('click', bwLookup);
  $('book-w').addEventListener('keydown', (e) => { if (e.key === 'Enter') bwLookup(); });
  $('bw-ai').addEventListener('click', bwAIDef);
  $('bw-clear').addEventListener('click', () => {
    $('bw-def').value = '';
    $('bw-senses') && $('bw-senses').querySelectorAll('.bw-sense.used').forEach((b) => b.classList.remove('used'));
  });
  $('bw-add').addEventListener('click', bwAdd);
  $('book-q').addEventListener('input', renderBook);
  renderBook();
  /* ③ 听写 */
  $('dict-start').addEventListener('click', dictNext);
  $('dict-replay').addEventListener('click', () => dictCur && pronounce(dictCur.w));
  $('dict-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') dictCheck(); });
  $('dict-check').addEventListener('click', dictCheck);
  /* ④ 词典 & AI 讲解 */
  $('lk-go').addEventListener('click', lookupWord);
  $('ai-go').addEventListener('click', explainWord);
  $('ai-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupWord(); });
  $('ai-spk').addEventListener('click', () => { const w = $('ai-word').value.trim(); if (w) pronounce(w); });
  /* ⑤ AI 对话 */
  $('chat-send').addEventListener('click', chatSend);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });
  $('chat-clear').addEventListener('click', () => { chat = []; renderChat(false); });
  renderChat(false);
  /* ⑥ 设置 */
  $('set-base').value = cfg.base; $('set-key').value = cfg.key; $('set-model').value = cfg.model;
  $('en-rate').value = cfg.rate;
  $('en-aud').value = cfg.aud || 'auto';
  $('en-acc').value = cfg.acc || 'us';
  $('set-level').innerHTML = '<option value="">不设置</option>' + LEVELS.map((l) => '<option value="' + l[0] + '"' + (cfg.level === l[0] ? ' selected' : '') + '>' + l[1] + '</option>').join('');
  $('set-daily').value = String(cfg.daily || 0);
  if ($('gp-quit')) $('gp-quit').addEventListener('click', renderGameMap);
  renderLevelCard();
  $('set-preset').addEventListener('change', () => {
    const p = PRESETS[$('set-preset').value];
    if (p) { $('set-base').value = p.base; $('set-model').value = p.model; }
  });
  $('set-save').addEventListener('click', cfgSave);
  $('set-test').addEventListener('click', cfgTest);
  $('en-try').addEventListener('click', () => { cfgSave(); speak('Hello! This is your pronunciation voice.'); });
  $('set-export').addEventListener('click', exportData);
  $('set-import').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
  $('set-wipe').addEventListener('click', () => {
    if (window.confirm && confirm('清空生词本与学习记录？此操作不可撤销。')) {
      words = []; stats = {}; saveWords(); store(K.stats, stats);
      renderBook(); revStats(); buildQueue(); nextCard();
    }
  });
}
init();
