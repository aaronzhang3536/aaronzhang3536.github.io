import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, fourPillars, lunar2solar, solar2lunar, lunarMonths, wallSec, jieSec } from '../../src/scripts/shu/core.js';
import { buildChart, resolveBirth, annualMonths, annualRows, activePeriod, beijingNow,
  BaziInputError, ganzhi, twelveStage, chartReport } from '../../src/scripts/shu/bazi-model.js';
const input = { calendar: 'solar', date: '2000-01-01', time: '23:30', sex: 'male', dayBoundary: 'midnight' };

test('civil time does not shift in a device DST gap or skipped calendar day', () => {
  const initialTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia']) {
      process.env.TZ = tz;
      for (const s of ['2024-03-10', '2011-12-30', '1986-05-04']) {
        const birth = resolveBirth({ ...input, date: s, time: '02:30' });
        assert.equal(wallSec(birth), Date.parse(s + 'T02:30:00Z') / 1000, `${tz} ${s}`);
      }
    }
  } finally { if (initialTZ === undefined) delete process.env.TZ; else process.env.TZ = initialTZ; }
});
test('invalid dates and empty time are rejected instead of normalized or replaced with noon', () => {
  for (const patch of [{date:'2000-02-30'},{date:'1900-01-01'},{date:'2101-01-01'},
    {date:''},{time:''},{time:'24:00'},{time:'12:60'},{time:'12:00:99'},{sex:'invalid'},{dayBoundary:'invalid'}]) {
    assert.throws(() => buildChart({...input,...patch}), BaziInputError);
  }
  assert.equal(calendarDate(2001, 2, 29), null);
  assert.ok(calendarDate(2000, 2, 29));
  assert.ok(Number.isNaN(jieSec(2024.5, 1)));
});
test('lunar leap months are real calendar months, with strict day limits', () => {
  assert.deepEqual(lunar2solar(2023, 2, 1, true), { year:2023, month:3, day:22 });
  assert.deepEqual(lunar2solar(2020, 4, 1, true), { year:2020, month:5, day:23 });
  assert.equal(lunar2solar(2024, 2, 1, true), null);
  const month = lunarMonths(2023).find((m) => m.isLeap);
  assert.equal(lunar2solar(2023, month.month, month.days + 1, true), null);
  assert.equal(lunar2solar(2023, 1, 0), null);
  assert.deepEqual(lunarMonths(2101), []);
});
test('every supported solar date round-trips through the shared lunar table', () => {
  let days = 0;
  for (let ms = Date.UTC(1901, 0, 1); ms <= Date.UTC(2100, 11, 31); ms += 86400000) {
    const d = new Date(ms), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const l = solar2lunar(calendarDate(y, m, day));
    assert.deepEqual(lunar2solar(l.year, l.month, l.day, l.isLeap), {year:y,month:m,day}); days++;
  }
  assert.equal(days, 73049);
});
test('equivalent solar and lunar input give the same chart', () => {
  const solar = buildChart({...input,date:'2023-03-22',time:'10:30'});
  const lunar = buildChart({...input,calendar:'lunar',lunarYear:'2023',lunarMonth:'2',lunarDay:'1',isLeap:true,time:'10:30'});
  assert.deepEqual(solar.raw, lunar.raw);
  assert.deepEqual(solar.yun, lunar.yun);
  assert.throws(() => buildChart({...input,calendar:'lunar',lunarYear:'1900',lunarMonth:'1',lunarDay:'1',isLeap:false}), BaziInputError);
});
test('late Zi-hour convention changes the day and dependent relations, not year/month/hour', () => {
  const a = buildChart(input), b = buildChart({...input,dayBoundary:'zi'});
  assert.equal(ganzhi(a.raw.day), '戊午'); assert.equal(ganzhi(b.raw.day), '己未');
  assert.equal(ganzhi(a.raw.hour), '甲子'); assert.deepEqual(a.raw.hour, b.raw.hour);
  assert.deepEqual(a.raw.year, b.raw.year); assert.deepEqual(a.raw.month, b.raw.month);
  assert.notEqual(a.pillars[3].god, b.pillars[3].god);
  const morning = {...input,date:'2000-01-02',time:'00:30'};
  assert.deepEqual(buildChart(morning).raw, buildChart({...morning,dayBoundary:'zi'}).raw);
  assert.equal(ganzhi(buildChart({...input,date:'2100-12-31',dayBoundary:'zi'}).raw.day),'戊申');
});
test('Li Chun switches year/month at the stored instant; neighbouring minutes stay distinct', () => {
  const a = buildChart({...input,date:'2024-02-04',time:'16:27'});
  const b = buildChart({...input,date:'2024-02-04',time:'16:28'});
  assert.equal(ganzhi(a.raw.year),'癸卯'); assert.equal(ganzhi(b.raw.year),'甲辰');
  assert.equal(ganzhi(a.raw.month),'乙丑'); assert.equal(ganzhi(b.raw.month),'丙寅');
  assert.equal(ganzhi(fourPillars(calendarDate(2024,2,4,16,27,7)).year),'甲辰');
  assert.ok(a.warnings.some((w) => w.includes('立春')));
});
test('surface count is eight and hidden stems use a separate denominator', () => {
  const c = buildChart(input);
  assert.equal(Object.values(c.count).reduce((a,b)=>a+b),8);
  assert.equal(Object.values(c.hiddenCount).reduce((a,b)=>a+b),c.pillars.flatMap((p)=>p.hidden).length);
  assert.equal(twelveStage(0,11),'长生'); assert.equal(twelveStage(1,6),'长生');
  assert.equal(twelveStage(1,5),'沐浴'); assert.equal(twelveStage(0,3),'帝旺');
});
test('current major period uses exact handover instants, not only calendar year', () => {
  const c = buildChart(input), first = c.yun.list[0];
  assert.equal(activePeriod(c,first.startSec - 1),-1);
  assert.equal(activePeriod(c,first.startSec),0);
  assert.equal(activePeriod(c,first.endSec - 1),0);
  assert.equal(activePeriod(c,first.endSec),1);
  assert.equal(c.yun.list.at(-1).endSec > c.yun.list.at(-1).startSec,true);
  assert.equal(activePeriod(c,c.yun.list.at(-1).endSec),-1);
});
test('annual and monthly navigation follows Li Chun rather than Gregorian January', () => {
  const c = buildChart(input), years = annualRows(c,0), months = annualMonths(2024,c.dayGan);
  assert.equal(years.length,10); assert.equal(years[9].year - years[0].year,9);
  assert.equal(months.length,12); assert.equal(months[0].name,'立春');
  assert.equal(ganzhi(months[0].pair),'丙寅'); assert.equal(ganzhi(months[11].pair),'丁丑');
  assert.equal(months[11].sec,jieSec(2025,0));
  assert.deepEqual(annualMonths(2101,c.dayGan),[]);
  assert.deepEqual(annualRows(c,99),[]);
});
test('current time uses Beijing even on devices in another timezone', () => {
  assert.equal(beijingNow(new Date('2024-02-04T08:28:00Z')), Date.parse('2024-02-04T16:28:00Z') / 1000);
});
test('export states the selected rule, hidden stems, timing and count limitations', () => {
  const report = chartReport(buildChart(input));
  for (const phrase of ['戊午','00:00','藏干','北京时间','起运','不作为旺衰或喜用神判断']) assert.ok(report.includes(phrase),phrase);
  assert.equal(report.includes('undefined'),false); assert.equal(report.includes('NaN'),false);
});
