/* 观音神课·三十二卦（观世音菩萨感应灵课）：掷五钱起卦（2^5=32），签诗与断语 */

const GUA = [
  { name: '星震卦', luck: '上上', verse: '彩凤呈祥瑞，麒麟降帝都，祸除迎福到，喜气自然生', duan: ['求官得位', '考试得意', '讼事有理', '病者安宁', '求财十分', '寻人得见', '婚姻有成', '买卖十分'] },
  { name: '从革卦', luck: '上平', verse: '从革宜变更，时来合运迁，龙门鱼跃过，凡骨作神仙', duan: ['求官小就', '谋事有成', '讼事宜和', '病人无妨', '求财七分', '走失有望', '婚姻有成', '交易成功'] },
  { name: '曲直卦', luck: '中平', verse: '动作因风便，求谋可托人，若逢戊己土，事事得遂心', duan: ['求官得位', '谋事有成', '讼事宜和', '病人无妨', '求财不多', '寻人不见', '婚姻可定', '交易大利'] },
  { name: '润下卦', luck: '小平', verse: '船放江湖内，滩边获宝多，更宜将大用，灾散福来居', duan: ['生意的利', '谋事可成', '求财八分', '病人得安', '讼事有吉', '寻人得见', '婚姻有成', '交易有成'] },
  { name: '炎上卦', luck: '下下', verse: '此卦按南方，灾难不可当，官司多不利，目下有灾殃', duan: ['求谋有害', '出行平下', '求财落空', '婚姻不成', '讼事无理', '寻人不见', '交易不遂', '行人不至'] },
  { name: '进穑卦', luck: '中平', verse: '且安君子分，勿用小人言，凡事皆当谨，作福保安然', duan: ['言语不遂', '谋事不成', '出行错误', '考试不利', '讼事不利', '病人不安', '婚姻难成', '求财不利'] },
  { name: '进求卦', luck: '上上', verse: '国治人安泰，家财见崭兴，进财求旺吉，有福亦平安', duan: ['求官得位', '谋事有成', '讼事得宜', '病人痊愈', '求财十分', '猝生贵子', '婚姻有成', '家宅兴旺'] },
  { name: '进宝卦', luck: '上吉', verse: '好事承天佑，门楣喜气新，有人相助力，获福尽欢欣', duan: ['求官得禄', '谋事有成', '讼事宜和', '病人得安', '求财九分', '婚姻有成', '交易有成', '家宅大吉'] },
  { name: '获安卦', luck: '中吉', verse: '目下如冬树，桔落没花开，看看喜色动，渐渐发萌芽', duan: ['讼事和吉', '病人无妨', '求财易得', '行人即至', '家宅吉利', '婚姻大利', '交易得和', '寻人得见'] },
  { name: '遂心卦', luck: '中平', verse: '时融逢和气，衰残物再兴，更逢微雨细，喜色又还生', duan: ['求官得位', '谋事大吉', '讼事可和', '病人得愈', '求财十分', '婚姻成就', '交易得和', '家宅得安'] },
  { name: '灾散卦', luck: '大吉', verse: '灾散福门开，无边喜气来，目下相逢处，须当得横财', duan: ['出行大吉', '谋事有成', '讼事得和', '病者无妨', '求财十二分', '六甲生男', '婚姻得成', '交易得和'] },
  { name: '通达卦', luck: '上平', verse: '进取逢通达，寒儒衣锦回，何人占此卦，凡事任施为', duan: ['求官得吉', '谋事合心', '讼事有理', '病者得愈', '求财九分', '行人立至', '寻人即来', '出行大吉'] },
  { name: '暗昧卦', luck: '下凶', verse: '井底观明月，见形却无影，钱财多散失，谨守得安宁', duan: ['求谋不遂', '出行不宜', '求财不得', '寻人不见', '子女不成', '交易不就', '家宅平安', '讼不得理'] },
  { name: '安静卦', luck: '下中', verse: '心思多不定，求谋未得成，忍耐方为福，守分免灾星', duan: ['功名不随', '出行不妨', '讼事和免', '谋事必成', '求财得利', '寻人不见', '婚姻二人', '家宅平安'] },
  { name: '阻隔卦', luck: '下凶', verse: '枯木逢霜雪，扁舟遇大风，心事无可托，百事不遂通', duan: ['求谋不利', '出行不宜', '求财不成', '寻人不见', '六甲生女', '心求和吉', '婚姻多阻', '交易不合'] },
  { name: '保安卦', luck: '平吉', verse: '日出临东海，光辉天下明，动用和合吉，百事自然成', duan: ['求官有望', '出行得意', '谋事渐成', '讼事得和', '求财十分', '六甲生男', '婚姻可成', '口舌消没'] },
  { name: '喜至卦', luck: '中吉', verse: '众恶皆消无，端然福气生，如人行暗夜，今已得天明', duan: ['入官得财', '谋事可成', '寻人得见', '出行得财', '讼事得白', '病人得愈', '求财八分', '婚姻大吉'] },
  { name: '保全卦', luck: '中平', verse: '服药将自保，缠绵词讼连，百凡宜守旧，作福自然安', duan: ['出行平安', '谋事先难', '口舌无妨', '讼官理吉', '求财六分', '孕生贵子', '婚姻有进', '交易可成'] },
  { name: '犹豫卦', luck: '下下', verse: '卦中多恍惚，钱财暗里磨，思深成怨去，认识不须和', duan: ['求谋不顺', '出行有阻', '讼事难和', '行人空亡', '求财不吉', '交易不成', '婚姻不遂', '病人沉重'] },
  { name: '丰稔卦', luck: '上吉', verse: '根实枝叶茂，林高格式高，经营多得利，兰惠似蓬蒿', duan: ['求官遂心', '出行通达', '谋事得成', '寻人得见', '病人无妨', '求财八分', '婚姻可成', '家宅平安'] },
  { name: '得禄卦', luck: '吉', verse: '高名居禄位，笼鸟得逃生，出入多财宝，更宜远方行', duan: ['谋事可成', '口舌可消', '讼事理合', '病人得安', '求财十分', '孕生贵子', '婚姻可成', '交易得利'] },
  { name: '明显卦', luck: '吉', verse: '明月青天上，今宵照绮筵，家家沾往泽，万里净云烟', duan: ['求官得位', '谋事可成', '寻人得见', '出行大吉', '讼事得和', '行人即至', '婚姻得成', '求财八分'] },
  { name: '福禄卦', luck: '吉', verse: '福禄得安康，荣华保吉昌，所得皆遂意，千里共兰香', duan: ['出行大吉', '谋事称心', '口舌不生', '讼事和吉', '求财九分', '行人即至', '婚姻得成', '交易遂心'] },
  { name: '滞凝卦', luck: '下', verse: '羸马登程去，饥人走远途，前人多阻隔，后福方无忧', duan: ['求谋不济', '出行破财', '求财折本', '讼求人和', '有孕生女', '婚姻不牢', '病人沉重', '家主有灾'] },
  { name: '显达卦', luck: '吉', verse: '三姓俱相伴，祥光得共生，更宜分造化，百福自然享', duan: ['求官受封', '口舌消灾', '讼事得和', '病宜保养', '六甲生男', '谋事有成', '求财得利', '婚姻可成'] },
  { name: '福厚卦', luck: '吉', verse: '此卦占太和，求谋喜事多，远人归故里，身乐得欢歌', duan: ['求官得位', '出行有财', '行人即至', '讼有人和', '求财九分', '寻人必至', '婚姻有成', '病人无妨'] },
  { name: '太平卦', luck: '吉', verse: '春雨滋苗稼，何愁不广收，自然心得乐，安然总无忧', duan: ['出行大吉', '行人即至', '讼事得和', '求财九分', '考试得进', '婚姻可成', '六甲生男', '病者渐安'] },
  { name: '颠险卦', luck: '不吉', verse: '迢迢途中旋，云横日坠山，心事无可托，前后总皆难', duan: ['求谋不顺', '出行不可', '求财折本', '行人不来', '讼事不利', '婚姻不许', '谋事不成', '病人不吉'] },
  { name: '开发卦', luck: '平', verse: '卦中珠自见，石内玉增光，进财求旺吉，有祸不成殃', duan: ['求官上任', '出行平安', '行人自至', '讼事宜和', '求财六分', '婚姻可成', '病人得安', '交易无难'] },
  { name: '鹰扬卦', luck: '吉', verse: '天兵诛贼寇，旌旗得胜归，功熟为将帅，门第有光辉', duan: ['谋事得就', '行人即至', '讼事得利', '求财九分', '婚姻得成', '六甲生男', '交易在远', '出行得吉'] },
  { name: '后吉卦', luck: '平', verse: '履薄登冰地，危桥得渡时，重重忧险过，喜色自芳菲', duan: ['考试小利', '出行平安', '行人自至', '讼事得吉', '求财五分', '寻人不见', '谋事晚成', '病人渐安'] },
  { name: '无数卦', luck: '凶', verse: '尘埋青铜钱，美玉陷淤泥，何时重出世，再得显光辉', duan: ['求官难保', '出行不利', '讼事不吉', '求财折本', '病人沉重', '婚姻难成', '谋事不成', '守旧待时'] },
];

const HKEY = 'yzzn-gy-history';

function $(id) { return document.getElementById(id); }

/* 吉凶归三档：吉（绿）/平（黄）/凶（红） */
function tier(luck) {
  if (/^(上上|大吉|上吉|吉|中吉)$/.test(luck)) return { k: '吉', c: '--good' };
  if (/^(下|下中|下下|下凶|凶|不吉)$/.test(luck)) return { k: '凶', c: '--c-render' };
  return { k: '平', c: '--c-tool' };
}

let spinTimer = null;
let lastText = '';

function setCoin(el, yang) {
  el.textContent = yang ? '阳' : '阴';
  el.classList.toggle('yang', yang);
}

function guaIndexFromBits(bits) {
  return bits.reduce((a, b) => a * 2 + b, 0) % 32;   /* 0–31 */
}

function render(idx, source) {
  const g = GUA[idx];
  const t = tier(g.luck);
  lastText = '【观音神课·三十二卦】' + source + '\n第' + (idx + 1) + '卦 · ' + g.name +
    '（' + g.luck + '）\n签诗：' + g.verse + '。\n断曰：' + g.duan.join('　');
  $('gy-result').innerHTML =
    '<div class="xlr-head"><b style="color:var(' + t.c + ');">第' + (idx + 1) + '卦 · ' + g.name + '</b>' +
    '<span class="mono">' + g.luck + ' · ' + t.k + '</span></div>' +
    '<p class="verse">「' + g.verse + '」</p>' +
    '<div class="gy-duan">' + g.duan.map((d) => '<span class="mono">' + d + '</span>').join('') + '</div>' +
    '<p class="mono src">' + source +
    '　<button type="button" class="pie-btn" id="gy-copy" style="padding:3px 10px; font-size:11px;">复制结果</button></p>';
  $('gy-copy').addEventListener('click', () => {
    const btn = $('gy-copy');
    const done = () => { btn.textContent = '✓ 已复制'; setTimeout(() => { btn.textContent = '复制结果'; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(lastText).then(done, done);
  });
  $('gy-out').hidden = false;
}

function cast() {
  const bits = [];
  for (let i = 0; i < 5; i++) bits.push(Math.random() < 0.5 ? 1 : 0);
  const idx = guaIndexFromBits(bits);
  const coins = Array.from($('gy-coins').children);
  const src = '掷五钱：' + bits.map((b) => (b ? '阳' : '阴')).join(' ');
  if (spinTimer) clearInterval(spinTimer);
  let ticks = 0;
  spinTimer = setInterval(() => {
    coins.forEach((c) => { setCoin(c, Math.random() < 0.5); c.classList.add('spin'); });
    setTimeout(() => coins.forEach((c) => c.classList.remove('spin')), 70);
    if (++ticks >= 8) {
      clearInterval(spinTimer); spinTimer = null;
      coins.forEach((c, i) => setCoin(c, bits[i] === 1));
      render(idx, src);
      saveHistory(idx, src);
    }
  }, 90);
}

/* 历史（最近 6 卦） */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; }
}
function saveHistory(idx, source) {
  const h = loadHistory();
  h.unshift({ i: idx, s: source, t: Date.now() });
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 6))); } catch (e) {}
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  const box = $('gy-history');
  if (!h.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="mono ht">最近起卦</div>' + h.map((it, idx) =>
    '<button type="button" class="xlr-his mono" data-i="' + idx + '">' +
    new Date(it.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
    '　第' + (it.i + 1) + '卦 ' + GUA[it.i].name + '</button>'
  ).join('');
  box.querySelectorAll('.xlr-his').forEach((b) => {
    b.addEventListener('click', () => {
      const it = loadHistory()[parseInt(b.getAttribute('data-i'), 10)];
      if (it) render(it.i, it.s);
    });
  });
}

function init() {
  if (!$('gy-coins')) return;
  const wrap = $('gy-coins');
  wrap.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('span');
    c.className = 'gy-coin';
    setCoin(c, i % 2 === 0);
    wrap.appendChild(c);
  }
  $('gy-cast').addEventListener('click', cast);
  $('gy-go-num').addEventListener('click', () => {
    let n = parseInt($('gy-num').value, 10);
    if (!n || n < 1) return;
    const idx = ((n - 1) % 32 + 32) % 32;
    render(idx, '报数起卦：' + n + ' → 第' + (idx + 1) + '卦');
    saveHistory(idx, '报数 ' + n);
  });
  renderHistory();
}
init();
