/* 排盘数据层：严格输入、日历读数、统计与导出。无 DOM、存储或网络依赖。 */
import {
  GAN, ZHI, GAN_WX, ZHI_WX, SHENGXIAO, CANGGAN, JIE_NAME, YEAR_MIN, YEAR_MAX,
  calendarDate, fourPillars, daYun, solar2lunar, lunar2solar, jieSec, wallSec, shiShen, nayin,
} from './core.js';

export const ELEMENTS = ['木', '火', '土', '金', '水'];
export const PILLAR_NAMES = ['年柱', '月柱', '日柱', '时柱'];
export const BOUNDARY_LABELS = { midnight: '00:00 换日（晚子时日柱不换）', zi: '23:00 换日（子初换日）' };
export const TEN_GOD_HELP = {
  比肩: '与日干五行、阴阳都相同。', 劫财: '与日干五行相同、阴阳不同。',
  食神: '日干所生，且阴阳相同。', 伤官: '日干所生，且阴阳不同。',
  偏财: '日干所克，且阴阳相同。', 正财: '日干所克，且阴阳不同。',
  七杀: '克制日干，且阴阳相同。', 正官: '克制日干，且阴阳不同。',
  偏印: '生助日干，且阴阳相同。', 正印: '生助日干，且阴阳不同。',
};
const pad = (n) => String(n).padStart(2, '0');
const mod = (n, m) => ((n % m) + m) % m;
export const ganzhi = ([g, z]) => GAN[g] + ZHI[z];
export function formatWall(sec, seconds = false) {
  const date = new Date(sec * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${seconds ? ':' + pad(date.getUTCSeconds()) : ''}`;
}
export function beijingNow(now = new Date()) {
  return now.getTime() / 1000 + 8 * 3600;
}
export class BaziInputError extends Error {
  constructor(field, message) { super(message); this.field = field; }
}
const fail = (field, message) => { throw new BaziInputError(field, message); };

export function resolveBirth(input) {
  let year, month, day;
  if (input.calendar === 'lunar') {
    const converted = lunar2solar(Number(input.lunarYear), Number(input.lunarMonth), Number(input.lunarDay), input.isLeap === true);
    if (!converted) fail('bz-lunar-day', '这个农历日期不存在，请检查年份、闰月和日数。');
    ({ year, month, day } = converted);
  } else if (input.calendar === 'solar') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date || '');
    if (!parts) fail('bz-date', '请填写完整的公历出生日期。');
    [year, month, day] = parts.slice(1).map(Number);
  } else fail('bz-calendar', '请选择公历或农历。');
  if (year < YEAR_MIN || year > YEAR_MAX) fail(input.calendar === 'lunar' ? 'bz-lunar-year' : 'bz-date', `换算后的公历日期须在 ${YEAR_MIN}-01-01 至 ${YEAR_MAX}-12-31 之间。`);
  if (!calendarDate(year, month, day)) fail('bz-date', '这个公历日期不存在，请检查月份和日数。');
  const parts = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.time || '');
  if (!parts) fail('bz-time', '请填写出生时间，不会自动用中午代替。');
  const [, h, m, s = '0'] = parts;
  const date = calendarDate(year, month, day, Number(h), Number(m), Number(s));
  if (!date) fail('bz-time', '请输入有效时间（00:00:00–23:59:59）。');
  return date;
}

export function twelveStage(dayGan, branch) {
  const stages = ['长生', '沐浴', '冠带', '临官', '帝旺', '衰', '病', '死', '墓', '绝', '胎', '养'];
  const starts = [11, 6, 2, 9, 2, 9, 5, 0, 8, 3];
  return stages[mod((branch - starts[dayGan]) * (dayGan % 2 ? -1 : 1), 12)];
}

export function buildChart(input) {
  const birth = resolveBirth(input);
  if (!Object.hasOwn(BOUNDARY_LABELS, input.dayBoundary)) fail('bz-boundary', '请选择换日规则。');
  if (!['male', 'female'].includes(input.sex)) fail('bz-male', '请选择用于计算大运顺逆的性别。');
  const raw = fourPillars(birth, { dayBoundary: input.dayBoundary });
  const dayGan = raw.day[0], dayName = GAN[dayGan];
  let dayIndex = 0;
  while (dayIndex % 10 !== raw.day[0] || dayIndex % 12 !== raw.day[1]) dayIndex++;
  const base = dayIndex - dayIndex % 10;
  const kong = [(base + 10) % 12, (base + 11) % 12];
  const count = Object.fromEntries(ELEMENTS.map((wx) => [wx, 0]));
  const hiddenCount = { ...count };
  const pillars = [raw.year, raw.month, raw.day, raw.hour].map(([g, z], index) => {
    count[GAN_WX[g]]++; count[ZHI_WX[z]]++;
    const hidden = CANGGAN[ZHI[z]].map((gan) => {
      const wx = GAN_WX[GAN.indexOf(gan)];
      hiddenCount[wx]++;
      return { gan, wx, god: shiShen(dayName, gan) };
    });
    return { label: PILLAR_NAMES[index], g, z, god: index === 2 ? '日主' : shiShen(dayName, GAN[g]),
      hidden, nayin: nayin(g, z), stage: twelveStage(dayGan, z), isKong: kong.includes(z) };
  });
  const previous = { name: JIE_NAME[raw.jieIdx], sec: jieSec(raw.jieYear, raw.jieIdx) };
  const nextN = (raw.jieIdx + 1) % 12;
  const next = { name: JIE_NAME[nextN], sec: jieSec(raw.jieYear + (nextN === 0 ? 1 : 0), nextN) };
  const birthSec = wallSec(birth);
  const nearest = [previous, next].sort((a, b) => Math.abs(a.sec - birthSec) - Math.abs(b.sec - birthSec))[0];
  const gap = Math.abs(nearest.sec - birthSec);
  const warnings = [];
  if (gap < 7200) warnings.push(`出生时刻距「${nearest.name}」交节约 ${Math.floor(gap / 60)} 分 ${Math.round(gap % 60)} 秒。${nearest.name === '立春' ? '年柱和月柱' : '月柱'}会在 ${formatWall(nearest.sec, true)} 换柱，请核对出生记录。`);
  if (birth.getHours() === 23) warnings.push(`出生在晚子时，当前采用${BOUNDARY_LABELS[input.dayBoundary]}；切换规则会改变日柱及相应十神，时柱保持不变。`);
  const lunar = solar2lunar(birth);
  if (birth.getFullYear() === 2057 && birth.getMonth() >= 8 && birth.getMonth() <= 9) warnings.push('2057 年秋季农历在不同历表中可能相差一天；本页公农历互转统一使用本站离线农历表，四柱仍按公历和交节时刻计算。');
  return { input: { ...input }, birth, birthSec, raw, pillars, dayGan, dayName, kong,
    count, hiddenCount, lunar, previous, next, warnings,
    zodiac: SHENGXIAO[raw.year[1]], lunarZodiac: SHENGXIAO[mod(lunar.year - 1984, 12)],
    yun: daYun(birth, raw, input.sex === 'male') };
}

export function yearPillar(year) {
  const index = mod(year - 1984, 60);
  return [index % 10, index % 12];
}
export function annualRows(chart, index) {
  const period = chart.yun.list[index];
  if (!period) return [];
  return Array.from({ length: 10 }, (_, i) => {
    const year = period.year + i, pair = yearPillar(year);
    return { year, pair, god: shiShen(chart.dayName, GAN[pair[0]]), nayin: nayin(...pair) };
  });
}
export function annualMonths(year, dayGan) {
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return [];
  const yG = yearPillar(year)[0];
  return Array.from({ length: 12 }, (_, i) => {
    const jie = (i + 1) % 12, y = year + (i === 11 ? 1 : 0);
    const pair = [((yG % 5) * 2 + 2 + i) % 10, (i + 2) % 12];
    return { name: JIE_NAME[jie], sec: jieSec(y, jie), pair, god: shiShen(GAN[dayGan], GAN[pair[0]]) };
  });
}
export function activePeriod(chart, nowSec = beijingNow()) {
  return chart.yun.list.findIndex((item) => nowSec >= item.startSec && nowSec < item.endSec);
}
export function chartReport(chart) {
  const c = chart;
  return [
    '八字排盘 · 一帧之内',
    `公历：${formatWall(c.birthSec, true)}（北京时间 UTC+8，未做真太阳时 / 历史夏令时校正）`,
    `农历：${c.lunar.year}年${c.lunar.text}；${c.input.sex === 'male' ? '男' : '女'}`,
    `换日规则：${BOUNDARY_LABELS[c.input.dayBoundary]}`,
    `四柱：${c.pillars.map((p) => ganzhi([p.g, p.z])).join('　')}`,
    `日主：${c.dayName}${GAN_WX[c.dayGan]}；按日柱取旬空：${c.kong.map((z) => ZHI[z]).join('')}`,
    ...c.pillars.map((p) => `${p.label} ${ganzhi([p.g, p.z])} · ${p.god} · 藏干 ${p.hidden.map((h) => h.gan + '（' + h.god + '）').join('、')} · 纳音 ${p.nayin} · 十二长生 ${p.stage}`),
    `表层五行（共8字）：${ELEMENTS.map((e) => e + c.count[e]).join(' / ')}`,
    `藏干出现次数：${ELEMENTS.map((e) => e + c.hiddenCount[e]).join(' / ')}；与表层分开统计，不作为旺衰或喜用神判断。`,
    `交节区间：${c.previous.name} ${formatWall(c.previous.sec, true)} → ${c.next.name} ${formatWall(c.next.sec, true)}`,
    `大运${c.yun.forward ? '顺行' : '逆行'}；出生后 ${c.yun.age}年${c.yun.months}个月${c.yun.days}天${c.yun.hours}小时起运`,
    `起运：${formatWall(c.yun.startSec)}；按分钟折算，交运日为该规则下的推算值。`,
    ...c.yun.list.map((d, i) => `第${i + 1}运 ${ganzhi([d.g, d.z])}：${formatWall(d.startSec)} 至 ${formatWall(d.endSec)}（不含结束时刻）`),
    ...c.warnings,
    '仅供传统历法与文化研究。干支统计不能推断个人命运或替代现实决策。',
  ].join('\n');
}
