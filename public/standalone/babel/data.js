/* 巴别塔 · Tower of Babel —— 数据层：词库 / 卡牌 / 圣物 / 敌人 / Buff
   全局命名空间 G，供 game.js / ui.js 共享。用英语考纲词库作为卡牌词汇。 */
window.G = window.G || {};
(function (G) {
  'use strict';

  /* ---------- 工具 ---------- */
  G.rnd = function (n) { return Math.floor(Math.random() * n); };
  G.pick = function (a) { return a[G.rnd(a.length)]; };
  G.shuffle = function (a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = G.rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  G.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  G.uid = (function () { var n = 0; return function () { return 'u' + (++n); }; })();

  /* ---------- 词库加载：合并多考纲，按词频给出难度分层 ---------- */
  G.words = [];        /* [{w, ipa, cn, pos, tier}] */
  G.wordByKey = {};
  G.wordTiers = [[], [], [], [], [], [], [], []];

  /* 加载构建期瘦身的合并词包（8 档各高频前 450 词，已算好简短中文+词性，
     ~170KB 一个请求，取代原先 8 文件 3.5MB —— 秒开） */
  G.loadWords = function () {
    return fetch('/data/babel-words.json').then(function (r) { return r.json(); }).then(function (pack) {
      (pack.tiers || []).forEach(function (bucket, ti) {
        bucket.forEach(function (e) {
          var rec = { w: e[0], ipa: e[1] || '', cn: e[2] || '', pos: e[3] || 'noun', tier: ti };
          G.words.push(rec);
          G.wordByKey[e[0].toLowerCase()] = rec;
          G.wordTiers[ti].push(rec);
        });
      });
      return G.words.length;
    }).catch(function () { return 0; });
  };

  /* 按塔层深度抽一个词：越高层越难 */
  G.drawWord = function (depth) {
    var lo = Math.min(7, Math.floor(depth / 3));
    var hi = Math.min(7, lo + 2);
    for (var t = 0; t < 24; t++) {
      var tier = lo + G.rnd(hi - lo + 1);
      var bucket = G.wordTiers[tier];
      if (bucket && bucket.length) return G.pick(bucket);
    }
    return G.pick(G.words);
  };
  G.distractorsCn = function (correct, n) {
    var out = [], guard = 0;
    while (out.length < n && guard++ < 200) {
      var r = G.pick(G.words);
      if (r.cn && r.cn !== correct && out.indexOf(r.cn) < 0) out.push(r.cn);
    }
    return out;
  };

  /* ---------- 英语构词：复数 / 过去式（规则法 + 不规则表，用于篝火复习测验） ---------- */
  var IRREG_PLURAL = { man: 'men', woman: 'women', child: 'children', foot: 'feet', tooth: 'teeth', goose: 'geese', mouse: 'mice', person: 'people', ox: 'oxen', datum: 'data', sheep: 'sheep', fish: 'fish', deer: 'deer' };
  var IRREG_PAST = { be: 'was', go: 'went', do: 'did', have: 'had', make: 'made', take: 'took', come: 'came', see: 'saw', get: 'got', give: 'gave', find: 'found', think: 'thought', know: 'knew', say: 'said', tell: 'told', become: 'became', leave: 'left', feel: 'felt', bring: 'brought', begin: 'began', keep: 'kept', hold: 'held', write: 'wrote', stand: 'stood', hear: 'heard', let: 'let', mean: 'meant', set: 'set', meet: 'met', run: 'ran', pay: 'paid', sit: 'sat', speak: 'spoke', lie: 'lay', lead: 'led', read: 'read', grow: 'grew', lose: 'lost', fall: 'fell', send: 'sent', build: 'built', understand: 'understood', draw: 'drew', break: 'broke', spend: 'spent', cut: 'cut', rise: 'rose', drive: 'drove', buy: 'bought', wear: 'wore', choose: 'chose', seek: 'sought', throw: 'threw', catch: 'caught', deal: 'dealt', win: 'won', forget: 'forgot', teach: 'taught', fight: 'fought', put: 'put' };
  var VOWEL = 'aeiou';
  G.pluralize = function (w) {
    var lw = w.toLowerCase();
    if (IRREG_PLURAL[lw]) return IRREG_PLURAL[lw];
    if (/(s|x|z|ch|sh)$/.test(lw)) return w + 'es';
    if (/[^aeiou]y$/.test(lw)) return w.slice(0, -1) + 'ies';
    if (/(f)$/.test(lw)) return w.slice(0, -1) + 'ves';
    if (/fe$/.test(lw)) return w.slice(0, -2) + 'ves';
    if (/[^aeiou]o$/.test(lw)) return w + 'es';
    return w + 's';
  };
  G.pastTense = function (w) {
    var lw = w.toLowerCase();
    if (IRREG_PAST[lw]) return IRREG_PAST[lw];
    if (/e$/.test(lw)) return w + 'd';
    if (/[^aeiou]y$/.test(lw)) return w.slice(0, -1) + 'ied';
    /* 单音节 CVC 结尾双写：stop→stopped */
    if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(lw)) return w + lw.slice(-1) + 'ed';
    return w + 'ed';
  };
  G.comparative = function (w) {
    var lw = w.toLowerCase();
    if (/e$/.test(lw)) return w + 'r';
    if (/[^aeiou]y$/.test(lw)) return w.slice(0, -1) + 'ier';
    if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(lw)) return w + lw.slice(-1) + 'er';
    return w + 'er';
  };
  /* 生成一道构词多选题：{q, correct, opts[]} —— 多选避免自由输入判错的老 bug */
  G.formQuiz = function (rec) {
    var base = rec.w, correct, label, wrongs;
    if (rec.pos === 'verb') {
      correct = G.pastTense(base); label = '过去式';
      wrongs = [base + 'ed', base + 'd', base + 's', base + (base.slice(-1)) + 'ed'];
    } else if (rec.pos === 'adj') {
      correct = G.comparative(base); label = '比较级';
      wrongs = [base + 'er', base + 'est', base + 'r', base.slice(0, -1) + 'ier'];
    } else {
      correct = G.pluralize(base); label = '复数';
      wrongs = [base + 's', base + 'es', base + (/y$/.test(base) ? base.slice(0, -1) + 'ies' : 'ies'), base.slice(0, -1) + 'ves'];
    }
    var opts = [correct];
    wrongs.forEach(function (x) { if (x !== correct && opts.indexOf(x) < 0 && opts.length < 4) opts.push(x); });
    while (opts.length < 4) { var f = base + G.pick(['en', 'er', 'ing']); if (opts.indexOf(f) < 0) opts.push(f); }
    return { q: base, label: label, correct: correct, opts: G.shuffle(opts) };
  };

  /* ---------- Buff / 状态定义 ---------- */
  G.BUFFS = {
    str:  { name: '力量', desc: '攻击伤害 +X', icon: '💪', good: true },
    dex:  { name: '敏捷', desc: '获得格挡 +X', icon: '🌀', good: true },
    vuln: { name: '易伤', desc: '受到攻击伤害 +50%（每回合 -1）', icon: '🩸', good: false, decay: true },
    weak: { name: '虚弱', desc: '造成攻击伤害 -25%（每回合 -1）', icon: '💫', good: false, decay: true },
    frail:{ name: '脆弱', desc: '获得格挡 -25%（每回合 -1）', icon: '🥀', good: false, decay: true },
    regen:{ name: '再生', desc: '回合结束回复 X 血（每回合 -1）', icon: '💚', good: true, decay: true },
    poison:{ name: '中毒', desc: '回合开始扣 X 血并 -1', icon: '☠', good: false },
    thorns:{ name: '荆棘', desc: '被攻击时反弹 X 伤害', icon: '🌵', good: true },
    barr: { name: '壁垒', desc: '回合开始不清空格挡', icon: '🛡', good: true },
    intan:{ name: '虚无化', desc: '本回合受到伤害降为 1（每回合 -1）', icon: '👻', good: true, decay: true },
    meta: { name: '新陈代谢', desc: '回合结束获得 X 格挡', icon: '⚙', good: true },
  };

  /* ---------- 卡牌定义池 ----------
     card: { id, base(词汇), name(词汇=英文), type, cost, rarity, kw[], eff{}, up1{}, up2{} }
     eff 字段: dmg 伤害 / blk 格挡 / hits 连击 / draw 抽牌 / energy 充能 /
               applies[{buff, amt, self?}] / aoe 群体 / heal / exhaustGain 等
     up1 弱强化（+1~2 小提升），up2 强强化（减费或效果跃升）。名词/词性来自绑定的词。 */
  G.CARD_DEFS = [
    /* —— 起始卡（不进抽卡池） —— */
    { id: 'strike', ch: '打击', type: 'attack', cost: 1, rarity: 'start', eff: { dmg: 6 }, up1: { dmg: 9 }, up2: { dmg: 12 }, starter: true },
    { id: 'defend', ch: '防御', type: 'skill', cost: 1, rarity: 'start', eff: { blk: 5 }, up1: { blk: 8 }, up2: { blk: 11 }, starter: true },
    { id: 'bash',   ch: '痛击', type: 'attack', cost: 2, rarity: 'start', eff: { dmg: 8, applies: [{ buff: 'vuln', amt: 2 }] }, up1: { dmg: 10, applies: [{ buff: 'vuln', amt: 3 }] }, up2: { dmg: 12, applies: [{ buff: 'vuln', amt: 3 }] }, starter: true },

    /* —— 普通（白） —— */
    { id: 'cleave',  ch: '横扫', type: 'attack', cost: 1, rarity: 'common', eff: { dmg: 8, aoe: true }, up1: { dmg: 11, aoe: true }, up2: { dmg: 14, aoe: true } },
    { id: 'ironwave',ch: '铁浪', type: 'attack', cost: 1, rarity: 'common', eff: { dmg: 5, blk: 5 }, up1: { dmg: 7, blk: 7 }, up2: { dmg: 9, blk: 9 } },
    { id: 'pommel',  ch: '劈砍', type: 'attack', cost: 1, rarity: 'common', eff: { dmg: 9, draw: 1 }, up1: { dmg: 10, draw: 2 }, up2: { dmg: 13, draw: 2 } },
    { id: 'clothesline', ch: '铁臂', type: 'attack', cost: 2, rarity: 'common', eff: { dmg: 12, applies: [{ buff: 'weak', amt: 2 }] }, up1: { dmg: 14, applies: [{ buff: 'weak', amt: 3 }] }, up2: { dmg: 16, applies: [{ buff: 'weak', amt: 3 }] } },
    { id: 'thunder', ch: '雷击', type: 'attack', cost: 1, rarity: 'common', eff: { dmg: 4, hits: 2 }, up1: { dmg: 4, hits: 3 }, up2: { dmg: 6, hits: 3 } },
    { id: 'shrug',   ch: '耸肩', type: 'skill', cost: 1, rarity: 'common', eff: { blk: 8, applies: [{ buff: 'regen', amt: 0 }] }, up1: { blk: 11 }, up2: { blk: 14 } },
    { id: 'flex',    ch: '屈伸', type: 'skill', cost: 0, rarity: 'common', eff: { applies: [{ buff: 'str', amt: 2, self: true }] }, up1: { applies: [{ buff: 'str', amt: 4, self: true }] }, up2: { applies: [{ buff: 'str', amt: 4, self: true }] } },
    { id: 'warcry',  ch: '战吼', type: 'skill', cost: 0, rarity: 'common', kw: ['exhaust'], eff: { draw: 1 }, up1: { draw: 2 }, up2: { draw: 2 } },

    /* —— 罕见（蓝） —— */
    { id: 'uppercut', ch: '上勾拳', type: 'attack', cost: 2, rarity: 'uncommon', eff: { dmg: 13, applies: [{ buff: 'weak', amt: 1 }, { buff: 'vuln', amt: 1 }] }, up1: { dmg: 13, applies: [{ buff: 'weak', amt: 2 }, { buff: 'vuln', amt: 2 }] }, up2: { dmg: 15, applies: [{ buff: 'weak', amt: 2 }, { buff: 'vuln', amt: 2 }] } },
    { id: 'inflame',  ch: '燃烧', type: 'power', cost: 1, rarity: 'uncommon', eff: { applies: [{ buff: 'str', amt: 2, self: true }] }, up1: { applies: [{ buff: 'str', amt: 3, self: true }] }, up2: { cost: 0, applies: [{ buff: 'str', amt: 3, self: true }] } },
    { id: 'shockwave',ch: '震荡波', type: 'skill', cost: 2, rarity: 'uncommon', kw: ['exhaust'], eff: { aoe: true, applies: [{ buff: 'weak', amt: 3 }, { buff: 'vuln', amt: 3 }] }, up1: { aoe: true, applies: [{ buff: 'weak', amt: 5 }, { buff: 'vuln', amt: 5 }] }, up2: { aoe: true, applies: [{ buff: 'weak', amt: 5 }, { buff: 'vuln', amt: 5 }] } },
    { id: 'disarm',   ch: '缴械', type: 'skill', cost: 1, rarity: 'uncommon', kw: ['exhaust'], eff: { applies: [{ buff: 'str', amt: -2 }] }, up1: { applies: [{ buff: 'str', amt: -3 }] }, up2: { applies: [{ buff: 'str', amt: -3 }] } },
    { id: 'entrench', ch: '扎根', type: 'skill', cost: 2, rarity: 'uncommon', eff: { blkDouble: true }, up1: { cost: 1, blkDouble: true }, up2: { cost: 1, blkDouble: true } },
    { id: 'seeingred',ch: '暴怒', type: 'skill', cost: 1, rarity: 'uncommon', kw: ['exhaust'], eff: { energy: 2 }, up1: { cost: 0, energy: 2 }, up2: { cost: 0, energy: 2 } },
    { id: 'metallicize', ch: '金属化', type: 'power', cost: 1, rarity: 'uncommon', eff: { applies: [{ buff: 'meta', amt: 3, self: true }] }, up1: { applies: [{ buff: 'meta', amt: 4, self: true }] }, up2: { applies: [{ buff: 'meta', amt: 4, self: true }] } },
    { id: 'ghostarmor',ch: '幽灵护甲', type: 'skill', cost: 1, rarity: 'uncommon', eff: { blk: 10 }, up1: { blk: 13 }, up2: { blk: 13 } },
    { id: 'dropkick', ch: '飞踢', type: 'attack', cost: 1, rarity: 'uncommon', eff: { dmg: 5, dropkick: true }, up1: { dmg: 8, dropkick: true }, up2: { dmg: 8, dropkick: true } },

    /* —— 稀有（金） —— */
    { id: 'demonform', ch: '恶魔形态', type: 'power', cost: 3, rarity: 'rare', eff: { applies: [{ buff: 'str', amt: 2, self: true, perTurn: true }] }, up1: { applies: [{ buff: 'str', amt: 3, self: true, perTurn: true }] }, up2: { cost: 2, applies: [{ buff: 'str', amt: 3, self: true, perTurn: true }] } },
    { id: 'barricade', ch: '壁垒', type: 'power', cost: 3, rarity: 'rare', eff: { applies: [{ buff: 'barr', amt: 1, self: true }] }, up1: { cost: 2, applies: [{ buff: 'barr', amt: 1, self: true }] }, up2: { cost: 2, applies: [{ buff: 'barr', amt: 1, self: true }] } },
    { id: 'offering',  ch: '祭品', type: 'skill', cost: 0, rarity: 'rare', kw: ['exhaust'], eff: { loseHp: 6, energy: 2, draw: 3 }, up1: { loseHp: 6, energy: 2, draw: 5 }, up2: { loseHp: 6, energy: 2, draw: 5 } },
    { id: 'reaper',    ch: '收割', type: 'attack', cost: 2, rarity: 'rare', kw: ['exhaust'], eff: { dmg: 4, aoe: true, lifesteal: true }, up1: { dmg: 5, aoe: true, lifesteal: true }, up2: { dmg: 5, aoe: true, lifesteal: true } },
    { id: 'immolate',  ch: '献祭', type: 'attack', cost: 2, rarity: 'rare', eff: { dmg: 21, aoe: true, burnDiscard: true }, up1: { dmg: 28, aoe: true, burnDiscard: true }, up2: { dmg: 28, aoe: true, burnDiscard: true } },
    { id: 'bludgeon',  ch: '重锤', type: 'attack', cost: 3, rarity: 'rare', eff: { dmg: 32 }, up1: { dmg: 42 }, up2: { dmg: 42 } },
    { id: 'feed',      ch: '进食', type: 'attack', cost: 1, rarity: 'rare', kw: ['exhaust'], eff: { dmg: 10, feed: 3 }, up1: { dmg: 12, feed: 4 }, up2: { dmg: 12, feed: 4 } },
    { id: 'impervious',ch: '铜墙铁壁', type: 'skill', cost: 2, rarity: 'rare', kw: ['exhaust'], eff: { blk: 30 }, up1: { blk: 40 }, up2: { blk: 40 } },
  ];
  G.cardDefById = {};
  G.CARD_DEFS.forEach(function (d) { G.cardDefById[d.id] = d; });

  G.RARITY = {
    start: { cn: '初始', col: '#9fb0c0' },
    common: { cn: '普通', col: '#e6ecf3' },
    uncommon: { cn: '罕见', col: '#5fa8ff' },
    rare: { cn: '稀有', col: '#ffcf40' },
  };

  /* ---------- 圣物（30+，白/蓝/金三档） ---------- */
  G.RELICS = [
    /* white */
    { id: 'burningblood', cn: '燃烧之血', r: 'w', desc: '战斗胜利后回复 6 点生命', hook: 'winHeal', v: 6 },
    { id: 'lantern', cn: '提灯', r: 'w', desc: '每场战斗第 1 回合额外 +1 能量', hook: 'firstEnergy', v: 1 },
    { id: 'anchor', cn: '船锚', r: 'w', desc: '战斗第 1 回合获得 10 格挡', hook: 'firstBlock', v: 10 },
    { id: 'bagblood', cn: '血袋', r: 'w', desc: '进入战斗时回复 2 点生命', hook: 'combatStartHeal', v: 2 },
    { id: 'vajra', cn: '金刚杵', r: 'w', desc: '战斗开始获得 1 点力量', hook: 'startStr', v: 1 },
    { id: 'oddmushroom', cn: '古怪蘑菇', r: 'w', desc: '进入战斗获得 1 敏捷', hook: 'startDex', v: 1 },
    { id: 'whetstone', cn: '磨刀石', r: 'w', desc: '开局随机 2 张打击类进入弱强化', hook: 'passive' },
    { id: 'orichalcum', cn: '山铜', r: 'w', desc: '回合结束若无格挡，获得 6 格挡', hook: 'endBlockIfNone', v: 6 },
    { id: 'boot', cn: '旧靴', r: 'w', desc: '攻击伤害若 ≤4 则提升到 6', hook: 'minDmg', v: 6 },
    { id: 'pen', cn: '羽毛笔', r: 'w', desc: '每 3 张能力牌抽 1 张', hook: 'passive' },
    { id: 'dagger', cn: '仪式匕首', r: 'w', desc: '首次抽卡 +1 张', hook: 'firstDraw', v: 1 },
    { id: 'ancientinkwell', cn: '古墨瓶', r: 'w', desc: '生词初次学习答对额外 +1 数值', hook: 'passive' },
    /* blue */
    { id: 'kunai', cn: '苦无', r: 'b', desc: '每回合打出 3 张攻击牌获得 1 敏捷', hook: 'attackCount', v: 3 },
    { id: 'shuriken', cn: '手里剑', r: 'b', desc: '每回合打出 3 张攻击牌获得 1 力量', hook: 'attackCount2', v: 3 },
    { id: 'ornamentalfan', cn: '折扇', r: 'b', desc: '每回合打出 3 张攻击牌获得 4 格挡', hook: 'attackCount3', v: 3 },
    { id: 'inkbottle', cn: '墨水瓶', r: 'b', desc: '每打出 10 张牌抽 1 张', hook: 'playCount', v: 10 },
    { id: 'letteropener', cn: '拆信刀', r: 'b', desc: '每回合打出 3 张技能牌对全体 5 伤害', hook: 'skillCount', v: 3 },
    { id: 'pocketwatch', cn: '怀表', r: 'b', desc: '若上回合打出 ≤3 张牌，本回合抽牌 +3', hook: 'pocketwatch' },
    { id: 'mercuryhg', cn: '水银沙漏', r: 'b', desc: '回合开始对全体造成 3 伤害', hook: 'turnStartAoe', v: 3 },
    { id: 'paperphrog', cn: '纸蛙', r: 'b', desc: '易伤使敌人多受 75% 而非 50%', hook: 'vulnBoost' },
    { id: 'thescales', cn: '天平', r: 'b', desc: '每场战斗第 1 次受伤减少 3 点', hook: 'passive' },
    { id: 'selfformingclay', cn: '自塑黏土', r: 'b', desc: '本回合受伤后，下回合 +3 格挡', hook: 'clay' },
    { id: 'bird', cn: '铜鸟', r: 'b', desc: '篝火复习成功额外 +1 数值', hook: 'passive' },
    /* gold */
    { id: 'runicpyramid', cn: '符文金字塔', r: 'g', desc: '回合结束不再弃掉手牌', hook: 'keepHand' },
    { id: 'sozu', cn: '添水', r: 'g', desc: '+2 最大能量，但不再获得药水（本作简化为无副作用）', hook: 'maxEnergy', v: 2 },
    { id: 'philostone', cn: '贤者之石', r: 'g', desc: '+1 能量，敌人开局多 1 力量', hook: 'stoneEnergy', v: 1 },
    { id: 'coffeedripper', cn: '滴滤壶', r: 'g', desc: '+1 能量，篝火不能休息（只能复习）', hook: 'dripEnergy', v: 1 },
    { id: 'runiccube', cn: '符文魔方', r: 'g', desc: '每受到 1 次未格挡伤害抽 1 张', hook: 'cube' },
    { id: 'darkstone', cn: '黑曜石心', r: 'g', desc: '回合开始额外抽 1 弃 1', hook: 'darkstone' },
    { id: 'fossilizedhelix', cn: '化石螺壳', r: 'g', desc: '每场战斗免疫第 1 次受到的伤害', hook: 'fossil' },
    { id: 'lexicon', cn: '词典之魂', r: 'g', desc: '所有卡牌初始即为弱强化', hook: 'passive' },
    { id: 'crown', cn: '智慧之冠', r: 'g', desc: '开局额外获得 1 张随机稀有牌', hook: 'passive' },
  ];
  G.relicById = {};
  G.RELICS.forEach(function (r) { G.relicById[r.id] = r; });
  G.RELIC_COL = { w: '#e6ecf3', b: '#5fa8ff', g: '#ffcf40' };

  /* ---------- 敌人 / 精英 / 首领 ----------
     mkIntent 返回 {type, val, buff?, amt?, cn} —— 敌人每回合意图
     hp 用 [min,max]；scale 随塔层增长 */
  G.ENEMY_DEFS = {
    /* 小怪 */
    louse:   { cn: '绿虫', kind: 'normal', hp: [10, 14], art: 'louse', ai: 'louse' },
    slime:   { cn: '酸液史莱姆', kind: 'normal', hp: [12, 16], art: 'slime', ai: 'slime' },
    cultist: { cn: '邪教徒', kind: 'normal', hp: [14, 18], art: 'cultist', ai: 'cultist' },
    fungus:  { cn: '孢子菌', kind: 'normal', hp: [11, 15], art: 'fungus', ai: 'fungus' },
    jaw:     { cn: '颚虫', kind: 'normal', hp: [16, 20], art: 'jaw', ai: 'jaw' },
    /* 精英 */
    sentry:  { cn: '哨卫', kind: 'elite', hp: [30, 36], art: 'sentry', ai: 'sentry' },
    gremlin: { cn: '哥布林首领', kind: 'elite', hp: [44, 50], art: 'gremlin', ai: 'gremlin' },
    knight:  { cn: '堕落骑士', kind: 'elite', hp: [48, 55], art: 'knight', ai: 'knight' },
  };
  /* 三首领各具机制 */
  G.BOSS_DEFS = {
    amarth:  { cn: '命运 · Fate', kind: 'boss', hp: [155, 155], art: 'amarth', ai: 'amarth',
      lines: { open: '停下，凡人。念出你命运的词语。', pass: '……可命运无法夺走你的词语。', fail: '你的舌头背叛了你。这就是你的命运。' } },
    bauglir: { cn: '暴君 · Tyrant', kind: 'boss', hp: [168, 168], art: 'bauglir', ai: 'bauglir',
      lines: { open: '跪下，囚徒。把你的词语交给我的锁链。', pass: '走开！凡人竟诵出了枷锁之词！', fail: '啊！如同盲者，你在黑暗中低语。' } },
    dagnir:  { cn: '灾祸 · Bane', kind: 'boss', hp: [180, 180], art: 'dagnir', ai: 'dagnir',
      lines: { open: '良言，或毒语。抉择吧！', pass: '……你的词语锋利如剑。致命的美。', fail: '啊！毒液缠住了你的舌。你的词语枯萎，你的时辰将尽。' } },
  };

})(window.G);
