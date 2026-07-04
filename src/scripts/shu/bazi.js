/* 八字排盘：四柱 / 藏干 / 十神 / 纳音 / 五行 / 大运 */
import {
  GAN, ZHI, SHENGXIAO, GAN_WX, ZHI_WX, WX_COLOR, CANGGAN,
  shiShen, nayin, fourPillars, daYun, solar2lunar, JIE_NAME, jieDate,
} from './core.js';

function $(id) { return document.getElementById(id); }
function wxSpan(ch, wx) {
  return '<span style="color:var(' + (WX_COLOR[wx] || '--ink') + ');">' + ch + '</span>';
}

function pillarCard(label, g, z, riGan, isDay, isKong) {
  const gName = GAN[g], zName = ZHI[z];
  const ss = isDay ? '日主' : shiShen(riGan, gName);
  const cang = (CANGGAN[zName] || []).map((cg) =>
    wxSpan(cg, GAN_WX[GAN.indexOf(cg)]) + '<i>' + shiShen(riGan, cg) + '</i>'
  ).join('');
  return '<div class="bz-pillar">' +
    '<div class="bz-lab mono">' + label + (isKong ? '<em class="bz-kong">空</em>' : '') + '</div>' +
    '<div class="bz-ss mono">' + ss + '</div>' +
    '<div class="bz-gz">' + wxSpan(gName, GAN_WX[g]) + wxSpan(zName, ZHI_WX[z]) + '</div>' +
    '<div class="bz-cang mono">' + cang + '</div>' +
    '<div class="bz-ny mono">' + nayin(g, z) + '</div>' +
    '</div>';
}
function idx60(g, z) {
  for (let i = 0; i < 60; i++) if (i % 10 === g && i % 12 === z) return i;
  return 0;
}

function run() {
  const dv = $('bz-date').value, tv = $('bz-time').value || '12:00';
  if (!dv) return;
  const d = new Date(dv + 'T' + tv);
  if (isNaN(+d)) return;
  const isMale = $('bz-male').checked;
  const p = fourPillars(d);
  const riGan = GAN[p.day[0]];

  /* 旬空：以日柱所在旬定空亡二支 */
  const xunStart = idx60(p.day[0], p.day[1]);
  const base = xunStart - (xunStart % 10);
  const kong = [(base + 10) % 12, (base + 11) % 12];
  const isKong = (z) => kong.includes(z);

  /* 四柱 */
  $('bz-pillars').innerHTML =
    pillarCard('年柱', p.year[0], p.year[1], riGan, false, isKong(p.year[1])) +
    pillarCard('月柱', p.month[0], p.month[1], riGan, false, isKong(p.month[1])) +
    pillarCard('日柱', p.day[0], p.day[1], riGan, true, false) +
    pillarCard('时柱', p.hour[0], p.hour[1], riGan, false, isKong(p.hour[1]));

  /* 概要 + 流年 */
  const lunar = solar2lunar(d);
  const nowP = fourPillars(new Date());
  $('bz-summary').innerHTML =
    '生肖<b>' + SHENGXIAO[p.year[1]] + '</b> · 日主<b>' +
    wxSpan(riGan, GAN_WX[p.day[0]]) + '</b>（' + GAN_WX[p.day[0]] + '）' +
    (lunar ? ' · 农历 ' + lunar.year + ' 年' + lunar.text : '') +
    ' · 旬空<b>' + ZHI[kong[0]] + ZHI[kong[1]] + '</b>' +
    ' · 今年流年<b>' + wxSpan(GAN[nowP.year[0]], GAN_WX[nowP.year[0]]) +
    wxSpan(ZHI[nowP.year[1]], ZHI_WX[nowP.year[1]]) + '</b>（' +
    shiShen(riGan, GAN[nowP.year[0]]) + '）';

  /* 五行统计：天干 + 地支本气 + 藏干折半 */
  const count = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  [p.year, p.month, p.day, p.hour].forEach(([g, z]) => {
    count[GAN_WX[g]] += 1;
    count[ZHI_WX[z]] += 1;
  });
  const total = 8;
  $('bz-wuxing').innerHTML = Object.keys(count).map((wx) => {
    const n = count[wx];
    return '<div class="bz-wx-row mono">' +
      '<span style="color:var(' + WX_COLOR[wx] + ');">' + wx + '</span>' +
      '<div class="bar"><i style="width:' + (n / total * 100) + '%; background:var(' + WX_COLOR[wx] + ');"></i></div>' +
      '<span>' + n + '</span></div>';
  }).join('') +
    (Object.values(count).some((n) => n === 0)
      ? '<p class="mono miss">缺：' + Object.keys(count).filter((w) => !count[w]).join('、') + '</p>' : '');

  /* 日主旺衰（粗断）：同党 = 同我 + 生我 */
  const rw = GAN_WX[p.day[0]];
  const helper = { 木: ['木', '水'], 火: ['火', '木'], 土: ['土', '火'], 金: ['金', '土'], 水: ['水', '金'] }[rw];
  const same = helper.reduce((s, w) => s + count[w], 0);
  const verdict = same >= 5 ? '偏强' : same <= 3 ? '偏弱' : '中和';
  $('bz-strength').innerHTML =
    '日主同党（' + helper.join('、') + '）共 <b>' + same + '</b> / 8，粗断<b>' + verdict + '</b>' +
    '<span class="mono">（仅按干支本气计数的极简估法，未计月令权重与刑冲合会）</span>';

  /* 大运 */
  const dy = daYun(d, p, isMale);
  $('bz-dayun').innerHTML =
    '<p class="mono">' + (dy.forward ? '顺行' : '逆行') + ' · 约 ' + dy.age + ' 岁' +
    (dy.months ? dy.months + ' 个月' : '') + ' 起运</p>' +
    '<div class="bz-dy-strip">' +
    dy.list.map((it) =>
      '<div class="bz-dy mono"><b>' +
      wxSpan(GAN[it.g], GAN_WX[it.g]) + wxSpan(ZHI[it.z], ZHI_WX[it.z]) +
      '</b><span>' + shiShen(riGan, GAN[it.g]) + '</span><span>' + it.age + '岁</span><span>' + it.year + '</span></div>'
    ).join('') + '</div>';

  /* 节气边界提醒 */
  let warn = '';
  for (let n = 0; n < 12; n++) {
    const jd = jieDate(d.getFullYear(), n);
    if (Math.abs(d - jd) < 2 * 86400000) {
      warn = '出生日临近节气「' + JIE_NAME[n] + '」（本工具节气按日推算，可能有一天上下的误差），' +
        '月柱与年柱若跨节请以精确到时刻的万年历为准。';
      break;
    }
  }
  $('bz-warn').textContent = warn;
  $('bz-warn').hidden = !warn;

  $('bz-out').hidden = false;
}

function init() {
  if (!$('bz-date')) return;
  $('bz-go').addEventListener('click', run);
}
init();
