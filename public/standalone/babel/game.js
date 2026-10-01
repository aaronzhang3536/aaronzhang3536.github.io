/* 巴别塔 —— 引擎：状态 / 战斗结算 / Buff 数学 / 回合流 / 地图 / 学习 / 圣物
   纯逻辑，不碰 DOM；UI 通过 G.on 事件与轮询 G.state 渲染。 */
(function (G) {
  'use strict';

  /* ---------- 生词手册（局外成长，localStorage） ----------
     星级只来自答题：★ 初次学习（词义）· ★★ 篝火复习 · ★★★ 最终测验精通 */
  var MKEY = 'babel-manual';
  G.manual = {};
  try { G.manual = JSON.parse(localStorage.getItem(MKEY) || '{}') || {}; } catch (e) { G.manual = {}; }
  G.manualSave = function () { try { localStorage.setItem(MKEY, JSON.stringify(G.manual)); } catch (e) {} };
  G.manualStar = function (w) { return G.manual[w.toLowerCase()] || 0; };
  G.manualSet = function (w, star) {
    var k = w.toLowerCase();
    if (star > (G.manual[k] || 0)) { G.manual[k] = star; G.manualSave(); }
  };
  G.manualReset = function () { G.manual = {}; G.manualSave(); };   /* 词义 + 星级一并清空（修 round15 bug） */

  /* ---------- 事件总线 ---------- */
  var listeners = {};
  G.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  G.emit = function (ev, data) { (listeners[ev] || []).forEach(function (fn) { fn(data); }); };

  /* ---------- 卡牌实例 ----------
     c.lvl 只表示卡牌强度（0 基础 / 1 弱强化 / 2 强强化 / 3 精通，3 的数值同 2）；
     是否显示中文释义只看生词手册（G.cardKnown），圣物/奇遇的强化不会「教会」你一个词 */
  G.makeCard = function (defId, wordRec) {
    var def = G.cardDefById[defId];
    var rec = wordRec || G.drawWord(G.state ? G.state.depth : 0);
    var lvl = G.manualStar(rec.w);           /* 局外成长：按手册星级带入 */
    if (G.hasRelic('lexicon') && lvl < 1) lvl = 1;
    return {
      uid: G.uid(), defId: defId, word: rec,
      lvl: lvl, kw: (def.kw || []).slice(),
    };
  };
  G.cardEff = function (c) {
    var def = G.cardDefById[c.defId];
    if (c.lvl >= 2) return def.up2 || def.up1 || def.eff;
    if (c.lvl === 1) return def.up1 || def.eff;
    return def.eff;
  };
  G.cardCost = function (c) {
    var e = G.cardEff(c);
    return (typeof e.cost === 'number') ? e.cost : G.cardDefById[c.defId].cost;
  };
  G.cardType = function (c) { return G.cardDefById[c.defId].type; };
  G.cardRarity = function (c) { return G.cardDefById[c.defId].rarity; };
  G.cardName = function (c) { return c.word.w; };                 /* 卡面显示英文词 */
  G.cardKnown = function (c) { return G.manualStar(c.word.w) >= 1; };
  /* 需要选目标：非群体的伤害牌，或对敌人施加状态的非群体牌（如缴械） */
  G.cardNeedsTarget = function (c) {
    var e = G.cardEff(c);
    if (e.aoe) return false;
    if (e.dmg) return true;
    return (e.applies || []).some(function (a) { return !a.self; });
  };

  /* ---------- 局初始化 ---------- */
  G.startRun = function () {
    var st = {
      hp: 72, maxHp: 72, gold: 99, depth: 0, floor: 0,
      deck: [], relics: [], relicCounters: {},
      map: null, node: null, x: 0,
      relicRareBias: 0,
      learnedThisRun: {},         /* 修「重复抽到初次学习卡」bug */
      combat: null,
      bossId: G.pick(['amarth', 'bauglir', 'dagnir']),   /* 开局就定，地图上的首领提示才准 */
    };
    G.state = st;
    /* 起始牌组：4 打击 + 4 防御 + 1 痛击 */
    for (var i = 0; i < 4; i++) st.deck.push(G.makeCard('strike'));
    for (var j = 0; j < 4; j++) st.deck.push(G.makeCard('defend'));
    st.deck.push(G.makeCard('bash'));
    /* 起始圣物 */
    G.addRelic('burningblood');
    G.state.map = G.genMap();
    G.emit('runStart');
  };
  /* 中途退出：先让本场战斗失效，挂起的敌人回合 / 测验回调看到后自行作废 */
  G.quitRun = function () {
    var cb = G.state && G.state.combat;
    if (cb) { cb.ended = true; cb.phase = 'over'; }
    G.state = null;
  };

  G.hasRelic = function (id) { return !!G.state && G.state.relics.indexOf(id) >= 0; };
  G.addRelic = function (id) {
    if (!G.state || !G.relicById[id] || G.hasRelic(id)) return false;
    G.state.relics.push(id);
    var r = G.relicById[id];
    if (r.hook === 'passive') {
      if (id === 'whetstone') { var n = 0; G.state.deck.forEach(function (c) { if (n < 2 && c.defId === 'strike' && c.lvl < 1) { c.lvl = 1; n++; } }); }
      if (id === 'crown') { var pool = G.CARD_DEFS.filter(function (d) { return d.rarity === 'rare'; }); G.state.deck.push(G.makeCard(G.pick(pool).id)); }
      if (id === 'lexicon') { G.state.deck.forEach(function (c) { if (c.lvl < 1) c.lvl = 1; }); }
    }
    G.emit('relicGain', id);
    return true;
  };
  /* 动态概率抽圣物：70白/25蓝/5金，连白则蓝金升；exclude 里的不抽（商店两格不重复） */
  G.rollRelic = function (exclude) {
    var owned = G.state.relics, ex = exclude || [];
    var bias = G.state.relicRareBias || 0;
    var pw = Math.max(20, 70 - bias), pb = 25 + bias * 0.6, pg = 5 + bias * 0.4;
    var tot = pw + pb + pg, r = Math.random() * tot, tier = r < pw ? 'w' : r < pw + pb ? 'b' : 'g';
    if (tier === 'w') G.state.relicRareBias += 12; else G.state.relicRareBias = Math.max(0, G.state.relicRareBias - 20);
    function free(x) { return owned.indexOf(x.id) < 0 && ex.indexOf(x.id) < 0; }
    var pool = G.RELICS.filter(function (x) { return x.r === tier && free(x); });
    if (!pool.length) pool = G.RELICS.filter(free);
    return pool.length ? G.pick(pool).id : null;
  };
  G.relicPrice = function (id) {
    var r = G.relicById[id];
    var base = r.r === 'g' ? 300 : r.r === 'b' ? 225 : 150;   /* 金:蓝:白 ≈ 2:1.5:1 */
    return base + G.rnd(40) - 20;
  };

  /* ================= 地图生成（杀戮尖塔式路径播撒 + 规则化房间分配） =================
     结构（对齐 StS Act）：
       · 底行（r=0）全是普通战、顶行首领、首领前一行（r=13）全篝火、r=8 一行宝藏；
       · 6 条路径从底部向上游走，落点限 c±1 且禁止连线交叉 → 路线清晰不缠绕；
       · 其余房间按权重抽：前 5 层（r<5）无精英、无篝火，前 4 层（r<4）无商店；
         父节点是篝火 / 精英 / 商店时，子节点不再抽同类（这三类不连续）；
         r=12 不放篝火（否则紧挨 r=13 的篝火行）；
       · 全图恰好 3 商店：多了改回战斗，少了从 r4~12 的战斗里补（优先不与商店相邻）；
       · 每条根→首领路径的篝火 ≤5（r=13 保证至少 1 个），超了就把该路径上的篝火改回战斗。
     一次生成即合法，无需重试。 */
  var ROWS = 15, COLS = 7, PATHS = 6;
  G.genMap = function () {
    var nodes = {};                 /* id -> node */
    function nodeAt(r, c) {
      var id = r + '_' + c;
      if (!nodes[id]) nodes[id] = { r: r, c: c, type: 'fight', edges: [], id: id, cleared: false };
      return nodes[id];
    }
    var edgeSet = {};               /* 记录 r 行 c1->c2 边，用于查交叉 */
    function crosses(r, c1, c2) {
      if (c1 === c2) return false;
      /* 若已存在一条同行边 (a->b) 与 (c1->c2) 交叉（区间相交但端点相反）则禁止 */
      var list = edgeSet[r] || [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i][0], b = list[i][1];
        if (a === b) continue;
        if ((c1 < a && c2 > b) || (c1 > a && c2 < b)) return true;   /* X 形交叉 */
      }
      return false;
    }
    function addEdge(r, c1, c2) {
      var from = nodeAt(r, c1), to = nodeAt(r + 1, c2);
      if (from.edges.indexOf(to.id) < 0) from.edges.push(to.id);
      (edgeSet[r] = edgeSet[r] || []).push([c1, c2]);
    }
    /* 播撒 PATHS 条路径：每条从底行随机列出发，逐行选 c-1/c/c+1（不越界不交叉） */
    for (var p = 0; p < PATHS; p++) {
      var c = (p === 0) ? 1 + G.rnd(COLS - 2) : G.rnd(COLS);
      nodeAt(0, c);
      /* 只播到倒数第二行（ROWS-2）；首领行单独汇聚，避免多首领与交叉 */
      for (var r = 0; r < ROWS - 2; r++) {
        var opts = [];
        [-1, 0, 1].forEach(function (dc) {
          var nc = c + dc;
          if (nc < 0 || nc >= COLS) return;
          if (crosses(r, c, nc)) return;
          opts.push(nc);
        });
        if (!opts.length) opts = [c];
        var nc = G.pick(opts);
        addEdge(r, c, nc);
        c = nc;
      }
    }
    /* 顶部：所有到达倒数第二行的节点汇入唯一 boss 节点 */
    var boss = nodeAt(ROWS - 1, 3);
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      if (n.r === ROWS - 2) { if (n.edges.indexOf(boss.id) < 0) n.edges.push(boss.id); }
    });
    /* 收集分行网格 */
    var grid = [];
    for (var rr = 0; rr < ROWS; rr++) grid.push([]);
    Object.keys(nodes).forEach(function (id) { grid[nodes[id].r].push(nodes[id]); });
    grid.forEach(function (row) { row.sort(function (a, b) { return a.c - b.c; }); });

    /* ---------- 房间类型分配 ---------- */
    function parentsOf(n) {
      var ps = [];
      var prev = grid[n.r - 1] || [];
      prev.forEach(function (m) { if (m.edges.indexOf(n.id) >= 0) ps.push(m); });
      return ps;
    }
    grid.forEach(function (row, r) {
      row.forEach(function (n) {
        if (r === 0) { n.type = 'fight'; n.sub = 'normal'; return; }
        if (r === ROWS - 1) { n.type = 'boss'; return; }
        if (r === ROWS - 2) { n.type = 'fire'; return; }        /* 首领前必有篝火 */
        if (r === 8) { n.type = 'treasure'; return; }           /* 中段宝藏层 */
        /* 规则权重 */
        var parentTypes = parentsOf(n).map(function (m) { return m.type; });
        var noRest = r < 5 || r === ROWS - 3 || parentTypes.indexOf('fire') >= 0;   /* 前 5 层 / 篝火行前一层无篝火；篝火不连续 */
        var noElite = r < 5 || parentTypes.indexOf('elite') >= 0;                   /* 前 5 层无精英 / 精英不连续 */
        var noShop = r < 4 || parentTypes.indexOf('shop') >= 0;
        var w = [];
        function add(t, wt) { for (var i = 0; i < wt; i++) w.push(t); }
        add('fight', 42);
        add('event', 22);
        if (!noElite) add('elite', 10);
        if (!noRest) add('fire', 12);
        if (!noShop) add('shop', 8);
        add('treasure', 6);
        n.type = G.pick(w);
        if (n.type === 'fight') n.sub = r < 4 ? 'normal' : (Math.random() < 0.4 ? 'pack' : 'normal');
      });
    });
    var flat = Object.keys(nodes).map(function (id) { return nodes[id]; });
    /* 约束：全图恰好 3 商店 */
    var shops = flat.filter(function (n) { return n.type === 'shop'; });
    if (shops.length > 3) {
      G.shuffle(shops).slice(3).forEach(function (n) { n.type = 'fight'; n.sub = 'normal'; });
    } else if (shops.length < 3) {
      var need = 3 - shops.length;
      var cand = G.shuffle(flat.filter(function (n) { return n.type === 'fight' && n.r >= 4 && n.r <= 12; }));
      var nearShop = function (n) {
        return parentsOf(n).concat(n.edges.map(function (id) { return nodes[id]; }))
          .some(function (m) { return m.type === 'shop'; });
      };
      [true, false].forEach(function (strict) {       /* 先找不与商店相邻的，实在不够再放宽 */
        cand.forEach(function (n) {
          if (need > 0 && n.type === 'fight' && (!strict || !nearShop(n))) { n.type = 'shop'; need--; }
        });
      });
    }
    capFires(grid);
    return { grid: grid, rows: ROWS };
  };
  function pathsOf(grid) {
    var byId = {}; grid.forEach(function (row) { row.forEach(function (n) { byId[n.id] = n; }); });
    var out = [];
    function walk(n, acc) {
      acc = acc.concat([n]);
      if (!n.edges.length) { out.push(acc); return; }
      n.edges.forEach(function (eid) { if (byId[eid]) walk(byId[eid], acc); });
    }
    grid[0].forEach(function (n) { walk(n, []); });
    return out;
  }
  /* 每条路径篝火 ≤5：超出的路径随机把一个非强制篝火改回战斗，直到全部达标 */
  function capFires(grid) {
    for (var iter = 0; iter < 60; iter++) {
      var over = null;
      pathsOf(grid).forEach(function (path) {
        if (!over && path.filter(function (n) { return n.type === 'fire'; }).length > 5) over = path;
      });
      if (!over) return;
      var fires = over.filter(function (n) { return n.type === 'fire' && n.r < ROWS - 2; });
      var f = G.pick(fires); f.type = 'fight'; f.sub = 'normal';
    }
  }
  G.pathsOf = pathsOf;            /* 供测试统计每条路径的房间 */

  /* ================= 战斗 ================= */
  function scaleHp(def, depth) {
    var lo = def.hp[0], hi = def.hp[1];
    var base = lo + G.rnd(hi - lo + 1);
    return Math.round(base * (1 + depth * 0.06));
  }
  function newEnemy(defId, isBoss, depth) {
    var def = (isBoss ? G.BOSS_DEFS : G.ENEMY_DEFS)[defId];
    var hp = isBoss ? def.hp[0] : scaleHp(def, depth);
    var e = { uid: G.uid(), defId: defId, def: def, cn: def.cn, art: def.art, isBoss: !!isBoss,
      hp: hp, maxHp: hp, block: 0, buffs: {}, intent: null, dead: false, turnNo: 0, meta: {} };
    if (G.hasRelic('philostone')) e.buffs.str = (e.buffs.str || 0) + 1;
    if (isBoss && G.hasRelic('philostone')) e.buffs.str += 1;
    return e;
  }

  G.enterCombat = function (kind, sub) {
    var st = G.state, depth = st.depth;
    var enemies = [];
    if (kind === 'boss') {
      enemies.push(newEnemy(st.bossId || G.pick(['amarth', 'bauglir', 'dagnir']), true, depth));
    } else if (kind === 'elite') {
      enemies.push(newEnemy(G.pick(['sentry', 'gremlin', 'knight']), false, depth));
    } else {
      if (sub === 'pack') {
        var n = 2 + (Math.random() < 0.4 ? 1 : 0);
        for (var i = 0; i < n; i++) enemies.push(newEnemy(G.pick(['louse', 'slime', 'fungus', 'jaw']), false, depth));
      } else {
        enemies.push(newEnemy(G.pick(['louse', 'slime', 'cultist']), false, depth));
      }
    }
    var maxE = 3 + (G.hasRelic('sozu') ? G.relicById.sozu.v : 0) + (G.hasRelic('philostone') ? 1 : 0) +
      (G.hasRelic('coffeedripper') ? 1 : 0);
    var cb = {
      kind: kind, enemies: enemies, turn: 0, ended: false, won: false,
      phase: 'player',            /* player 出牌 / enemy 敌人行动中 / exam 等待测验 / over 已结束 */
      player: { block: 0, buffs: {}, energy: 3, maxEnergy: maxE },
      hand: [], draw: G.shuffle(st.deck.map(function (c) { return c; })), discard: [], exhaust: [],
      handSize: 5, playedThisTurn: 0, attacksThisTurn: 0, skillsThisTurn: 0, powersPlayed: 0,
      lastTurnPlayed: 99, playCountTotal: 0, firstDamageTaken: false, examDone: false,
    };
    st.combat = cb;
    /* 圣物：战斗开始 */
    if (G.hasRelic('bagblood')) G.heal(G.relicById.bagblood.v);
    if (G.hasRelic('vajra')) cb.player.buffs.str = (cb.player.buffs.str || 0) + 1;
    if (G.hasRelic('oddmushroom')) cb.player.buffs.dex = (cb.player.buffs.dex || 0) + 1;
    /* 固有牌先入手 */
    startTurn(true);
    G.emit('combatStart');
  };
  G.isPlayerPhase = function () {
    var cb = G.state && G.state.combat;
    return !!cb && !cb.ended && cb.phase === 'player';
  };

  function drawCards(n) {
    var cb = G.state.combat;
    for (var i = 0; i < n; i++) {
      if (cb.hand.length >= 10) break;
      if (!cb.draw.length) {
        if (!cb.discard.length) break;
        cb.draw = G.shuffle(cb.discard); cb.discard = [];
      }
      cb.hand.push(cb.draw.shift());
    }
  }

  function startTurn(first) {
    var cb = G.state.combat, p = cb.player;
    cb.turn++;
    cb.playedThisTurn = 0; cb.attacksThisTurn = 0; cb.skillsThisTurn = 0;
    /* 毒：回合开始结算；玩家被毒死直接战败 */
    applyPoison(p, true);
    if (G.state.hp <= 0) { endCombat(false); return; }
    cb.enemies.forEach(function (e) { applyPoison(e, false); });
    /* 格挡清空（壁垒例外）；自塑黏土：上回合受过未格挡伤害 → 这回合开始 +格挡 */
    if (!p.buffs.barr) p.block = 0;
    if (p._clayNext) { p.block += p._clayNext; p._clayNext = 0; }
    /* 能量 */
    p.energy = p.maxEnergy;
    if (first && G.hasRelic('lantern')) p.energy += G.relicById.lantern.v;
    /* 抽牌 */
    var dn = cb.handSize;
    if (first) {
      if (G.hasRelic('anchor')) p.block += G.relicById.anchor.v;
      if (G.hasRelic('dagger')) dn += G.relicById.dagger.v;
      cb.draw = orderInnate(cb.draw);
    }
    if (G.hasRelic('pocketwatch') && cb.lastTurnPlayed <= 3 && !first) dn += 3;
    if (G.hasRelic('darkstone')) dn += G.relicById.darkstone.v;
    drawCards(dn);
    cb.enemies.forEach(function (e) { if (!e.dead) rollIntent(e); });
    /* 力量per回合（恶魔形态） */
    if (p.buffs._demonPerTurn) p.buffs.str = (p.buffs.str || 0) + p.buffs._demonPerTurn;
    /* 圣物：回合开始 */
    if (G.hasRelic('mercuryhg')) cb.enemies.forEach(function (e) { if (!e.dead) dealToEnemy(e, G.relicById.mercuryhg.v, true); });
    checkDead();
    if (cb.ended) return;
    cb.phase = 'player';
    G.emit('turnStart', { turn: cb.turn, first: first });
  }
  function orderInnate(pile) {
    var innate = [], rest = [];
    pile.forEach(function (c) { (c.kw.indexOf('innate') >= 0 ? innate : rest).push(c); });
    return innate.concat(rest);
  }
  function applyPoison(unit, isPlayer) {
    var b = unit.buffs;
    if (!b.poison || (!isPlayer && unit.dead)) return;
    if (isPlayer) G.state.hp = Math.max(0, G.state.hp - b.poison);
    else {
      unit.hp = Math.max(0, unit.hp - b.poison);
      if (unit.hp <= 0) { unit.dead = true; G.emit('enemyDead', unit); }
    }
    b.poison -= 1; if (b.poison <= 0) delete b.poison;
  }

  /* ---------- Buff 数学 ---------- */
  G.atkDamage = function (base, srcBuffs, tgtBuffs) {
    var d = base + (srcBuffs.str || 0);
    if (srcBuffs.weak) d = Math.floor(d * 0.75);
    if (tgtBuffs && tgtBuffs.vuln) {
      var mul = G.hasRelic('paperphrog') ? 1.75 : 1.5;
      d = Math.floor(d * mul);
    }
    if (G.hasRelic('boot') && base <= 4 && base > 0) d = Math.max(d, G.relicById.boot.v);
    return Math.max(0, d);
  };
  G.blockGain = function (base, buffs) {
    var b = base + (buffs.dex || 0);
    if (buffs.frail) b = Math.floor(b * 0.75);
    return Math.max(0, b);
  };

  function dealToEnemy(e, dmg, ignoreBlock) {
    if (e.dead) return;
    var d = dmg;
    if (!ignoreBlock) {
      if (e.block > 0) { var absorbed = Math.min(e.block, d); e.block -= absorbed; d -= absorbed; }
    }
    e.hp = Math.max(0, e.hp - d);
    if (e.hp <= 0) { e.dead = true; G.emit('enemyDead', e); }
  }
  G.damagePlayer = function (dmg) {
    var cb = G.state.combat, p = cb.player;
    var d = dmg;
    if (p.buffs.intan) d = Math.min(d, 1);
    if (G.hasRelic('fossilizedhelix') && !cb.player._fossilUsed) { cb.player._fossilUsed = true; d = 0; }
    if (G.hasRelic('thescales') && !cb._scalesUsed) { cb._scalesUsed = true; d = Math.max(0, d - 3); }
    var toBlock = Math.min(p.block, d); p.block -= toBlock; d -= toBlock;
    if (d > 0) {
      G.state.hp = Math.max(0, G.state.hp - d);
      if (!cb.firstDamageTaken) cb.firstDamageTaken = true;
      if (G.hasRelic('runiccube')) drawCards(1);
      if (G.hasRelic('selfformingclay')) p._clayNext = G.relicById.selfformingclay.v;
      G.emit('playerHurt', d);
    }
    if (G.state.hp <= 0) endCombat(false);
  };
  G.heal = function (n) { G.state.hp = Math.min(G.state.maxHp, G.state.hp + n); };

  function checkDead() {
    var cb = G.state.combat;
    if (cb.enemies.every(function (e) { return e.dead; })) endCombat(true);
  }

  /* ---------- 敌人意图 ----------
     攻击意图只记「基础伤害」base；显示与结算都现算 G.intentDamage（力量、虚弱、易伤实时生效，
     缴械能削弱已宣告的攻击，首领的力量回合也真的会加伤） */
  function rollIntent(e) {
    e.turnNo++;
    var d = e.def, ai = d.ai, dep = G.state.depth;
    function atk(v) { return { type: 'attack', base: v, cn: '攻击' }; }
    function atkDeb(v, buff, amt) { return { type: 'attackdebuff', base: v, buff: buff, amt: amt, cn: '攻击+' + G.BUFFS[buff].name }; }
    function def(v) { return { type: 'defend', val: v, cn: '防御' }; }
    function buf(buff, amt) { return { type: 'buff', buff: buff, amt: amt, cn: G.BUFFS[buff].name }; }
    var t = e.turnNo, base = 5 + Math.floor(dep * 0.6);
    switch (ai) {
      case 'louse': e.intent = Math.random() < 0.7 ? atk(base) : buf('str', 1); break;
      case 'slime': e.intent = t % 3 === 0 ? atkDeb(base - 1, 'weak', 1) : (Math.random() < 0.5 ? atk(base + 1) : def(6)); break;
      case 'cultist': e.intent = t === 1 ? buf('str', 3) : atk(base); break;
      case 'fungus': e.intent = Math.random() < 0.6 ? atk(base) : buf('str', 2); break;
      case 'jaw': e.intent = Math.random() < 0.5 ? atk(base + 3) : def(5); break;
      case 'sentry': e.intent = t % 2 === 0 ? atk(base + 4) : atkDeb(0, 'frail', 2); break;
      case 'gremlin': e.intent = t % 3 === 0 ? buf('str', 3) : atk(base + 3); break;
      case 'knight': e.intent = t % 2 === 1 ? def(10) : atkDeb(base + 5, 'vuln', 2); break;
      /* 首领 */
      case 'amarth': amarthIntent(e, base); break;
      case 'bauglir': bauglirIntent(e, base); break;
      case 'dagnir': dagnirIntent(e, base); break;
      default: e.intent = atk(base);
    }
    /* 意图里「先打后易伤」由结算顺序保证（见 enemyAct） */
  }
  G.intentDamage = function (e) {
    var it = e.intent;
    if (!it || (it.type !== 'attack' && it.type !== 'attackdebuff')) return 0;
    return G.atkDamage(it.base, e.buffs, G.state.combat.player.buffs);
  };
  /* 首领机制：Amarth 命运——第 5、10 回合触发最终测验，回合数过多直接命运斩杀 */
  function amarthIntent(e, base) {
    var t = e.turnNo;
    if (t === 5 || t === 10) { e.intent = { type: 'exam', cn: '最终测验' }; return; }
    if (t >= 13) { e.intent = { type: 'attack', base: 40, cn: '命运降临', doom: true }; return; }
    e.intent = t % 3 === 0 ? { type: 'attackdebuff', base: base + 6, buff: 'weak', amt: 2, cn: '攻击+虚弱' }
      : (t % 3 === 1 ? { type: 'attack', base: base + 8, cn: '攻击' } : { type: 'buff', buff: 'str', amt: 3, cn: '力量' });
  }
  /* Bauglir 暴君：召唤锁链（获得格挡）+ 阶段转换，第 6 回合最终测验 */
  function bauglirIntent(e, base) {
    var t = e.turnNo;
    if (t === 6) { e.intent = { type: 'exam', cn: '最终测验' }; return; }
    if (e.hp < e.maxHp * 0.5 && !e.meta.enraged) { e.meta.enraged = true; e.buffs.str = (e.buffs.str || 0) + 4; }
    if (t % 4 === 0) e.intent = { type: 'defend', val: 20, cn: '锁链' };
    else e.intent = { type: 'attackdebuff', base: base + 7, buff: 'frail', amt: 2, cn: '攻击+脆弱' };
  }
  /* Dagnir 灾祸：中毒叠加 + 复活一次，第 7 回合最终测验 */
  function dagnirIntent(e, base) {
    var t = e.turnNo;
    if (t === 7) { e.intent = { type: 'exam', cn: '最终测验' }; return; }
    if (t % 3 === 0) e.intent = { type: 'poison', amt: 3 + Math.floor(t / 3), cn: '剧毒' };
    else e.intent = { type: 'attack', base: base + 6, cn: '攻击' };
  }

  /* ---------- 打出卡牌 ---------- */
  G.canPlay = function (c) {
    if (!G.isPlayerPhase()) return false;
    return G.state.combat.player.energy >= G.cardCost(c);
  };
  G.playCard = function (c, targetUid) {
    if (!G.canPlay(c)) return false;            /* 只在玩家阶段、能量够时可出 */
    var cb = G.state.combat, p = cb.player;
    var idx = cb.hand.indexOf(c); if (idx < 0) return false;
    /* 单体牌必须有活着的目标；场上只剩一个敌人时自动锁定 */
    var target = null;
    if (G.cardNeedsTarget(c)) {
      var live = cb.enemies.filter(function (x) { return !x.dead; });
      target = live.filter(function (x) { return x.uid === targetUid; })[0] || (live.length === 1 ? live[0] : null);
      if (!target) return false;
    }
    var e = G.cardEff(c), type = G.cardType(c);
    p.energy -= G.cardCost(c);
    cb.hand.splice(idx, 1);
    cb.playedThisTurn++; cb.playCountTotal++;
    if (type === 'attack') cb.attacksThisTurn++;
    if (type === 'skill') cb.skillsThisTurn++;

    resolveEffect(c, e, type, target);

    /* 圣物：连击计数 */
    if (type === 'attack') {
      if (G.hasRelic('kunai') && cb.attacksThisTurn % 3 === 0) p.buffs.dex = (p.buffs.dex || 0) + 1;
      if (G.hasRelic('shuriken') && cb.attacksThisTurn % 3 === 0) p.buffs.str = (p.buffs.str || 0) + 1;
      if (G.hasRelic('ornamentalfan') && cb.attacksThisTurn % 3 === 0) p.block += 4;
    }
    if (type === 'skill' && G.hasRelic('letteropener') && cb.skillsThisTurn % 3 === 0) cb.enemies.forEach(function (en) { if (!en.dead) dealToEnemy(en, 5, false); });
    if (type === 'power') { cb.powersPlayed++; if (G.hasRelic('pen') && cb.powersPlayed % 3 === 0) drawCards(1); }
    if (G.hasRelic('inkbottle') && cb.playCountTotal % 10 === 0) drawCards(1);

    /* 去向：能力牌与消耗牌移出本场（入消耗堆，不再抽到）；其余入弃牌堆 */
    if (type === 'power') {
      cb.exhaust.push(c);
    } else if (c.kw.indexOf('exhaust') >= 0) {
      cb.exhaust.push(c); G.emit('cardExhaust', c);
    } else {
      cb.discard.push(c);
    }
    checkDead();
    G.emit('cardPlayed', { card: c, type: type });
    return true;
  };

  function resolveEffect(c, e, type, target) {
    var cb = G.state.combat, p = cb.player;
    var enemies = cb.enemies.filter(function (x) { return !x.dead; });
    var foes = e.aoe ? enemies : (target ? [target] : []);      /* 单体牌只作用于所选目标 */
    /* 伤害 */
    function hitEnemy(en, dmgBase) {
      var dmg = G.atkDamage(dmgBase, p.buffs, en.buffs);
      dealToEnemy(en, dmg, false);
      if (en.buffs.thorns) G.damagePlayer(en.buffs.thorns);
      if (e.lifesteal) G.heal(dmg);
      if (e.feed && en.dead && !en._fed) { en._fed = true; G.state.maxHp += e.feed; G.heal(e.feed); }
      G.emit('enemyHit', { e: en, dmg: dmg });
    }
    if (e.dmg) {
      var hits = e.hits || 1;
      for (var h = 0; h < hits; h++) foes.forEach(function (en) { if (!en.dead) hitEnemy(en, e.dmg); });
    }
    if (e.dropkick && target && target.buffs.vuln) { p.energy += 1; drawCards(1); }
    /* 格挡 */
    if (e.blk) p.block += G.blockGain(e.blk, p.buffs);
    if (e.blkDouble) p.block *= 2;
    /* 抽/能 */
    if (e.draw) drawCards(e.draw);
    if (e.energy) p.energy += e.energy;
    if (e.loseHp) G.damagePlayerRaw(e.loseHp);
    if (e.heal) G.heal(e.heal);
    /* 献祭：弃掉其余全部手牌 */
    if (e.burnDiscard && cb.hand.length) { cb.discard = cb.discard.concat(cb.hand); cb.hand = []; }
    /* buff 施加 */
    (e.applies || []).forEach(function (a) {
      if (a.self) {
        if (a.perTurn) p.buffs._demonPerTurn = (p.buffs._demonPerTurn || 0) + a.amt;
        else addBuff(p.buffs, a.buff, a.amt);
      } else {
        foes.forEach(function (en) { if (!en.dead) addBuff(en.buffs, a.buff, a.amt); });
      }
    });
  }
  G.damagePlayerRaw = function (n) { G.state.hp = Math.max(0, G.state.hp - n); if (G.state.hp <= 0) endCombat(false); };
  function addBuff(buffs, id, amt) {
    buffs[id] = (buffs[id] || 0) + amt;          /* 力量/敏捷允许为负 */
    if (buffs[id] === 0) delete buffs[id];
  }

  /* ---------- 结束回合 → 敌人行动 ----------
     回合阶段锁：只有 player 阶段能结束回合（连点不会让敌人行动两次）；
     敌人逐个行动的定时回调在退出到标题 / 战斗结束后自动作废 */
  G.endTurn = function () {
    if (!G.isPlayerPhase()) return false;
    var st = G.state, cb = st.combat, p = cb.player;
    cb.phase = 'enemy';
    /* 回合结束结算 */
    if (p.buffs.meta) p.block += p.buffs.meta;
    if (p.buffs.regen) { G.heal(p.buffs.regen); }
    if (G.hasRelic('orichalcum') && p.block === 0) p.block += G.relicById.orichalcum.v;
    /* 弃手牌（符文金字塔保留） */
    if (!G.hasRelic('runicpyramid')) {
      cb.discard = cb.discard.concat(cb.hand.filter(function (c) { return c.kw.indexOf('retain') < 0; }));
      cb.hand = cb.hand.filter(function (c) { return c.kw.indexOf('retain') >= 0; });
    }
    cb.lastTurnPlayed = cb.playedThisTurn;
    decayBuffs(p.buffs);
    G.emit('turnEnd');
    /* 敌人依次行动 */
    var order = cb.enemies.filter(function (e) { return !e.dead; });
    var i = 0;
    function step() {
      if (G.state !== st || cb.ended) return;
      if (i >= order.length) { afterEnemies(); return; }
      var e = order[i++];
      if (e.dead) { step(); return; }
      enemyAct(e, function () { setTimeout(step, 260); });
    }
    step();
    return true;
  };
  function enemyAct(e, done) {
    var cb = G.state.combat, it = e.intent;
    e.block = 0;                       /* 敌人格挡在它自己行动开始时清空（同 StS） */
    if (!it) { done(); return; }
    G.emit('enemyActStart', e);
    if (it.type === 'attack' || it.type === 'attackdebuff') {
      /* 结算顺序：先攻击后易伤（修 round16 bug） */
      G.damagePlayer(G.intentDamage(e));
      if (it.buff && !cb.ended) addBuff(cb.player.buffs, it.buff, it.amt);
    } else if (it.type === 'defend') {
      e.block += it.val;
    } else if (it.type === 'buff') {
      addBuff(e.buffs, it.buff, it.amt);
    } else if (it.type === 'poison') {
      addBuff(cb.player.buffs, 'poison', it.amt);
    } else if (it.type === 'exam') {
      cb.phase = 'exam';
      cb._afterExam = done;          /* 等玩家答完题（G.resolveExam）再继续敌人流程 */
      G.emit('bossExam', e);         /* UI 弹出测验 */
      return;
    }
    decayBuffs(e.buffs);
    G.emit('enemyActEnd', e);
    done();
  }
  function afterEnemies() {
    var cb = G.state.combat;
    if (cb.ended) return;
    checkDead();
    if (!cb.ended) startTurn(false);
  }
  function decayBuffs(buffs) {
    ['vuln', 'weak', 'frail', 'regen', 'intan'].forEach(function (k) {
      if (buffs[k]) { buffs[k] -= 1; if (buffs[k] <= 0) delete buffs[k]; }
    });
  }

  /* ---------- 最终测验（首领机制） ----------
     第一题词义、第二题构词（该词没有核对过的构词时改考词义）。
     优先挑手册里已 ★★ 的词：答对即精通为 ★★★（「★★★ 最终测验精通」） */
  G.buildExam = function () {
    var cb = G.state.combat, deck = G.state.deck.slice();
    function star(c) { return G.manualStar(c.word.w); }
    function pickFrom(cands, avoidWord) {
      var a = cands.filter(function (c) { return c.word.w !== avoidWord; });
      return a.length ? G.pick(a) : null;
    }
    var weakCard = pickFrom(deck.filter(function (c) { return star(c) === 2; })) ||
      pickFrom(deck.filter(function (c) { return G.cardKnown(c); })) || G.pick(deck);
    var w0 = weakCard.word.w;
    var strongCard = pickFrom(deck.filter(function (c) { return star(c) === 2 && c.word.forms; }), w0) ||
      pickFrom(deck.filter(function (c) { return c.word.forms; }), w0) || pickFrom(deck, w0) || weakCard;
    var meaning = G.meaningQuiz(weakCard.word); meaning.card = weakCard;
    var form = G.quizFor(strongCard.word); form.card = strongCard;
    var exam = { meaning: meaning, form: form };
    if (cb) cb.exam = exam;
    return exam;
  };
  G.resolveExam = function (e, meaningOK, formOK) {
    var st = G.state, cb = st && st.combat;
    if (!cb || cb.phase !== 'exam') return false;      /* 防重复结算 */
    cb.phase = 'enemy';
    var mastered = [];
    if (cb.exam) {
      [[cb.exam.meaning, meaningOK], [cb.exam.form, formOK]].forEach(function (pr) {
        var card = pr[0].card;
        if (!pr[1] || !card || G.manualStar(card.word.w) < 2) return;
        G.manualSet(card.word.w, 3);
        if (card.lvl >= 2 && card.lvl < 3) card.lvl = 3;
        mastered.push(card.word.w);
        G.emit('cardUpgraded', { card: card, to: 3 });
      });
      cb.exam = null;
    }
    var right = (meaningOK ? 1 : 0) + (formOK ? 1 : 0);
    if (right === 2) { addBuff(e.buffs, 'weak', 2); G.emit('examResult', { e: e, r: 'pass', mastered: mastered }); }
    else if (right === 1) { G.damagePlayerRaw(5); G.emit('examResult', { e: e, r: 'half', mastered: mastered }); }
    else { var pb = cb.player.buffs; addBuff(pb, 'frail', 2); addBuff(pb, 'weak', 2); addBuff(pb, 'vuln', 2); G.emit('examResult', { e: e, r: 'fail', mastered: mastered }); }
    cb.examDone = true;
    decayBuffs(e.buffs);
    G.emit('enemyActEnd', e);
    /* 继续敌人流程（退出到标题 / 战斗已结束则作废） */
    var next = cb._afterExam; cb._afterExam = null;
    setTimeout(function () { if (G.state === st && !cb.ended && next) next(); }, 200);
    return true;
  };

  /* ---------- 战斗结束 ---------- */
  function endCombat(won) {
    var cb = G.state.combat;
    if (cb.ended) return;
    cb.ended = true; cb.won = won; cb.phase = 'over';
    if (won) {
      if (G.hasRelic('burningblood')) G.heal(G.relicById.burningblood.v);
      G.state.gold += 10 + G.rnd(11) + (cb.kind === 'elite' ? 20 : 0) + (cb.kind === 'boss' ? 40 : 0);
    }
    G.emit('combatEnd', { won: won, kind: cb.kind });
  }

  /* ---------- 学习：初次学习（战斗后卡奖励触发） ----------
     优先考手册里还不认识的词；其次本局没学过、尚未强化的卡 */
  G.buildFirstLearn = function () {
    var done = G.state.learnedThisRun;
    var fresh = G.state.deck.filter(function (c) { return !done[c.uid]; });
    var cands = fresh.filter(function (c) { return G.manualStar(c.word.w) < 1; });
    if (!cands.length) cands = fresh.filter(function (c) { return c.lvl < 1; });
    if (!cands.length) cands = fresh;
    if (!cands.length) return null;
    var card = G.pick(cands), q = G.meaningQuiz(card.word);
    q.card = card;
    return q;
  };
  G.applyFirstLearn = function (card, ok) {
    G.state.learnedThisRun[card.uid] = true;
    if (ok) {
      G.manualSet(card.word.w, 1);
      if (G.hasRelic('ancientinkwell')) G.heal(G.relicById.ancientinkwell.v);
      if (card.lvl < 1) { card.lvl = 1; G.emit('cardUpgraded', { card: card, to: 1 }); }
    }
  };
  /* 篝火复习：自选（最多 2 张，铜鸟 +1）已学会词义的弱强化卡，构词测验（无构词则词义），成功→强强化 */
  G.reviewCandidates = function () {
    return G.state.deck.filter(function (c) { return c.lvl === 1 && G.manualStar(c.word.w) >= 1; });
  };
  G.reviewMax = function () { return 2 + (G.hasRelic('bird') ? G.relicById.bird.v : 0); };
  G.reviewQuiz = function (card) { var q = G.quizFor(card.word); q.card = card; return q; };
  G.applyReview = function (card, ok) {
    if (ok) {
      if (card.lvl < 2) card.lvl = 2;
      G.manualSet(card.word.w, 2);
      G.emit('cardUpgraded', { card: card, to: 2 });
    }
    return ok;
  };

  /* ---------- 商店：每个商店节点只进货一次，库存（含已售状态）存在节点上 ---------- */
  G.SHOP_REMOVE_PRICE = 75;
  G.shopStock = function () {
    var node = G.state.node;
    if (node.shop) return node.shop;
    var pool = G.CARD_DEFS.filter(function (d) { return !d.starter; });
    var cards = [], relics = [], taken = [];
    for (var i = 0; i < 4; i++) {
      var c = G.makeCard(G.pick(pool).id);
      cards.push({ card: c, price: { common: 45, uncommon: 68, rare: 145 }[G.cardRarity(c)] + G.rnd(20) - 10, sold: false });
    }
    for (var j = 0; j < 2; j++) {
      var rid = G.rollRelic(taken);                    /* 两格圣物不重复 */
      if (!rid) continue;
      taken.push(rid);
      relics.push({ id: rid, price: G.relicPrice(rid), sold: false });
    }
    node.shop = { cards: cards, relics: relics, removed: false };
    return node.shop;
  };
  /* 购买：金币不够 / 已售 / 圣物已拥有都不扣钱，返回是否成交 */
  G.shopBuy = function (item, kind) {
    var st = G.state;
    if (!item || item.sold || st.gold < item.price) return false;
    if (kind === 'relic') { if (!G.addRelic(item.id)) return false; }
    else st.deck.push(item.card);
    st.gold -= item.price; item.sold = true;
    return true;
  };
  /* 删牌：每个商店一次 */
  G.shopRemove = function (card) {
    var st = G.state, stock = G.shopStock(), i = st.deck.indexOf(card);
    if (stock.removed || st.gold < G.SHOP_REMOVE_PRICE || i < 0) return false;
    st.deck.splice(i, 1); st.gold -= G.SHOP_REMOVE_PRICE; stock.removed = true;
    return true;
  };

  /* ---------- 地图行进 ---------- */
  G.nodeById = function (id) {
    var found = null;
    G.state.map.grid.forEach(function (row) { row.forEach(function (n) { if (n.id === id) found = n; }); });
    return found;
  };
  G.reachable = function () {
    var st = G.state, grid = st.map.grid;
    if (!st.node) return grid[0];
    return st.node.edges.map(G.nodeById);
  };
  G.enterNode = function (n) {
    var st = G.state;
    st.node = n; st.floor = n.r; st.depth = n.r;
    n.cleared = true;
    G.emit('enterNode', n);
  };

})(window.G);
