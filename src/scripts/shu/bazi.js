import { GAN, ZHI, GAN_WX, ZHI_WX, lunarMonths, solar2lunar, calendarDate } from './core.js';
import { ELEMENTS, BOUNDARY_LABELS, TEN_GOD_HELP, BaziInputError, buildChart, resolveBirth,
  annualRows, annualMonths, activePeriod, beijingNow, formatWall, ganzhi, chartReport } from './bazi-model.js';
const $ = (id) => document.getElementById(id);
const colors = { 木: 'wood', 火: 'fire', 土: 'earth', 金: 'metal', 水: 'water' };
const span = (text, element) => `<span class="bz-${colors[element]}">${text}</span>`;
const pair = ([g, z]) => span(GAN[g], GAN_WX[g]) + span(ZHI[z], ZHI_WX[z]);
let chart = null, periodIndex = 0, selectedYear = 0, wxMode = 'visible', isExample = false;
function readInput() {
  const [month, leap] = $('bz-lunar-month').value.split(':');
  return { calendar: $('bz-calendar').value, date: $('bz-date').value, time: $('bz-time').value,
    lunarYear: $('bz-lunar-year').value, lunarMonth: month, lunarDay: $('bz-lunar-day').value,
    isLeap: leap === '1', sex: $('bz-male').checked ? 'male' : 'female', dayBoundary: $('bz-boundary').value };
}
const option = (value, text) => new Option(text, value);
function updateLunarDays(preferred = $('bz-lunar-day').value) {
  const [month, leap] = $('bz-lunar-month').value.split(':');
  const item = lunarMonths(Number($('bz-lunar-year').value)).find((m) => m.month === Number(month) && m.isLeap === (leap === '1'));
  const select = $('bz-lunar-day'); select.replaceChildren(option('', '请选择'));
  if (item) for (let day = 1; day <= item.days; day++) select.add(option(String(day), `${day} 日`));
  select.value = [...select.options].some((o) => o.value === preferred) ? preferred : '';
}
function updateLunarMonths(preferred = $('bz-lunar-month').value, day = $('bz-lunar-day').value) {
  const select = $('bz-lunar-month'); select.replaceChildren(option('', '请选择'));
  for (const m of lunarMonths(Number($('bz-lunar-year').value))) select.add(option(`${m.month}:${Number(m.isLeap)}`, `${m.name} · ${m.days} 天`));
  select.value = [...select.options].some((o) => o.value === preferred) ? preferred : '';
  updateLunarDays(day);
}
function toggleCalendar(convert = true) {
  const lunar = $('bz-calendar').value === 'lunar';
  if (convert && lunar && $('bz-date').value) {
    const [y, m, d] = $('bz-date').value.split('-').map(Number), date = calendarDate(y, m, d);
    const value = date && solar2lunar(date);
    if (value) { $('bz-lunar-year').value = String(value.year); updateLunarMonths(`${value.month}:${Number(value.isLeap)}`, String(value.day)); }
  } else if (convert && !lunar) {
    try { const birth = resolveBirth({ ...readInput(), calendar: 'lunar', time: '00:00' }); $('bz-date').value = formatWall(+birth / 1000).slice(0, 10); } catch { /* Preserve the last valid date. */ }
  }
  $('bz-solar-input').hidden = lunar; $('bz-date').disabled = lunar;
  $('bz-lunar-input').hidden = !lunar; $('bz-lunar-input').disabled = !lunar;
}
function invalidate() {
  if (chart) $('bz-status').textContent = '出生信息已修改，请重新生成排盘。';
  chart = null; isExample = false; $('bz-out').hidden = true; $('bz-empty').hidden = false; $('bz-error').hidden = true;
  document.querySelectorAll('#bz-form [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
}
function renderElements() {
  const values = wxMode === 'hidden' ? chart.hiddenCount : chart.count;
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  $('bz-wuxing').innerHTML = ELEMENTS.map((wx) => `<div class="bz-element-row bz-${colors[wx]}"><span>${wx}</span><div class="bz-element-track" role="meter" aria-label="${wx}的出现次数" aria-valuenow="${values[wx]}" aria-valuemin="0" aria-valuemax="${total}"><i style="width:${values[wx] / total * 100}%"></i></div><b>${values[wx]}<small> / ${total}</small></b></div>`).join('');
  const absent = ELEMENTS.filter((wx) => !values[wx]);
  $('bz-wx-note').textContent = (wxMode === 'hidden' ? '只统计四个地支所藏天干，每次出现计 1，不加权。' : '四个天干与四个地支本身的五行，各计 1，共 8 个。') + (absent.length ? ` 本口径未出现：${absent.join('、')}。` : ' 本口径五行均有出现。');
  document.querySelectorAll('[data-wx-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wxMode === wxMode)));
}
function renderYear() {
  const year = annualRows(chart, periodIndex).find((row) => row.year === selectedYear); if (!year) return;
  document.querySelectorAll('[data-bz-year]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.bzYear) === selectedYear)));
  $('bz-year-title').textContent = `${year.year} ${ganzhi(year.pair)}年 · ${year.god} · ${year.nayin}`;
  const months = annualMonths(year.year, chart.dayGan);
  $('bz-year-note').textContent = months.length ? '十二节月 · 日期均为北京时间的交节时刻，最后一月小寒落在次年。' : '该流年超出 1901–2100 年节气表，仅显示年干支关系，不推算交节时刻。';
  $('bz-months').innerHTML = months.map((m) => `<div class="bz-month"><div><b>${pair(m.pair)}</b><span>${m.god}</span></div><span>${m.name}</span><time>${formatWall(m.sec, true)}</time></div>`).join('');
}
function renderPeriod() {
  const period = chart.yun.list[periodIndex];
  document.querySelectorAll('[data-bz-period]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.bzPeriod) === periodIndex)));
  $('bz-period-title').textContent = `第 ${periodIndex + 1} 步大运 · ${ganzhi([period.g, period.z])}`;
  $('bz-period-range').textContent = `${formatWall(period.startSec)} 起，至 ${formatWall(period.endSec)} 交下一运。`;
  const rows = annualRows(chart, periodIndex); if (!rows.some((r) => r.year === selectedYear)) selectedYear = rows[0].year;
  $('bz-years').innerHTML = rows.map((r) => `<button type="button" data-bz-year="${r.year}" aria-pressed="${r.year === selectedYear}"><span>${r.year}</span><b>${pair(r.pair)}</b><small>${r.god}</small></button>`).join('');
  renderYear();
}
function render() {
  const c = chart, yun = c.yun;
  $('bz-example-tag').hidden = !isExample;
  $('bz-result-title').textContent = `${c.dayName}${GAN_WX[c.dayGan]}日主 · ${c.input.sex === 'male' ? '乾造' : '坤造'}`;
  $('bz-birth-label').textContent = `公历 ${formatWall(c.birthSec)} · 北京时间`;
  $('bz-lunar-label').textContent = `农历 ${c.lunar.year}年${c.lunar.text} · ${BOUNDARY_LABELS[c.input.dayBoundary]}`;
  $('bz-facts').innerHTML = `<div><dt>年柱生肖 · 立春界</dt><dd>${c.zodiac}</dd></div><div><dt>日柱旬空</dt><dd>${c.kong.map((z) => ZHI[z]).join('')}</dd></div><div><dt>月令</dt><dd>${ZHI[c.raw.month[1]]}月</dd></div><div><dt>农历年生肖 · 春节界</dt><dd>${c.lunarZodiac}</dd></div>`;
  $('bz-warnings').replaceChildren(...c.warnings.map((message) => { const p = document.createElement('p'); p.textContent = message; return p; }));
  $('bz-warnings').hidden = !c.warnings.length;
  $('bz-pillars').innerHTML = c.pillars.map((p, i) => `<section class="bz-pillar-card${i === 2 ? ' bz-day-master' : ''}"><div class="bz-pillar-heading"><h3>${p.label}</h3>${p.isKong ? '<span title="按日柱所取旬空">旬空</span>' : ''}</div><p class="bz-god">${p.god}</p><div class="bz-pillar-characters">${pair([p.g, p.z])}</div><dl><div><dt>藏干 · 十神</dt><dd>${p.hidden.map((h, index) => `<span>${span(h.gan, h.wx)}<small>${h.god}${index === 0 ? ' · 本气' : ''}</small></span>`).join('')}</dd></div><div><dt>纳音</dt><dd>${p.nayin}</dd></div><div><dt>十二长生</dt><dd>${p.stage}</dd></div></dl></section>`).join('');
  renderElements();
  const fraction = Math.max(0, Math.min(100, (c.birthSec - c.previous.sec) / (c.next.sec - c.previous.sec) * 100));
  $('bz-terms').innerHTML = `<div class="bz-term-point"><span>上一节</span><b>${c.previous.name}</b><time>${formatWall(c.previous.sec, true)}</time></div><div class="bz-term-track" aria-hidden="true"><i style="left:${fraction}%"></i></div><p class="bz-small">出生时刻位于这两个节之间</p><div class="bz-term-point"><span>下一节</span><b>${c.next.name}</b><time>${formatWall(c.next.sec, true)}</time></div>`;
  $('bz-direction').textContent = `${yun.forward ? '顺行' : '逆行'}大运`;
  $('bz-yun-start').textContent = `出生后 ${yun.age} 年 ${yun.months} 个月 ${yun.days} 天 ${yun.hours} 小时起运 · ${formatWall(yun.startSec)}`;
  $('bz-yun-basis').textContent = `以${yun.forward ? '后一节' : '前一节'}「${yun.edgeName}」（${formatWall(yun.edgeSec, true)}）为依据，按分钟折算。`;
  const current = activePeriod(c), now = beijingNow();
  $('bz-current-period').textContent = current >= 0 ? `按当前北京时间，处于第 ${current + 1} 步大运。` : now < c.birthSec ? '出生日期晚于当前时间，以下为历法推演。' : now < yun.startSec ? '按当前北京时间，尚未交第一步大运。' : '当前时间已超出下列八步大运的展示区间。';
  $('bz-dayun').innerHTML = yun.list.map((d, i) => `<button type="button" data-bz-period="${i}" aria-pressed="${i === periodIndex}"><span>第 ${i + 1} 运${current === i ? ' · 当前' : ''}</span><b>${pair([d.g, d.z])}</b><small>${d.year} 起</small></button>`).join('');
  renderPeriod();
  $('bz-god-help').innerHTML = Object.entries(TEN_GOD_HELP).map(([god, text]) => `<div><b>${god}</b><span>${text}</span></div>`).join('');
  $('bz-empty').hidden = true; $('bz-out').hidden = false;
}
function run(event) {
  event?.preventDefault(); $('bz-error').hidden = true;
  document.querySelectorAll('#bz-form [aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  try {
    chart = buildChart(readInput()); periodIndex = Math.max(0, activePeriod(chart));
    selectedYear = new Date(beijingNow() * 1000).getUTCFullYear(); wxMode = 'visible'; render();
    $('bz-status').textContent = isExample ? '已生成示例排盘。示例出生时刻：2000-01-01 23:30。' : '排盘已更新。';
    $('bz-result-title').focus({ preventScroll: true });
    if (matchMedia('(max-width: 800px)').matches) $('bz-result-title').scrollIntoView({ block: 'start', behavior: 'instant' });
  } catch (error) {
    chart = null; $('bz-out').hidden = true; $('bz-empty').hidden = false;
    $('bz-error').textContent = error instanceof BaziInputError ? error.message : '本次排盘未完成，请检查输入后重试。';
    $('bz-error').hidden = false; $('bz-status').textContent = '';
    const field = $(error.field); if (field && !field.disabled && !field.closest('[hidden]')) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
}
function init() {
  if (!$('bz-form')) return;
  $('bz-form').addEventListener('submit', run);
  $('bz-form').addEventListener('input', invalidate); $('bz-form').addEventListener('change', invalidate);
  $('bz-calendar').addEventListener('change', () => toggleCalendar());
  $('bz-lunar-year').addEventListener('input', () => updateLunarMonths());
  $('bz-lunar-month').addEventListener('change', () => updateLunarDays());
  $('bz-form').addEventListener('reset', () => queueMicrotask(() => {
    invalidate(); toggleCalendar(false); updateLunarMonths('', ''); $('bz-status').textContent = '已清空出生信息。'; $('bz-date').focus();
  }));
  $('bz-demo').addEventListener('click', () => {
    $('bz-calendar').value = 'solar'; toggleCalendar(false); $('bz-date').value = '2000-01-01';
    $('bz-time').value = '23:30'; $('bz-male').checked = true; $('bz-boundary').value = 'midnight'; isExample = true; run();
  });
  document.querySelectorAll('[data-wx-mode]').forEach((button) => button.addEventListener('click', () => {
    if (!chart) return; wxMode = button.dataset.wxMode; renderElements();
  }));
  $('bz-dayun').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bz-period]'); if (!button || !chart) return;
    periodIndex = Number(button.dataset.bzPeriod); selectedYear = 0; renderPeriod(); $('bz-status').textContent = `已选择第 ${periodIndex + 1} 步大运。`;
  });
  $('bz-years').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bz-year]'); if (!button || !chart) return;
    selectedYear = Number(button.dataset.bzYear); renderYear(); $('bz-status').textContent = `已展开 ${selectedYear} 年流月。`;
  });
  $('bz-copy').addEventListener('click', async () => {
    if (!chart) return;
    try { await navigator.clipboard.writeText(chartReport(chart)); $('bz-status').textContent = '排盘文字已复制。'; }
    catch { $('bz-status').textContent = '浏览器未允许复制，可以使用“导出文本”保存结果。'; }
  });
  $('bz-download').addEventListener('click', () => {
    if (!chart) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + chartReport(chart)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `八字排盘-${formatWall(chart.birthSec).slice(0, 10)}.txt`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('bz-status').textContent = '已生成排盘文本，请查看浏览器下载。';
  });
}
init();
