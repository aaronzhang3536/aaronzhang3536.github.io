/* 术数核心库：干支 / 五行 / 纳音 / 藏干 / 十神 / 节气 / 农历
   农历表 1900-2100 摘自 jjonline/calendar.js (MIT)；
   干支算法移植自作者的 BaZi Android 项目（BaZiCalculator.kt），
   月柱/年柱升级为节气分界，大运升级为距节折算起运。 */

export const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
export const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
export const SHENGXIAO = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
export const GAN_WX = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
export const ZHI_WX = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'];
export const WX_COLOR = { 木: '--c-engine', 火: '--c-render', 土: '--c-tool', 金: '--ink', 水: '--c-char' };
export const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
export const KE = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

/* 地支藏干（主气/中气/余气） */
export const CANGGAN = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '庚', '戊'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};

/* 十神：以日干为我 */
export function shiShen(riGan, gan) {
  const rw = GAN_WX[GAN.indexOf(riGan)], tw = GAN_WX[GAN.indexOf(gan)];
  const same = GAN.indexOf(riGan) % 2 === GAN.indexOf(gan) % 2;
  if (tw === rw) return same ? '比肩' : '劫财';
  if (SHENG[rw] === tw) return same ? '食神' : '伤官';
  if (KE[rw] === tw) return same ? '偏财' : '正财';
  if (KE[tw] === rw) return same ? '七杀' : '正官';
  return same ? '偏印' : '正印';
}

/* 六十甲子纳音 */
export const NAYIN = [
  '海中金', '炉中火', '大林木', '路旁土', '剑锋金', '山头火', '涧下水', '城头土', '白蜡金', '杨柳木',
  '泉中水', '屋上土', '霹雳火', '松柏木', '长流水', '沙中金', '山下火', '平地木', '壁上土', '金箔金',
  '覆灯火', '天河水', '大驿土', '钗钏金', '桑柘木', '大溪水', '沙中土', '天上火', '石榴木', '大海水',
];
export function nayin(ganIdx, zhiIdx) {
  for (let i = 0; i < 60; i++) {
    if (i % 10 === ganIdx && i % 12 === zhiIdx) return NAYIN[i >> 1];
  }
  return '';
}

export function jdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/* 十二节（定月柱边界）：寿星公式，日精度，个别年份可能有一天误差 */
const JIE_C20 = [6.11, 4.6295, 6.318, 5.59, 6.318, 6.5, 7.928, 8.35, 8.44, 9.098, 8.218, 7.9];
const JIE_C21 = [5.4055, 3.87, 5.63, 4.81, 5.52, 5.678, 7.108, 7.5, 7.646, 8.318, 7.438, 7.18];
const JIE_MONTH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const JIE_NAME = ['小寒', '立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪'];
const JIE_ZHI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0];

export function jieDay(year, n) {
  const C = year >= 2000 ? JIE_C21 : JIE_C20;
  const y = year % 100;
  const leapAdj = n < 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  return Math.floor(y * 0.2422 + C[n]) - leapAdj;
}
export function jieDate(year, n) {
  return new Date(year, JIE_MONTH[n] - 1, jieDay(year, n));
}

/* 四柱（晚子时 23 点按不换日流派） */
export function fourPillars(date) {
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate(), h = date.getHours();
  const lichun = jieDate(y, 1);
  const yYear = date >= lichun ? y : y - 1;
  const yOff = ((yYear - 1984) % 60 + 60) % 60;
  const yG = yOff % 10, yZ = yOff % 12;
  let jY = y, jN = -1;
  for (let i = 11; i >= 0; i--) {
    if (date >= jieDate(y, i)) { jN = i; break; }
  }
  if (jN < 0) { jY = y - 1; jN = 11; }
  const mZ = JIE_ZHI[jN];
  const monthOrd = ((mZ - 2) % 12 + 12) % 12;
  const mG = ((yG % 5) * 2 + 2 + monthOrd) % 10;
  const dOff = ((jdn(y, mo, d) - jdn(2000, 1, 1) + 54) % 60 + 60) % 60;
  const dG = dOff % 10, dZ = dOff % 12;
  const hZ = (h === 23 || h === 0) ? 0 : Math.floor((h + 1) / 2) % 12;
  const hG = ((dG % 5) * 2 + hZ) % 10;
  return {
    year: [yG, yZ], month: [mG, mZ], day: [dG, dZ], hour: [hG, hZ],
    yearNum: yYear, jieIdx: jN, jieYear: jY,
  };
}

/* 大运：距节天数除 3 起运（3 天=1 岁、1 天=4 月） */
export function daYun(date, pillars, isMale) {
  const yang = pillars.year[0] % 2 === 0;
  const forward = (isMale && yang) || (!isMale && !yang);
  let edge, diffMs;
  if (forward) {
    let y = date.getFullYear(), n = pillars.jieIdx + 1;
    if (n > 11) { n = 0; y += 1; }
    edge = jieDate(y, n);
    diffMs = edge - date;
  } else {
    edge = jieDate(pillars.jieYear, pillars.jieIdx);
    diffMs = date - edge;
  }
  const days = Math.max(0, diffMs / 86400000);
  const age = Math.floor(days / 3);
  const months = Math.round((days % 3) * 4);
  const list = [];
  let g = pillars.month[0], z = pillars.month[1];
  for (let i = 0; i < 8; i++) {
    g = ((g + (forward ? 1 : -1)) % 10 + 10) % 10;
    z = ((z + (forward ? 1 : -1)) % 12 + 12) % 12;
    list.push({ g: g, z: z, age: age + i * 10, year: pillars.yearNum + age + i * 10 });
  }
  return { forward: forward, age: age, months: months, list: list };
}

/* ---------- 农历 ---------- */
const LUNAR_INFO = [0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,0x06566,0x0d4a0,0x0ea50,0x16a95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06aa0,0x1a6c4,0x0aae0,0x092e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,0x0d520];
const L_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const L_DAY10 = ['初', '十', '廿', '卅'];
const L_NUM = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function leapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
function leapDays(y) { return leapMonth(y) ? ((LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29) : 0; }
function lYearDays(y) {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
  return sum + leapDays(y);
}
function lMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

export function solar2lunar(date) {
  let offset = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 86400000);
  if (offset < 0 || offset > 73414) return null;
  let y = 1900, temp = 0;
  for (; y < 2101 && offset > 0; y++) {
    temp = lYearDays(y);
    offset -= temp;
  }
  if (offset < 0) { offset += temp; y--; }
  const leap = leapMonth(y);
  let isLeap = false, m = 1;
  for (; m < 13 && offset > 0; m++) {
    if (leap > 0 && m === leap + 1 && !isLeap) {
      m--; isLeap = true; temp = leapDays(y);
    } else {
      temp = lMonthDays(y, m);
    }
    if (isLeap && m === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && m === leap + 1) {
    if (isLeap) { isLeap = false; }
    else { isLeap = true; m--; }
  }
  if (offset < 0) { offset += temp; m--; }
  const day = offset + 1;
  function dayName(dd) {
    if (dd === 10) return '初十';
    if (dd === 20) return '二十';
    if (dd === 30) return '三十';
    return L_DAY10[Math.floor(dd / 10)] + L_NUM[dd % 10];
  }
  return {
    year: y, month: m, day: day, isLeap: isLeap,
    text: (isLeap ? '闰' : '') + L_MONTH[m - 1] + '月' + dayName(day),
  };
}

/* 时辰序：子=1 至 亥=12 */
export function hourOrder(h) {
  return ((h === 23 || h === 0) ? 0 : Math.floor((h + 1) / 2) % 12) + 1;
}
export function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
}
