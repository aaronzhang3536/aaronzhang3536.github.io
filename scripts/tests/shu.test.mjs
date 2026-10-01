/* 术数核心库（src/scripts/shu/core.js）回归测试：零依赖，`node scripts/tests/shu.test.mjs`。
   参考数据离线由 lunar-javascript 1.7.7（寿星天文历算法，八字取 sect 2 = 晚子时日柱不换）生成后内嵌：
   大批量扫描只内嵌 FNV-1a 哈希（参考值序列的哈希），另附可读的逐条样例，失败时便于定位。 */
import {
  GAN, ZHI, JIE_NAME, YEAR_MIN, YEAR_MAX,
  jieSec, wallSec, inRange, fourPillars, daYun, solar2lunar,
} from '../../src/scripts/shu/core.js';

process.env.TZ = 'UTC';   /* 大批量扫描用 UTC 构造日期，避开本机夏令时里不存在的时刻 */

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
}
function fnv() {
  let h = 0x811c9dc5;
  return { add(v) { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; }, get v() { return h; } };
}
const gz = (p) => GAN[p[0]] + ZHI[p[1]];
const pad = (v) => (v < 10 ? '0' : '') + v;
function wallText(sec) {
  const d = new Date(sec * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}
function parse(s) {
  const [a, b] = s.split(' ');
  const [y, m, d] = a.split('-').map(Number);
  const [h, mi] = (b || '12:00').split(':').map(Number);
  return { y, m, d, h, mi };
}

/* ---------- 参考数据（lunar-javascript 离线生成） ---------- */
const REF = {
  jieHash: 1869690442,                       /* 1900–2101 全部 2424 个节的秒级时刻 */
  hourHash: 3742768061, hourCount: 1753176,  /* 1901–2100 每小时 :30 的四柱 */
  edgeHash: 2681873469, edgeCount: 4800,     /* 1901–2100 每个节前一分钟 / 交节那一分钟的年柱月柱 */
  yunSeed: 20261001, yunCount: 5000, yunHash: 2542305783,   /* 随机出生时刻的大运（方向/起运年月/首运年份/首运干支） */
  lunarHash: 116138665, lunarCount: 73019,   /* 1901–2100 逐日农历（除 2057 年八月，见下） */
};
/* 寿星公式曾在这些年份差一天的节，以及常用核对点（北京时间） */
const JIE_SPOTS = [
  [2024, 1, '2024-02-04 16:27:07'],
  [2000, 1, '2000-02-04 20:40:24'],
  [1984, 1, '1984-02-04 23:18:44'],
  [1973, 2, '1973-03-06 01:12:36'],
  [1977, 2, '1977-03-06 00:44:09'],
  [1981, 2, '1981-03-06 00:05:07'],
  [1982, 0, '1982-01-06 00:02:35'],
  [2019, 0, '2019-01-05 23:38:58'],
  [2002, 7, '2002-08-08 00:39:18'],
  [2016, 6, '2016-07-07 00:03:21'],
  [1914, 1, '1914-02-04 23:29:16'],
  [1947, 1, '1947-02-04 23:50:21'],
  [1900, 0, '1900-01-06 02:03:57'],
  [2101, 11, '2101-12-07 15:34:50'],
];
/* 四柱：晚子时（23 点）日柱不换、时干按次日起子时；交节前后一分钟 */
const PILLAR_SPOTS = [
  ['2000-01-01 23:30', '己卯 丙子 戊午 甲子'],
  ['2000-01-02 00:30', '己卯 丙子 己未 甲子'],
  ['1990-01-02 12:00', '己巳 丙子 丁卯 丙午'],
  ['2000-01-03 12:00', '己卯 丙子 庚申 壬午'],
  ['1980-01-03 22:00', '己未 丙子 乙亥 丁亥'],
  ['2024-02-04 16:27', '癸卯 乙丑 戊戌 庚申'],
  ['2024-02-04 16:28', '甲辰 丙寅 戊戌 庚申'],
  ['1999-12-31 23:59', '己卯 丙子 丁巳 壬子'],
  ['2100-12-31 23:00', '庚申 戊子 丁未 壬子'],
  ['1901-01-01 00:00', '庚子 戊子 己卯 甲子'],
  ['2020-06-15 11:00', '庚子 壬午 己丑 庚午'],
  ['1973-03-06 01:12', '癸丑 甲寅 辛丑 己丑'],
  ['1973-03-06 01:13', '癸丑 乙卯 辛丑 己丑'],
  ['1977-03-06 00:44', '丁巳 壬寅 壬戌 庚子'],
  ['1977-03-06 00:45', '丁巳 癸卯 壬戌 庚子'],
  ['1981-03-06 00:05', '辛酉 庚寅 癸未 壬子'],
  ['1981-03-06 00:06', '辛酉 辛卯 癸未 壬子'],
  ['1982-01-06 00:02', '辛酉 庚子 己丑 甲子'],
  ['1982-01-06 00:03', '辛酉 辛丑 己丑 甲子'],
  ['2019-01-05 23:38', '戊戌 甲子 壬寅 壬子'],
  ['2019-01-05 23:39', '戊戌 乙丑 壬寅 壬子'],
  ['2002-08-08 00:39', '壬午 丁未 戊申 壬子'],
  ['2002-08-08 00:40', '壬午 戊申 戊申 壬子'],
  ['2016-07-07 00:03', '丙申 甲午 庚寅 丙子'],
  ['2016-07-07 00:04', '丙申 乙未 庚寅 丙子'],
  ['1914-02-04 23:29', '癸丑 乙丑 辛酉 庚子'],
  ['1914-02-04 23:30', '甲寅 丙寅 辛酉 庚子'],
  ['1947-02-04 23:50', '丙戌 辛丑 甲寅 丙子'],
  ['1947-02-04 23:51', '丁亥 壬寅 甲寅 丙子'],
];
/* 大运：[出生, 男=1, '方向 起运年 起运月 首运公历年 首运干支']（lunar-javascript getYun(sex, 2)） */
const YUN_SPOTS = [
  ['2000-01-03 12:00', 0, '顺 0 11 2000 丁丑'],
  ['1990-01-02 12:00', 0, '顺 1 1 1991 丁丑'],
  ['1990-01-02 12:00', 1, '逆 8 8 1998 乙亥'],
  ['1980-01-03 22:00', 1, '逆 8 11 1988 乙亥'],
  ['1985-06-15 12:00', 1, '逆 3 1 1988 辛巳'],
  ['1996-02-29 08:00', 1, '顺 1 9 1997 辛卯'],
  ['2100-12-20 10:00', 0, '逆 4 4 2105 丁亥'],
];
const LUNAR_SPOTS = [
  ['1901-01-01', '1900 11 11'],
  ['1949-10-01', '1949 8 10'],
  ['2000-02-05', '2000 1 1'],
  ['2020-05-23', '2020 闰4 1'],
  ['2023-03-22', '2023 闰2 1'],
  ['2033-12-22', '2033 闰11 1'],
  ['2100-12-31', '2100 12 1'],
];

const t0 = Date.now();

/* ---------- 1. 节气表 ---------- */
{
  const H = fnv();
  for (let y = 1900; y <= 2101; y++) {
    for (let n = 0; n < 12; n++) { const s = jieSec(y, n); H.add(s % 1e9); H.add(Math.floor(s / 1e9)); }
  }
  check('节气表 1900–2101 全表哈希', H.v === REF.jieHash, 'got ' + H.v);
  JIE_SPOTS.forEach(([y, n, want]) => {
    const got = wallText(jieSec(y, n));
    check('节气 ' + y + JIE_NAME[n], got === want, got + ' ≠ ' + want);
  });
  check('节气表范围外返回 NaN', Number.isNaN(jieSec(1899, 11)) && Number.isNaN(jieSec(2102, 0)));
  let mono = true;
  for (let y = 1900; y <= 2101 && mono; y++) for (let n = 1; n < 12; n++) if (!(jieSec(y, n) > jieSec(y, n - 1))) mono = false;
  check('节气时刻逐年单调递增', mono);
}

/* ---------- 2. 四柱 ---------- */
{
  const H = fnv(); let n = 0;
  for (let t = Date.UTC(1901, 0, 1); t <= Date.UTC(2100, 11, 31, 23); t += 3600000) {
    const u = new Date(t);
    const p = fourPillars(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), 30));
    [p.year, p.month, p.day, p.hour].forEach((x) => { H.add(x[0]); H.add(x[1]); });
    n++;
  }
  check('四柱逐小时扫描 1901–2100（' + n + ' 个时刻）', n === REF.hourCount && H.v === REF.hourHash, 'got ' + H.v);

  const E = fnv(); let m = 0;
  for (let y = YEAR_MIN; y <= YEAR_MAX; y++) {
    for (let j = 0; j < 12; j++) {
      const cm = Math.ceil(jieSec(y, j) / 60);
      [cm - 1, cm].forEach((M) => {
        const w = new Date(M * 60000);
        const p = fourPillars(new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes()));
        E.add(p.year[0]); E.add(p.year[1]); E.add(p.month[0]); E.add(p.month[1]);
        m++;
      });
    }
  }
  check('交节前后一分钟的年柱/月柱（' + m + ' 个时刻）', m === REF.edgeCount && E.v === REF.edgeHash, 'got ' + E.v);

  /* 结果只取决于输入的挂钟读数，与浏览器所在时区无关（跳过该时区夏令时里不存在的时刻） */
  ['UTC', 'Asia/Shanghai', 'America/New_York', 'Australia/Lord_Howe'].forEach((tz) => {
    process.env.TZ = tz;
    PILLAR_SPOTS.forEach(([s, want]) => {
      const q = parse(s);
      const d = new Date(q.y, q.m - 1, q.d, q.h, q.mi);
      if (d.getHours() !== q.h || d.getMinutes() !== q.mi) return;
      const p = fourPillars(d);
      const got = [p.year, p.month, p.day, p.hour].map(gz).join(' ');
      check('四柱 ' + s + ' @' + tz, got === want, got + ' ≠ ' + want);
    });
  });
  process.env.TZ = 'UTC';

  check('年份越界返回 null', fourPillars(new Date(1900, 5, 1)) === null && fourPillars(new Date(2101, 0, 1)) === null &&
    fourPillars(new Date('0050-06-01T12:00')) === null);
  check('inRange 边界', inRange(new Date(1901, 0, 1)) && inRange(new Date(2100, 11, 31, 23, 59)) &&
    !inRange(new Date(1900, 11, 31, 23, 59)) && !inRange(new Date(2101, 0, 1)));
  check('wallSec 只看挂钟读数', wallSec(new Date(2024, 1, 4, 16, 27)) === Date.UTC(2024, 1, 4, 16, 27) / 1000);
}

/* ---------- 3. 大运 ---------- */
{
  let seed = REF.yunSeed;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const lo = Date.UTC(1901, 0, 1) / 60000, hi = Date.UTC(2100, 11, 31, 23, 59) / 60000;
  const H = fnv(); let sane = true;
  for (let k = 0; k < REF.yunCount; k++) {
    const M = Math.floor(lo + rnd() * (hi - lo)); const male = rnd() < 0.5;
    const w = new Date(M * 60000);
    const dt = new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes());
    const dy = daYun(dt, fourPillars(dt), male);
    [dy.forward ? 1 : 0, dy.age, dy.months, dy.list[0].year, dy.list[0].g, dy.list[0].z].forEach((v) => H.add(v));
    if (!(dy.age >= 0 && dy.age <= 11 && dy.months >= 0 && dy.months <= 11)) sane = false;
  }
  check('大运随机 ' + REF.yunCount + ' 例（起运年/月、首运年份与干支）', H.v === REF.yunHash, 'got ' + H.v);
  check('起运岁数 0–11、月数 0–11（不再出现 122 岁 / 12 个月）', sane);
  YUN_SPOTS.forEach(([s, male, want]) => {
    const q = parse(s);
    const dt = new Date(q.y, q.m - 1, q.d, q.h, q.mi);
    const dy = daYun(dt, fourPillars(dt), !!male);
    const got = (dy.forward ? '顺' : '逆') + ' ' + dy.age + ' ' + dy.months + ' ' + dy.list[0].year + ' ' + GAN[dy.list[0].g] + ZHI[dy.list[0].z];
    check('大运 ' + s + (male ? ' 男' : ' 女'), got === want, got + ' ≠ ' + want);
  });
}

/* ---------- 4. 农历 ---------- */
{
  const H = fnv(); let n = 0;
  for (let t = Date.UTC(1901, 0, 1); t <= Date.UTC(2100, 11, 31); t += 86400000) {
    /* 2057-09-29 00:00:25 合朔，紧贴子夜：寿星历把八月记为大月，本库的香港天文台系农历表记为小月，单独断言 */
    if (t >= Date.UTC(2057, 8, 28) && t <= Date.UTC(2057, 9, 27)) continue;
    const u = new Date(t);
    const l = solar2lunar(new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12));
    [l.year, l.month, l.day, l.isLeap ? 1 : 0].forEach((v) => H.add(v));
    n++;
  }
  check('农历逐日 1901–2100（' + n + ' 天）', n === REF.lunarCount && H.v === REF.lunarHash, 'got ' + H.v);
  LUNAR_SPOTS.forEach(([s, want]) => {
    const q = parse(s);
    const l = solar2lunar(new Date(q.y, q.m - 1, q.d, 12));
    const got = l.year + ' ' + (l.isLeap ? '闰' : '') + l.month + ' ' + l.day;
    check('农历 ' + s, got === want, got + ' ≠ ' + want);
  });
  const l57 = solar2lunar(new Date(2057, 8, 28, 12));
  check('农历 2057-09-28 = 九月初一（沿用农历表）', l57 && l57.month === 9 && l57.day === 1 && !l57.isLeap);
  check('农历越界返回 null', solar2lunar(new Date(1900, 0, 30)) === null && solar2lunar(new Date(2101, 0, 30)) === null &&
    solar2lunar(new Date('0050-06-01T12:00')) === null && solar2lunar(new Date('1850-06-01T12:00')) === null);
  const first = solar2lunar(new Date(1900, 0, 31, 12));
  check('农历表起点 1900-01-31 = 正月初一', first && first.year === 1900 && first.month === 1 && first.day === 1);
}

console.log('shu.test: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
if (fail) process.exitCode = 1;
