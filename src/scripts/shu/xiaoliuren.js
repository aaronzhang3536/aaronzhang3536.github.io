/* 小六壬速断：时间起课（农历月/日/时辰）与报数起课 */
import { solar2lunar, hourOrder, cssVar } from './core.js';

const PALACES = [
  {
    name: '大安', luck: '大吉', wx: '木', shen: '青龙', fang: '东方',
    verse: '大安事事昌，求谋在东方，失物去不远，宅舍保安康。',
    text: '身不动时，属木，主静与稳。谋事宜守成缓进，出行平安，病者渐愈，失物未远、多在东侧或家宅之内。',
    good: '求稳、守成、置业、和解',
    bad: '急进、远行冒险',
  },
  {
    name: '留连', luck: '小凶', wx: '土', shen: '玄武', fang: '西南',
    verse: '留连事难成，求谋日未明，官事只宜缓，去者未回程。',
    text: '人未归时，属土，主迟滞纠缠。诸事拖延反复，宜缓不宜急；寻人未回，失物难寻，讼事宜和。',
    good: '整理旧账、耐心磨合',
    bad: '催促、签约、追讨',
  },
  {
    name: '速喜', luck: '大吉', wx: '火', shen: '朱雀', fang: '南方',
    verse: '速喜喜来临，求财向南行，失物申未午，逢人路上寻。',
    text: '人便至时，属火，主快与喜。消息立至，求财往南，午未申三时应验；婚事有成，病者无碍。',
    good: '面谈、签约、表白、求财',
    bad: '拖延观望',
  },
  {
    name: '赤口', luck: '凶', wx: '金', shen: '白虎', fang: '西方',
    verse: '赤口主口舌，官非切要防，失物急去寻，行人有惊慌。',
    text: '官事凶时，属金，主口舌是非。慎言语、防争执与官非；行人有惊无险，失物需急寻，西方留意。',
    good: '闭口修身、整备文书',
    bad: '争辩、诉讼、锋芒外露',
  },
  {
    name: '小吉', luck: '吉', wx: '水', shen: '六合', fang: '北方',
    verse: '小吉最吉昌，路上好商量，阴人来报喜，失物在坤方。',
    text: '人来喜时，属水，主和合顺遂。谋事可成，贵人多为女性；出行有得，失物往西南寻。',
    good: '合作、出行、托人办事',
    bad: '单打独斗',
  },
  {
    name: '空亡', luck: '大凶', wx: '土', shen: '勾陈', fang: '中央',
    verse: '空亡事不祥，阴人多乖张，求财无利益，行人有灾殃。',
    text: '音信稀时，属土，主落空虚耗。谋事难成，消息渺茫，宜静养蓄力、检视自身，勿强求。',
    good: '休整、复盘、祈福',
    bad: '投资、远行、开新局',
  },
];
const STAGE = ['天时', '地利', '人和'];

function $(id) { return document.getElementById(id); }

function cast(nums, sourceText) {
  const path = [];
  let pos = 0;
  for (let i = 0; i < 3; i++) {
    pos = i === 0 ? (nums[0] - 1) % 6 : (pos + nums[i] - 1) % 6;
    path.push(pos);
  }
  render(nums, path, sourceText);
}

function render(nums, path, sourceText) {
  const final = PALACES[path[2]];
  /* 六宫盘 */
  const wheel = $('xlr-wheel');
  wheel.innerHTML = PALACES.map((p, i) => {
    const hits = path.map((pp, si) => (pp === i ? si + 1 : 0)).filter(Boolean);
    const isFinal = i === path[2];
    return '<div class="xlr-cell' + (isFinal ? ' final' : '') + '">' +
      '<b style="color:var(' + wxVar(p.wx) + ');">' + p.name + '</b>' +
      '<span class="mono">' + p.wx + ' · ' + p.luck + '</span>' +
      (hits.length ? '<i class="mono">' + hits.map((h) => STAGE[h - 1]).join(' ') + '</i>' : '') +
      '</div>';
  }).join('');
  /* 过程 */
  $('xlr-path').innerHTML = path.map((pp, i) =>
    '<span><em class="mono">' + STAGE[i] + '·' + nums[i] + '</em>' +
    '<b style="color:var(' + wxVar(PALACES[pp].wx) + ');">' + PALACES[pp].name + '</b></span>'
  ).join('<span class="mono arr">→</span>');
  /* 结果 */
  $('xlr-result').innerHTML =
    '<div class="xlr-head"><b style="color:var(' + wxVar(final.wx) + ');">' + final.name + '</b>' +
    '<span class="mono">' + final.luck + ' · 五行' + final.wx + ' · ' + final.shen + ' · ' + final.fang + '</span></div>' +
    '<p class="verse">「' + final.verse + '」</p>' +
    '<p>' + final.text + '</p>' +
    '<p class="mono gb"><span>宜</span>' + final.good + '　<span class="b">忌</span>' + final.bad + '</p>' +
    '<p class="mono src">' + sourceText + '</p>';
  $('xlr-out').hidden = false;
}

function wxVar(wx) {
  return { 木: '--c-engine', 火: '--c-render', 土: '--c-tool', 金: '--ink2', 水: '--c-char' }[wx];
}

function init() {
  if (!$('xlr-wheel')) return;
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
  /* 时间起课 */
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
  /* 报数起课 */
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
}
init();
