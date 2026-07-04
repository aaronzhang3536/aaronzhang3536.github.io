/* 小六壬速断：时间/报数起课 · 问事类型断语 · 三宫连断 · 历史记录 */
import { solar2lunar, hourOrder } from './core.js';

const PALACES = [
  {
    name: '大安', luck: 1, luckText: '大吉', wx: '木', shen: '青龙', fang: '东方',
    verse: '大安事事昌，求谋在东方，失物去不远，宅舍保安康。',
    text: '身不动时，属木，主静与稳。谋事宜守成缓进，凡事以不变应万变。',
    adv: {
      求财: '财在正途，稳中有进，不宜投机，东方有利。',
      感情: '关系安稳，细水长流；表白宜诚不宜急。',
      事业: '守正持重自有进益，暂不宜跳动或大变。',
      寻物: '失物未远，多在家宅之内或东侧低处。',
      出行: '平安顺遂，短途尤佳。',
      健康: '病势平稳，将养渐愈，不必过虑。',
    },
  },
  {
    name: '留连', luck: -1, luckText: '小凶', wx: '土', shen: '玄武', fang: '西南',
    verse: '留连事难成，求谋日未明，官事只宜缓，去者未回程。',
    text: '人未归时，属土，主迟滞纠缠。诸事拖延反复，宜缓不宜急。',
    adv: {
      求财: '财路纠缠拖沓，账款难收，忌再追加投入。',
      感情: '暧昧胶着、进退两难；把话说开胜过苦等。',
      事业: '项目反复扯皮，宜留文字记录，慢慢磨。',
      寻物: '失物被遮被压，一时难见，往柜底夹缝处寻。',
      出行: '多有延误改期，留足冗余时间。',
      健康: '病情缠绵，贵在坚持调理，勿频繁换方。',
    },
  },
  {
    name: '速喜', luck: 1, luckText: '大吉', wx: '火', shen: '朱雀', fang: '南方',
    verse: '速喜喜来临，求财向南行，失物申未午，逢人路上寻。',
    text: '人便至时，属火，主快与喜。消息立至，好事将近。',
    adv: {
      求财: '快财可求，南方有利，机会稍纵即逝。',
      感情: '有好消息临门，主动出击正当时。',
      事业: '面谈、汇报、签约皆宜速办，趁热打铁。',
      寻物: '午未申三时应验，失物多在明处偏南。',
      出行: '一路顺风，说走就走。',
      健康: '来势虽急去得也快，及时就医无碍。',
    },
  },
  {
    name: '赤口', luck: -2, luckText: '凶', wx: '金', shen: '白虎', fang: '西方',
    verse: '赤口主口舌，官非切要防，失物急去寻，行人有惊慌。',
    text: '官事凶时，属金，主口舌是非。慎言语、防争执与官非。',
    adv: {
      求财: '财上易生纠纷，合同条款逐字过目。',
      感情: '易因言语生隙，先冷静再沟通，忌翻旧账。',
      事业: '防口舌与小人，重要承诺落在书面。',
      寻物: '失物需急寻，迟则易损易散，西方留意。',
      出行: '途中易生摩擦，忍一时风平浪静。',
      健康: '留意口腔咽喉与刀刃利器之伤。',
    },
  },
  {
    name: '小吉', luck: 1, luckText: '吉', wx: '水', shen: '六合', fang: '北方',
    verse: '小吉最吉昌，路上好商量，阴人来报喜，失物在坤方。',
    text: '人来喜时，属水，主和合顺遂。谋事可成，贵人相助。',
    adv: {
      求财: '小财稳得，合伙有利，贵人多为女性。',
      感情: '有人牵线搭桥，顺水推舟即成。',
      事业: '合作共赢之象，托人办事十拿九稳。',
      寻物: '失物往西南方寻，或有人代为收起。',
      出行: '出行有得，途中遇助力。',
      健康: '调养得宜，遇良医，渐入佳境。',
    },
  },
  {
    name: '空亡', luck: -2, luckText: '大凶', wx: '土', shen: '勾陈', fang: '中央',
    verse: '空亡事不祥，阴人多乖张，求财无利益，行人有灾殃。',
    text: '音信稀时，属土，主落空虚耗。谋事难成，宜静养蓄力。',
    adv: {
      求财: '求财落空之象，捂紧口袋，勿听忽悠。',
      感情: '心意难通、音信渺茫，先安顿好自己。',
      事业: '推进乏力，宜复盘蓄力，等下一个窗口。',
      寻物: '寻回希望渺茫，破财消灾，权当放下。',
      出行: '此行多半白跑，能改期则改期。',
      健康: '症状虚实难辨，正规医院认真查一次。',
    },
  },
];
const STAGE = ['天时', '地利', '人和'];
const STAGE_MEAN = ['事之起因', '事之过程', '事之结果'];
const TYPES = ['综合', '求财', '感情', '事业', '寻物', '出行', '健康'];
const HKEY = 'yzzn-xlr-history';

function $(id) { return document.getElementById(id); }
function wxVar(wx) {
  return { 木: '--c-engine', 火: '--c-render', 土: '--c-tool', 金: '--ink2', 水: '--c-char' }[wx];
}

let lastText = '';

function comboVerdict(path) {
  const seq = path.map((p) => PALACES[p].luck);
  const score = seq[0] + seq[1] + seq[2] * 2;   /* 人和（结果）权重加倍 */
  const names = path.map((p) => PALACES[p].name).join('');
  if (seq.every((s) => s > 0)) return '三宫皆吉，一路绿灯，放手去做。';
  if (seq.every((s) => s < 0)) return '三宫皆晦，此事暂缓，另择时机为上。';
  if (seq[2] > 0 && seq[0] < 0) return '起头不顺而结局向好，先难后易，贵在坚持。';
  if (seq[2] < 0 && seq[0] > 0) return '开局顺利但收尾乏力，中途须防变数，见好就收。';
  if (score > 0) return '吉多于凶，大势可为，细节处留心即可。';
  return '凶多于吉，谋事需谨慎，多留退路。';
}

function cast(nums, sourceText) {
  const path = [];
  let pos = 0;
  for (let i = 0; i < 3; i++) {
    pos = i === 0 ? (nums[0] - 1) % 6 : (pos + nums[i] - 1) % 6;
    path.push(pos);
  }
  render(nums, path, sourceText);
  saveHistory(nums, path, sourceText);
}

function render(nums, path, sourceText) {
  const type = $('xlr-type').value;
  const final = PALACES[path[2]];
  $('xlr-wheel').innerHTML = PALACES.map((p, i) => {
    const hits = path.map((pp, si) => (pp === i ? si + 1 : 0)).filter(Boolean);
    return '<div class="xlr-cell' + (i === path[2] ? ' final' : '') + '">' +
      '<b style="color:var(' + wxVar(p.wx) + ');">' + p.name + '</b>' +
      '<span class="mono">' + p.wx + ' · ' + p.luckText + '</span>' +
      (hits.length ? '<i class="mono">' + hits.map((h) => STAGE[h - 1]).join(' ') + '</i>' : '') +
      '</div>';
  }).join('');
  /* 三宫连断 */
  $('xlr-path').innerHTML = path.map((pp, i) => {
    const p = PALACES[pp];
    return '<div class="xlr-stage">' +
      '<span class="mono st">' + STAGE[i] + ' · ' + STAGE_MEAN[i] + ' · 数 ' + nums[i] + '</span>' +
      '<b style="color:var(' + wxVar(p.wx) + ');">' + p.name + '</b>' +
      '<span class="sd">' + p.text + '</span></div>';
  }).join('');
  /* 终宫详解 */
  const advice = type === '综合' ? null : final.adv[type];
  lastText = '【小六壬】' + sourceText + '\n' +
    path.map((pp, i) => STAGE[i] + '·' + PALACES[pp].name).join(' → ') +
    '\n终宫：' + final.name + '（' + final.luckText + '）' +
    (advice ? '\n问' + type + '：' + advice : '') +
    '\n课断：' + comboVerdict(path);
  $('xlr-result').innerHTML =
    '<div class="xlr-head"><b style="color:var(' + wxVar(final.wx) + ');">' + final.name + '</b>' +
    '<span class="mono">' + final.luckText + ' · 五行' + final.wx + ' · ' + final.shen + ' · ' + final.fang + '</span></div>' +
    '<p class="verse">「' + final.verse + '」</p>' +
    (advice
      ? '<p><b class="mono" style="color:var(--accent);">问' + type + '</b>　' + advice + '</p>'
      : '<p>' + final.text + '</p>') +
    '<p><b class="mono" style="color:var(--play);">课断</b>　' + comboVerdict(path) + '</p>' +
    '<p class="mono src">' + sourceText + '　<button type="button" class="pie-btn" id="xlr-copy" style="padding:3px 10px; font-size:11px;">复制结果</button></p>';
  $('xlr-copy').addEventListener('click', () => {
    const btn = $('xlr-copy');
    const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '复制结果'; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(lastText).then(done, done);
  });
  $('xlr-out').hidden = false;
}

/* 历史（最近 6 课） */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; }
}
function saveHistory(nums, path, sourceText) {
  const h = loadHistory();
  h.unshift({ n: nums, p: path, s: sourceText, t: Date.now() });
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 6))); } catch (e) {}
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  const box = $('xlr-history');
  if (!h.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="mono ht">最近起课</div>' + h.map((it, idx) =>
    '<button type="button" class="xlr-his mono" data-i="' + idx + '">' +
    new Date(it.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
    '　' + it.p.map((pp) => PALACES[pp].name).join('→') + '</button>'
  ).join('');
  box.querySelectorAll('.xlr-his').forEach((b) => {
    b.addEventListener('click', () => {
      const it = loadHistory()[parseInt(b.getAttribute('data-i'), 10)];
      if (it) render(it.n, it.p, it.s);
    });
  });
}

function init() {
  if (!$('xlr-wheel')) return;
  /* 问事类型 */
  $('xlr-type').innerHTML = TYPES.map((t) => '<option>' + t + '</option>').join('');
  /* 模式切换 */
  document.querySelectorAll('.xlr-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.xlr-tab').forEach((t) => t.classList.remove('on'));
      tab.classList.add('on');
      const mode = tab.getAttribute('data-m');
      $('xlr-time-panel').hidden = mode !== 'time';
      $('xlr-num-panel').hidden = mode !== 'num';
    });
  });
  const dt = $('xlr-dt');
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  dt.value = now.toISOString().slice(0, 16);
  $('xlr-go-time').addEventListener('click', () => {
    const d = new Date(dt.value);
    if (isNaN(+d)) return;
    const lunar = solar2lunar(d);
    if (!lunar) return;
    const ho = hourOrder(d.getHours());
    const zhiName = '子丑寅卯辰巳午未申酉戌亥'[ho - 1];
    cast([lunar.month, lunar.day, ho],
      '农历' + lunar.text + ' · ' + zhiName + '时 → 月' + lunar.month + ' / 日' + lunar.day + ' / 时' + ho);
  });
  $('xlr-shake').addEventListener('click', () => {
    ['xlr-n1', 'xlr-n2', 'xlr-n3'].forEach((id) => {
      $(id).value = 1 + Math.floor(Math.random() * 99);
    });
  });
  $('xlr-go-num').addEventListener('click', () => {
    const ns = ['xlr-n1', 'xlr-n2', 'xlr-n3'].map((id) => parseInt($(id).value, 10));
    if (ns.some((n) => !n || n < 1)) return;
    cast(ns, '报数起课：' + ns.join(' / '));
  });
  renderHistory();
}
init();
