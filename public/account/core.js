(function (root) {
  'use strict';
  const langs = '(en|ja|ko|fr|de|es|it|ru)';
  const scores = /^(yzzn-(fish|arc-coins|arcade-hi|uke-ear)|yzzn-arc-(snake|tetris|breakout|invaders|asteroids|flappy|dino|bug|typer|tex2048|nback|simon|overfit|frustum|rhythm(?:-(easy|hard|hell))?|mines|slide15|maze|memory|grad|reaction|tuner|jig(?:[2-9]|1[0-9]|20)))$/;
  const special = new Set(['wof:bookmarks', 'wof:browse-mode', 'wof:reading-size', 'yzzn-uke-rhythm', 'yzzn-uke-plan', 'yzzn-xlr-history', 'yzzn-gy-history', 'babel-manual', 'yzzn-theme', 'yzzn-bg', 'yzzn-wx', 'yzzn-snd', 'yzzn-music', 'yzzn-arc-rhythm-diff', 'yzzn-sync-meta']);
  const language = new RegExp('^yzzn-' + langs + '-(words|stats|daily|dojo|game)$');
  function syncKey(key) { return typeof key === 'string' && (language.test(key) || scores.test(key) || special.has(key)); }
  function privateKey(key) { return new RegExp('^yzzn-' + langs + '-cfg$').test(key) || /^yzzn-en-(ai|dict)$/.test(key); }
  function same(a, b) { return (a ?? null) === (b ?? null); }
  function merge(base, local, remote) {
    const values = {}, conflicts = [];
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (!syncKey(key)) continue;
      const b = base[key] ?? null, l = local[key] ?? null, r = remote[key] ?? null;
      if (same(l, b)) values[key] = r;
      else if (same(r, b) || same(l, r)) values[key] = l;
      else { values[key] = l; conflicts.push(key); }
    }
    return { values, conflicts };
  }
  function cloudValues(values) { return Object.fromEntries(Object.entries(values).filter(([k]) => syncKey(k))); }
  function empty() { return { values: {}, base: {}, version: 0, pending: null, lastSync: 0 }; }
  function label(key) {
    const match = /^yzzn-(en|ja|ko|fr|de|es|it|ru)-(words|stats|daily|dojo|game)$/.exec(key);
    if (match) return ({ en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', it: '意大利语', ru: '俄语' })[match[1]] + ' · ' + ({ words: '生词与复习进度', stats: '复习统计', daily: '每日学习记录', dojo: '道场练习', game: '闯关进度' })[match[2]];
    const names = { 'wof:bookmarks': '文章收藏', 'wof:browse-mode': '文章列表样式', 'wof:reading-size': '阅读字号', 'yzzn-uke-rhythm': '尤克里里节奏成绩', 'yzzn-uke-plan': '尤克里里练习计划', 'yzzn-uke-ear': '和弦听辨纪录', 'yzzn-xlr-history': '小六壬历史', 'yzzn-gy-history': '观音神课历史', 'babel-manual': '巴别塔生词手册', 'yzzn-theme': '主题偏好', 'yzzn-bg': '背景偏好', 'yzzn-wx': '天气效果', 'yzzn-snd': '环境音偏好', 'yzzn-music': '音乐频道与音量', 'yzzn-arc-rhythm-diff': '节奏机难度', 'yzzn-sync-meta': '学习删除与重置记录', 'yzzn-fish': '摸鱼次数', 'yzzn-arc-coins': '游戏厅游玩次数', 'yzzn-arcade-hi': '能量收集站纪录' };
    if (names[key]) return names[key];
    const game = key.replace('yzzn-arc-', '');
    const gameNames = { snake: '贪吃蛇', tetris: '俄罗斯方块', breakout: '打砖块', invaders: '太空入侵', asteroids: '小行星', flappy: '飞鸟', dino: '奔跑', bug: '捉虫', typer: '打字', tex2048: '2048', nback: '工作记忆', simon: '序列记忆', overfit: '拟合挑战', frustum: '视锥挑战', rhythm: '节奏机', mines: '扫雷', slide15: '数字滑块', maze: '迷宫', memory: '配对记忆', grad: '梯度挑战', reaction: '反应测试', tuner: '调音挑战' };
    if (/^jig\d+$/.test(game)) return '拼图 ' + game.slice(3) + ' × ' + game.slice(3) + ' 纪录';
    if (game.startsWith('rhythm-')) return '节奏机 · ' + ({ easy: '简单', hard: '困难', hell: '极限' })[game.slice(7)] + '纪录';
    return (gameNames[game] || '游戏') + '纪录';
  }
  root.WOFCore = Object.freeze({ syncKey, privateKey, merge, cloudValues, same, empty, label });
})(globalThis);
