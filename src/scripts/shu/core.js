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

/* 十二节精确时刻（定年柱/月柱边界与大运起运）：1900–2101 年，北京时间，精确到秒。
   离线由寿星天文历算法生成（lunar-javascript 1.7.7：Lunar.fromYmd(年, 6, 1).getJieQiTable()），
   对每个节做线性拟合后只存残差：
   时刻 = 2000-01-01 00:00 + JIE_A[n] + JIE_B[n]·(年−2000) + 残差秒；
   残差 ∈ [-2048, 2047]，加 2048 后每项 2 个 base64 字符，按年、每年 12 节顺序排列。
   时刻统一用「挂钟秒」：把北京时间的年月日时分秒当作 UTC 换算出的秒数，与用户时区无关。 */
export const YEAR_MIN = 1901, YEAR_MAX = 2100;
const JIE_Y0 = 1900, JIE_Y1 = 2101;
const JIE_EPOCH = 946684800;
const JIE_A = [464015, 3011569, 5582093, 8191485, 10845853, 13539238, 16254559, 18968204, 21657057, 24305339, 26908763, 29474993];
const JIE_B = [31556975, 31556970, 31556953, 31556929, 31556903, 31556883, 31556874, 31556880, 31556898, 31556923, 31556949, 31556967];
const JIE_R = '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';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const JIE_NAME = ['小寒', '立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪'];
const JIE_ZHI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0];

/* 某年第 n 个节（0=小寒 … 11=大雪）的挂钟秒；超出表范围返回 NaN */
export function jieSec(year, n) {
  if (!Number.isInteger(year) || !Number.isInteger(n) || !(year >= JIE_Y0 && year <= JIE_Y1) || !(n >= 0 && n < 12)) return NaN;
  const k = ((year - JIE_Y0) * 12 + n) * 2;
  const r = B64.indexOf(JIE_R[k]) * 64 + B64.indexOf(JIE_R[k + 1]) - 2048;
  return JIE_EPOCH + JIE_A[n] + JIE_B[n] * (year - 2000) + r;
}
/* 输入的出生时间按北京时间的挂钟读数理解 */
export function wallSec(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds()) / 1000;
}
export function inRange(date) {
  const y = date?.getFullYear?.();
  return y >= YEAR_MIN && y <= YEAR_MAX;
}

/* 日历读数适配器：使用 UTC 验证日期，但不把输入解释为浏览器当地时间或真实 UTC 时刻。
   暴露核心算法所需的 Date 读取方法，避免设备时区 / 夏令时将不存在的本地时刻自动挪动。 */
export function calendarDate(year, month, day, hour = 0, minute = 0, second = 0) {
  if (![year, month, day, hour, minute, second].every(Number.isInteger) ||
      year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Object.freeze({
    getFullYear: () => year, getMonth: () => month - 1, getDate: () => day,
    getHours: () => hour, getMinutes: () => minute, getSeconds: () => second,
    getTime: () => date.getTime(), valueOf: () => date.getTime(),
  });
}

/* 默认晚子时日柱不换；zi 模式在 23 点换日。两种规则的晚子时时干都按次日日干计算。 */
export function fourPillars(date, { dayBoundary = 'midnight' } = {}) {
  if (!inRange(date)) return null;
  if (!['midnight', 'zi'].includes(dayBoundary)) return null;
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate(), h = date.getHours();
  const t = wallSec(date);
  const yYear = t >= jieSec(y, 1) ? y : y - 1;
  const yOff = ((yYear - 1984) % 60 + 60) % 60;
  const yG = yOff % 10, yZ = yOff % 12;
  let jY = y, jN = -1;
  for (let i = 11; i >= 0; i--) {
    if (t >= jieSec(y, i)) { jN = i; break; }
  }
  if (jN < 0) { jY = y - 1; jN = 11; }
  const mZ = JIE_ZHI[jN];
  const monthOrd = ((mZ - 2) % 12 + 12) % 12;
  const mG = ((yG % 5) * 2 + 2 + monthOrd) % 10;
  const dOff = ((jdn(y, mo, d) - jdn(2000, 1, 1) + 54) % 60 + 60) % 60;
  const dayOff = dOff + (dayBoundary === 'zi' && h === 23 ? 1 : 0);
  const dG = dayOff % 10, dZ = dayOff % 12;
  const hZ = (h === 23 || h === 0) ? 0 : Math.floor((h + 1) / 2) % 12;
  const hDayG = (dOff + (h === 23 ? 1 : 0)) % 10;
  const hG = ((hDayG % 5) * 2 + hZ) % 10;
  return {
    year: [yG, yZ], month: [mG, mZ], day: [dG, dZ], hour: [hG, hZ],
    yearNum: yYear, jieIdx: jN, jieYear: jY,
  };
}

/* 大运：出生与前/后一节相距的分钟数折算起运（4320 分=1 年，360 分=1 月，12 分=1 天，余 1 分=2 时），
   与常见排盘软件按分钟折算的做法一致；首运年份 = 出生时刻加上起运时长后落在的公历年 */
export function daYun(date, pillars, isMale) {
  const yang = pillars.year[0] % 2 === 0;
  const forward = (isMale && yang) || (!isMale && !yang);
  let y = pillars.jieYear, n = pillars.jieIdx;
  if (forward) {
    n += 1;
    if (n > 11) { n = 0; y += 1; }
  }
  const birthMin = Math.floor(wallSec(date) / 60), edgeMin = Math.floor(jieSec(y, n) / 60);
  let rest = Math.max(0, forward ? edgeMin - birthMin : birthMin - edgeMin);
  const age = Math.floor(rest / 4320); rest -= age * 4320;
  const months = Math.floor(rest / 360); rest -= months * 360;
  const days = Math.floor(rest / 12); rest -= days * 12;
  const hours = rest * 2;
  /* 起运时刻：依次按公历加年、加月（日期超出当月天数则取月末），再加天、时 */
  const b = new Date(birthMin * 60000);
  const dim = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  let sy = b.getUTCFullYear() + age, sm = b.getUTCMonth(), sd = Math.min(b.getUTCDate(), dim(sy, sm));
  sy += Math.floor((sm + months) / 12); sm = (sm + months) % 12;
  sd = Math.min(sd, dim(sy, sm));
  const start = new Date(Date.UTC(sy, sm, sd, b.getUTCHours(), b.getUTCMinutes()) + (days * 24 + hours) * 3600000);
  const startYear = start.getUTCFullYear();
  const list = [];
  const decadeSec = (i) => {
    const year = startYear + i * 10, month = start.getUTCMonth();
    return Date.UTC(year, month, Math.min(start.getUTCDate(), dim(year, month)),
      start.getUTCHours(), start.getUTCMinutes()) / 1000;
  };
  let g = pillars.month[0], z = pillars.month[1];
  for (let i = 0; i < 8; i++) {
    g = ((g + (forward ? 1 : -1)) % 10 + 10) % 10;
    z = ((z + (forward ? 1 : -1)) % 12 + 12) % 12;
    list.push({ g: g, z: z, age: age + i * 10, year: startYear + i * 10,
      startSec: decadeSec(i), endSec: decadeSec(i + 1) });
  }
  return { forward, age, months, days, hours, startSec: start.getTime() / 1000,
    edgeSec: jieSec(y, n), edgeName: JIE_NAME[n], list };
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

/* 返回当年的实际农历月份；闰月紧随同名正月，避免把不存在的闰月当作普通月份。 */
export function lunarMonths(year) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return [];
  const months = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, isLeap: false, days: lMonthDays(year, month), name: L_MONTH[month - 1] + '月' });
    if (leapMonth(year) === month) months.push({ month, isLeap: true, days: leapDays(year), name: '闰' + L_MONTH[month - 1] + '月' });
  }
  return months;
}

/* 与 solar2lunar 共用同一离线表；返回公历年月日，非法农历日期返回 null。 */
export function lunar2solar(year, month, day, isLeap = false) {
  if (!Number.isInteger(day) || typeof isLeap !== 'boolean') return null;
  const months = lunarMonths(year);
  const index = months.findIndex((m) => m.month === month && m.isLeap === isLeap);
  if (index < 0 || day < 1 || day > months[index].days) return null;
  let days = day - 1;
  for (let y = 1900; y < year; y++) days += lYearDays(y);
  for (let i = 0; i < index; i++) days += months[i].days;
  const result = new Date(Date.UTC(1900, 0, 31) + days * 86400000);
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}

/* 覆盖 1900-01-31 至 2100-12-31，范围外返回 null（先判年份：Date.UTC 会把 0–99 年当成 19xx 年） */
export function solar2lunar(date) {
  const yy = date.getFullYear();
  if (!(yy >= 1900 && yy <= 2100)) return null;
  let offset = Math.floor((Date.UTC(yy, date.getMonth(), date.getDate()) - Date.UTC(1900, 0, 31)) / 86400000);
  if (offset < 0) return null;
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
