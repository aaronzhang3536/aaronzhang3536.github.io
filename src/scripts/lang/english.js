/* 英语学习中心：SRS 生词本（SM-2）+ 听写拼写 + TTS 发音 + AI 讲解/对话（BYOK）
   所有数据存 localStorage；AI 为可选功能，Key 只存本地、直连 OpenAI 兼容接口 */

const K = { words: 'yzzn-en-words', cfg: 'yzzn-en-cfg', stats: 'yzzn-en-stats', cache: 'yzzn-en-ai' };

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
let cfg = load(K.cfg, { base: 'https://api.deepseek.com/v1', key: '', model: 'deepseek-chat', voice: '', rate: 0.95 });
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
function speak(text) {
  if (!window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = cfg.rate || 0.95;
    const v = voices.find((x) => x.name === cfg.voice) || voices[0];
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
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
let queue = [], cur = null;
function buildQueue() {
  queue = dueWords().slice();
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
}
function revStats() {
  $('rev-stat').textContent = '今日已复习 ' + (stats[today()] || 0) + ' · 连续 ' + streak() + ' 天 · 生词本 ' + words.length + ' 词 · 待复习 ' + dueWords().length;
}
function nextCard() {
  cur = queue.shift() || null;
  const box = $('rev-card');
  revStats();
  if (!cur) {
    box.innerHTML = words.length
      ? '<div class="en-done">🎉 今日复习完成！<span class="mono">明天再来，或去「③ 听写」巩固拼写</span></div>'
      : '<div class="en-done">生词本是空的<span class="mono">去「② 生词本」导入词包或手动添加</span></div>';
    return;
  }
  box.innerHTML =
    '<div class="en-word">' + esc(cur.w) + ' <button type="button" class="pie-btn en-spk" id="rev-spk">🔊</button></div>' +
    '<div class="en-def" id="rev-def" hidden>' + esc(cur.def) + '</div>' +
    '<div class="en-actions" id="rev-actions">' +
    '<button type="button" class="pie-btn primary" id="rev-show">显示释义</button></div>';
  $('rev-spk').addEventListener('click', () => speak(cur.w));
  speak(cur.w);
  $('rev-show').addEventListener('click', () => {
    $('rev-def').hidden = false;
    $('rev-actions').innerHTML =
      '<button type="button" class="pie-btn en-g0" data-q="0">忘了</button>' +
      '<button type="button" class="pie-btn en-g3" data-q="3">模糊</button>' +
      '<button type="button" class="pie-btn en-g5" data-q="5">认识</button>';
    $('rev-actions').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const q = parseInt(b.getAttribute('data-q'), 10);
      sm2(cur, q); bumpStat(); saveWords();
      if (q < 3) queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, cur);
      nextCard();
    }));
  });
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
    '<div class="en-row"><b>' + esc(w.w) + '</b><span>' + esc(w.def) + '</span>' + fmtDue(w) +
    '<button type="button" class="pie-btn en-spk" data-s="' + esc(w.w) + '">🔊</button>' +
    '<button type="button" class="pie-btn en-del" data-w="' + esc(w.w) + '">✕</button></div>').join('') ||
    '<div class="mono" style="color:var(--ink2); font-size:12.5px; padding:10px 0;">还没有词——导入下面的词包，或在上方手动添加。</div>';
  $('book-list').querySelectorAll('.en-spk').forEach((b) => b.addEventListener('click', () => speak(b.getAttribute('data-s'))));
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

/* ---------- ③ 听写拼写 ---------- */
let dictCur = null, dictStreak = 0;
function dictPool() {
  const scope = $('dict-scope').value;
  return scope === 'due' ? dueWords() : words;
}
function dictNext() {
  const pool = dictPool();
  if (!pool.length) { $('dict-msg').textContent = '没有可听写的词——先去导入词包。'; dictCur = null; return; }
  let w = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && dictCur && w.w === dictCur.w) w = pool[(pool.indexOf(w) + 1) % pool.length];
  dictCur = w;
  $('dict-input').value = '';
  $('dict-msg').innerHTML = '听音拼写，回车提交　<span class="mono" style="color:var(--ink2);">连对 ' + dictStreak + '</span>';
  $('dict-input').focus();
  speak(w.w);
}
function dictCheck() {
  if (!dictCur) return;
  const val = $('dict-input').value.trim().toLowerCase();
  if (!val) { speak(dictCur.w); return; }
  if (val === dictCur.w.toLowerCase()) {
    dictStreak++; bumpStat();
    $('dict-msg').innerHTML = '<span style="color:var(--good);">✓ 正确</span>　' + esc(dictCur.w) + ' — ' + esc(dictCur.def) +
      '　<span class="mono" style="color:var(--ink2);">连对 ' + dictStreak + '</span>';
    setTimeout(dictNext, 1100);
  } else {
    dictStreak = 0;
    $('dict-msg').innerHTML = '<span style="color:var(--c-render);">✗ 不对</span>　正确拼写：<b>' + esc(dictCur.w) + '</b> — ' + esc(dictCur.def);
    speak(dictCur.w);
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
      { role: 'user', content: '讲解英文单词 "' + w + '"：\n1. 美式音标\n2. 核心词义（按词性，中文）\n3. 三个地道例句（英文+中文，由易到难）\n4. 高频搭配 2-3 个\n5. 一句话记忆技巧\n简洁直接。' },
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

/* ---------- 标签页 & 初始化 ---------- */
function setupTabs() {
  const tabs = document.querySelectorAll('.uke-tab');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('on'));
    tab.classList.add('on');
    const p = tab.getAttribute('data-p');
    document.querySelectorAll('.uke-panel').forEach((pan) => { pan.hidden = pan.getAttribute('data-p') !== p; });
    if (p === 'rev') { buildQueue(); nextCard(); }
    if (p === 'book') renderBook();
    if (window.speechSynthesis) speechSynthesis.cancel();
  }));
}

function init() {
  if (!$('rev-card')) return;
  setupTabs();
  loadVoices();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;
  /* ① 复习 */
  buildQueue(); nextCard();
  /* ② 生词本 */
  $('book-packs').innerHTML = PACKS.map((p) =>
    '<button type="button" class="pie-btn" data-p="' + p.id + '">导入 ' + p.name + '</button>').join('');
  $('book-packs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const p = PACKS.find((x) => x.id === b.getAttribute('data-p'));
    let n = 0;
    p.words.forEach((pair) => { if (addWord(pair[0], pair[1])) n++; });
    saveWords(); renderBook(); revStats();
    $('book-msg').textContent = n ? '✓ 新增 ' + n + ' 词' : '这些词都已在生词本里';
  }));
  $('book-add').addEventListener('click', () => {
    if (addWord($('book-w').value, $('book-d').value)) {
      saveWords(); renderBook(); revStats();
      $('book-w').value = ''; $('book-d').value = ''; $('book-msg').textContent = '✓ 已添加';
    } else $('book-msg').textContent = '词为空或已存在';
  });
  $('book-q').addEventListener('input', renderBook);
  renderBook();
  /* ③ 听写 */
  $('dict-start').addEventListener('click', dictNext);
  $('dict-replay').addEventListener('click', () => dictCur && speak(dictCur.w));
  $('dict-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') dictCheck(); });
  $('dict-check').addEventListener('click', dictCheck);
  /* ④ AI 讲解 */
  $('ai-go').addEventListener('click', explainWord);
  $('ai-word').addEventListener('keydown', (e) => { if (e.key === 'Enter') explainWord(); });
  $('ai-spk').addEventListener('click', () => { const w = $('ai-word').value.trim(); if (w) speak(w); });
  /* ⑤ AI 对话 */
  $('chat-send').addEventListener('click', chatSend);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });
  $('chat-clear').addEventListener('click', () => { chat = []; renderChat(false); });
  renderChat(false);
  /* ⑥ 设置 */
  $('set-base').value = cfg.base; $('set-key').value = cfg.key; $('set-model').value = cfg.model;
  $('en-rate').value = cfg.rate;
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
