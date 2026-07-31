/* 巴别塔 —— 引擎：状态 / 战斗结算 / Buff 数学 / 回合流 / 地图 / 学习 / 圣物
   纯逻辑，不碰 DOM；UI 通过 G.on 事件与轮询 G.state 渲染。 */
(function (G) {
  'use strict';

  /* ---------- 生词手册（局外成长，localStorage） ---------- */
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

  /* ---------- 卡牌实例 ---------- */
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
  G.cardKnown = function (c) { return G.manualStar(c.word.w) >= 1 || c.lvl >= 1; };

  /* ---------- 局初始化 ---------- */
  G.startRun = function () {
    var st = {
      hp: 72, maxHp: 72, gold: 99, depth: 0, floor: 0,
      deck: [], relics: [], relicCounters: {},
      map: null, node: null, x: 0,
      shopRemovedOnce: false, relicRareBias: 0,
      learnedThisRun: {},         /* 修「重复抽到初次学习卡」bug */
      combat: null, seed: Date.now(),
      goldDrained: false,
    };
    G.state = st;
    /* 起始牌组：4 打击 + 4 防御 + 1 痛击 */
    for (var i = 0; i < 4; i++) st.deck.push(G.makeCard('strike'));
    for (var j = 0; j < 4; j++) st.deck.push(G.makeCard('defend'));
    st.deck.push(G.makeCard('bash'));
    /* 起始圣物 */
    G.addRelic('burningblood');
    if (G.relicById.crown) {} /* 冠是可掉落金圣物，不默认给 */
    G.state.map = G.genMap();
    G.emit('runStart');
  };

  G.hasRelic = function (id) { return G.state && G.state.relics.indexOf(id) >= 0; };
  G.addRelic = function (id) {
    if (!G.state || G.hasRelic(id)) return false;
    G.state.relics.push(id);
    var r = G.relicById[id];
    if (r && r.hook === 'passive') {
      if (id === 'whetstone') { var n = 0; G.state.deck.forEach(function (c) { if (n < 2 && c.defId === 'strike' && c.lvl < 1) { c.lvl = 1; n++; } }); }
      if (id === 'crown') { var pool = G.CARD_DEFS.filter(function (d) { return d.rarity === 'rare'; }); G.state.deck.push(G.makeCard(G.pick(pool).id)); }
      if (id === 'lexicon') { G.state.deck.forEach(function (c) { if (c.lvl < 1) c.lvl = 1; }); }
    }
    G.emit('relicGain', id);
    return true;
  };
  /* 动态概率抽圣物：70白/25蓝/5金，连白则蓝金升 */
  G.rollRelic = function () {
    var owned = G.state.relics;
    var bias = G.state.relicRareBias || 0;
    var pw = Math.max(20, 70 - bias), pb = 25 + bias * 0.6, pg = 5 + bias * 0.4;
    var tot = pw + pb + pg, r = Math.random() * tot, tier = r < pw ? 'w' : r < pw + pb ? 'b' : 'g';
    if (tier === 'w') G.state.relicRareBias += 12; else G.state.relicRareBias = Math.max(0, G.state.relicRareBias - 20);
    var pool = G.RELICS.filter(function (x) { return x.r === tier && owned.indexOf(x.id) < 0; });
    if (!pool.length) pool = G.RELICS.filter(function (x) { return owned.indexOf(x.id) < 0; });
    return pool.length ? G.pick(pool).id : null;
  };
  G.relicPrice = function (id) {
    var r = G.relicById[id];
    var base = r.r === 'g' ? 300 : r.r === 'b' ? 225 : 150;   /* 金:蓝:白 ≈ 2:1.5:1 */
    return base + G.rnd(40) - 20;
  };

  /* ================= 地图生成（杀戮尖塔式路径播撒 + 规则化房间分配） =================
     结构原则（对齐 StS Act）：
       · 底行全是普通战、顶行首领、首领前一行全篝火、中段一行宝藏；
       · 多条路径从底部向上游走，落点限 c±1 且禁止连线交叉 → 路线清晰不缠绕；
       · 房间类型按规则+权重：前 5 层无精英、前 4 层无篝火/商店、
         篝火不连续、精英不连续、同类不紧邻；全图恰好 3 商店；
       · 每条根→首领路径的篝火数 1~5 且尽量均衡。 */
  var ROWS = 15, COLS = 7, PATHS = 6;
  G.genMap = function () {
    for (var attempt = 0; attempt < 30; attempt++) {
      var map = tryGenMap();
      if (map) return map;
    }
    return tryGenMap(true);
  };
  function tryGenMap(force) {
    var nodes = {};                 /* id -> node */
    function nodeAt(r, c) {
      var id = r + '_' + c;
      if (!nodes[id]) nodes[id] = { r: r, c: c, type: 'fight', edges: [], id: id, cleared: false };
      return nodes[id];
    }
    var edgeSet = {};               /* 记录 r 行 c1->c2 边，用于查交叉 */
    function crosses(r, c1, c2) {
      if (c1 === c2) return false;
      var lo = Math.min(c1, c2), hi = Math.max(c1, c2);
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
    var starts = [];
    for (var p = 0; p < PATHS; p++) {
      var c = (p === 0) ? 1 + G.rnd(COLS - 2) : G.rnd(COLS);
      nodeAt(0, c);
      starts.push(c);
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
    if (!grid[0].length || !grid[ROWS - 2].length) return null;

    /* ---------- 房间类型分配 ---------- */
    var byId = nodes;
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
        var ps = parentsOf(n);
        var parentTypes = ps.map(function (m) { return m.type; });
        var noRest = r < 5 || parentTypes.indexOf('fire') >= 0;         /* 前 5 层无篝火 / 篝火不连续 */
        var noElite = r < 5 || parentTypes.indexOf('elite') >= 0;       /* 前 5 层无精英 / 精英不连续 */
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
      var cand = flat.filter(function (n) { return n.type === 'fight' && n.r >= 4 && n.r <= 12; });
      G.shuffle(cand).slice(0, 3 - shops.length).forEach(function (n) { n.type = 'shop'; });
    }
    /* 约束：每条路径篝火数 1~5 且均衡 */
    if (!balanceFires(grid) && !force) return null;
    return { grid: grid, rows: ROWS };
  }
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
  function balanceFires(grid) {
    var byId = {}; grid.forEach(function (row) { row.forEach(function (n) { byId[n.id] = n; }); });
    for (var iter = 0; iter < 60; iter++) {
      var paths = pathsOf(grid), bad = null;
      paths.forEach(function (path) {
        var fires = path.filter(function (n) { return n.type === 'fire' && n.r < ROWS - 2; });   /* 不含首领前强制篝火 */
        var total = path.filter(function (n) { return n.type === 'fire'; });
        if (total.length > 5) bad = { need: 'del', fires: fires.length ? fires : total };
        else if (total.length === 0) bad = { need: 'add', path: path };
      });
      if (!bad) return true;
      if (bad.need === 'add') {
        var c = bad.path.filter(function (n) { return n.type === 'fight' && n.r > 1 && n.r < ROWS - 2; });
        if (c.length) G.pick(c).type = 'fire'; else return true;
      } else {
        if (bad.fires.length) bad.fires[G.rnd(bad.fires.length)].type = 'fight';
        else return true;
      }
    }
    return true;
  }

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
      var bid = ['amarth', 'bauglir', 'dagnir'][Math.min(2, Math.floor(st.act || 0))];
      /* 本作单塔：按已过 boss 数选，简单起见随机其一但记录 */
      bid = st.bossId || G.pick(['amarth', 'bauglir', 'dagnir']);
      enemies.push(newEnemy(bid, true, depth));
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
    /* 格挡清空（壁垒/符文金字塔例外） */
    if (!p.buffs.barr) p.block = 0;
    /* 能量 */
    p.energy = p.maxEnergy;
    if (first && G.hasRelic('lantern')) p.energy += G.relicById.lantern.v;
    if (G.hasRelic('sozu')) {}
    /* 抽牌 */
    var dn = cb.handSize;
    if (first) {
      if (G.hasRelic('anchor')) p.block += G.relicById.anchor.v;
      if (G.hasRelic('dagger')) dn += G.relicById.dagger.v;
      cb.draw = orderInnate(cb.draw);
    }
    if (G.hasRelic('pocketwatch') && cb.lastTurnPlayed <= 3 && !first) dn += 3;
    drawCards(dn);
    /* 毒 */
    cb.enemies.concat([{ buffs: p.buffs, isP: true }]).forEach(function () {});
    applyPoison(p, true);
    cb.enemies.forEach(function (e) { applyPoison(e, false); if (!e.dead) rollIntent(e); });
    /* 力量per回合（恶魔形态） */
    if (p.buffs._demonPerTurn) p.buffs.str = (p.buffs.str || 0) + p.buffs._demonPerTurn;
    /* 圣物：回合开始 */
    if (G.hasRelic('mercuryhg')) cb.enemies.forEach(function (e) { if (!e.dead) dealToEnemy(e, G.relicById.mercuryhg.v, true); });
    if (G.hasRelic('darkstone')) { drawCards(1); if (cb.hand.length) { cb.discard.push(cb.hand.pop()); } }
    checkDead();
    G.emit('turnStart', { turn: cb.turn, first: first });
  }
  function orderInnate(pile) {
    var innate = [], rest = [];
    pile.forEach(function (c) { (c.kw.indexOf('innate') >= 0 ? innate : rest).push(c); });
    return innate.concat(rest);
  }
  function applyPoison(unit, isPlayer) {
    var b = unit.buffs;
    if (b.poison) {
      if (isPlayer) G.state.hp = Math.max(0, G.state.hp - b.poison);
      else unit.hp = Math.max(0, unit.hp - b.poison);
      b.poison -= 1; if (b.poison <= 0) delete b.poison;
    }
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
      if (G.hasRelic('selfformingclay')) cb.player._clayNext = 3;
      G.emit('playerHurt', d);
    }
    if (G.state.hp <= 0) endCombat(false);
  };
  G.heal = function (n) { G.state.hp = Math.min(G.state.maxHp, G.state.hp + n); };

  function checkDead() {
    var cb = G.state.combat;
    if (cb.enemies.every(function (e) { return e.dead; })) endCombat(true);
  }

  /* ---------- 敌人意图 ---------- */
  function rollIntent(e) {
    e.turnNo++;
    var d = e.def, ai = d.ai, str = e.buffs.str || 0, dep = G.state.depth;
    function atk(v) { return { type: 'attack', val: v + str, cn: '攻击' }; }
    function atkDeb(v, buff, amt) { return { type: 'attackdebuff', val: v + str, buff: buff, amt: amt, cn: '攻击+' + G.BUFFS[buff].name }; }
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
  /* 首领机制：Amarth 命运——第 5、10 回合触发最终测验，回合数过多直接命运斩杀 */
  function amarthIntent(e, base) {
    var t = e.turnNo;
    if (t === 5 || t === 10) { e.intent = { type: 'exam', cn: '最终测验', val: 0 }; return; }
    e.meta.doom = (e.meta.doom || 0);
    if (t >= 13) { e.intent = { type: 'attack', val: 40, cn: '命运降临', doom: true }; return; }
    e.intent = t % 3 === 0 ? { type: 'attackdebuff', val: base + 6, buff: 'weak', amt: 2, cn: '攻击+虚弱' }
      : (t % 3 === 1 ? { type: 'attack', val: base + 8, cn: '攻击' } : { type: 'buff', buff: 'str', amt: 3, cn: '力量' });
  }
  /* Bauglir 暴君：召唤锁链（获得格挡）+ 阶段转换，第 6 回合最终测验 */
  function bauglirIntent(e, base) {
    var t = e.turnNo;
    if (t === 6) { e.intent = { type: 'exam', cn: '最终测验', val: 0 }; return; }
    if (e.hp < e.maxHp * 0.5 && !e.meta.enraged) { e.meta.enraged = true; e.buffs.str = (e.buffs.str || 0) + 4; }
    if (t % 4 === 0) e.intent = { type: 'defend', val: 20, cn: '锁链' };
    else e.intent = { type: 'attackdebuff', val: base + 7 + (e.buffs.str || 0), buff: 'frail', amt: 2, cn: '攻击+脆弱' };
  }
  /* Dagnir 灾祸：中毒叠加 + 复活一次，第 7 回合最终测验 */
  function dagnirIntent(e, base) {
    var t = e.turnNo;
    if (t === 7) { e.intent = { type: 'exam', cn: '最终测验', val: 0 }; return; }
    if (t % 3 === 0) e.intent = { type: 'poison', amt: 3 + Math.floor(t / 3), cn: '剧毒' };
    else e.intent = { type: 'attack', val: base + 6 + (e.buffs.str || 0), cn: '攻击' };
  }

  /* ---------- 打出卡牌 ---------- */
  G.canPlay = function (c) {
    var cb = G.state.combat; if (!cb || cb.ended) return false;
    return cb.player.energy >= G.cardCost(c);
  };
  G.playCard = function (c, targetUid) {
    var cb = G.state.combat, p = cb.player;
    if (!G.canPlay(c)) return false;
    var idx = cb.hand.indexOf(c); if (idx < 0) return false;
    var e = G.cardEff(c), type = G.cardType(c);
    p.energy -= G.cardCost(c);
    cb.hand.splice(idx, 1);
    cb.playedThisTurn++; cb.playCountTotal++;
    if (type === 'attack') cb.attacksThisTurn++;
    if (type === 'skill') cb.skillsThisTurn++;
    var target = targetUid ? cb.enemies.filter(function (x) { return x.uid === targetUid; })[0] : null;

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
      var targets = e.aoe ? enemies : (target ? [target] : (enemies.length === 1 ? [enemies[0]] : []));
      for (var h = 0; h < hits; h++) targets.forEach(function (en) { if (!en.dead || e.aoe) hitEnemy(en, e.dmg); });
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
    if (e.burnDiscard) {}
    /* buff 施加 */
    (e.applies || []).forEach(function (a) {
      if (a.self) {
        if (a.perTurn) p.buffs._demonPerTurn = (p.buffs._demonPerTurn || 0) + a.amt;
        else addBuff(p.buffs, a.buff, a.amt);
      } else {
        var ts = e.aoe ? enemies : (target ? [target] : enemies);
        ts.forEach(function (en) { addBuff(en.buffs, a.buff, a.amt); });
      }
    });
  }
  G.damagePlayerRaw = function (n) { G.state.hp = Math.max(0, G.state.hp - n); if (G.state.hp <= 0) endCombat(false); };
  function addBuff(buffs, id, amt) {
    buffs[id] = (buffs[id] || 0) + amt;
    if (buffs[id] <= 0 && (id === 'str' || id === 'dex')) { /* 允许负力量 */ }
    if (buffs[id] === 0) delete buffs[id];
  }

  /* ---------- 结束回合 → 敌人行动 ---------- */
  G.endTurn = function () {
    var cb = G.state.combat, p = cb.player;
    if (cb.ended) return;
    /* 回合结束结算 */
    if (p.buffs.meta) p.block += p.buffs.meta;
    if (p.buffs.regen) { G.heal(p.buffs.regen); }
    if (G.hasRelic('orichalcum') && p.block === 0) p.block += G.relicById.orichalcum.v;
    if (p.buffs._clayNext) { p._clayPending = p.buffs._clayNext; delete p.buffs._clayNext; }
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
      if (cb.ended) return;
      if (i >= order.length) { afterEnemies(); return; }
      var e = order[i++];
      if (e.dead) { step(); return; }
      enemyAct(e, function () { setTimeout(step, 260); });
    }
    step();
  };
  function enemyAct(e, done) {
    var it = e.intent; if (!it) { done(); return; }
    G.emit('enemyActStart', e);
    /* 结算顺序：先攻击后易伤（修 round16 bug） */
    function attackThenDebuff(val, buff, amt) {
      var dmg = G.atkDamage(val - (e.buffs.str || 0), e.buffs, G.state.combat.player.buffs);
      G.damagePlayer(dmg);
      if (buff) addBuff(G.state.combat.player.buffs, buff, amt);
    }
    if (it.type === 'attack') {
      var d = G.atkDamage(it.val - (e.buffs.str || 0), e.buffs, G.state.combat.player.buffs);
      G.damagePlayer(d);
    } else if (it.type === 'attackdebuff') {
      attackThenDebuff(it.val, it.buff, it.amt);
    } else if (it.type === 'defend') {
      e.block += it.val;
    } else if (it.type === 'buff') {
      addBuff(e.buffs, it.buff, it.amt);
    } else if (it.type === 'poison') {
      addBuff(G.state.combat.player.buffs, 'poison', it.amt);
    } else if (it.type === 'exam') {
      G.emit('bossExam', e);       /* UI 弹出测验；结算在 G.resolveExam */
      return;                       /* 等待玩家答题回调再 done */
    }
    decayBuffs(e.buffs);
    G.emit('enemyActEnd', e);
    done();
  }
  G._enemyContinue = null;
  function afterEnemies() {
    var cb = G.state.combat;
    if (cb.ended) return;
    if (cb.player._clayPending) { cb.player.block += cb.player._clayPending; cb.player._clayPending = 0; }
    checkDead();
    if (!cb.ended) startTurn(false);
  }
  function decayBuffs(buffs) {
    ['vuln', 'weak', 'frail', 'regen', 'intan'].forEach(function (k) {
      if (buffs[k]) { buffs[k] -= 1; if (buffs[k] <= 0) delete buffs[k]; }
    });
  }

  /* ---------- 最终测验（首领机制） ---------- */
  G.buildExam = function () {
    var deck = G.state.deck.slice();
    var known = deck.filter(function (c) { return G.cardKnown(c); });
    var weakCard = G.pick((known.length ? known : deck));
    var strongCard = G.pick(deck.filter(function (c) { return c.uid !== weakCard.uid; }).concat([weakCard]));
    /* 弱测验：词义多选；强测验：构词多选 */
    var meaning = { kind: 'meaning', q: weakCard.word.w, correct: weakCard.word.cn,
      opts: G.shuffle([weakCard.word.cn].concat(G.distractorsCn(weakCard.word.cn, 3))) };
    var form = G.formQuiz(strongCard.word);
    form.kind = 'form';
    return { meaning: meaning, form: form };
  };
  G.resolveExam = function (e, meaningOK, formOK) {
    var cb = G.state.combat;
    var right = (meaningOK ? 1 : 0) + (formOK ? 1 : 0);
    if (right === 2) { addBuff(e.buffs, 'weak', 2); G.emit('examResult', { e: e, r: 'pass' }); }
    else if (right === 1) { G.damagePlayerRaw(5); G.emit('examResult', { e: e, r: 'half' }); }
    else { var pb = cb.player.buffs; addBuff(pb, 'frail', 2); addBuff(pb, 'weak', 2); addBuff(pb, 'vuln', 2); G.emit('examResult', { e: e, r: 'fail' }); }
    cb.examDone = true;
    decayBuffs(e.buffs);
    G.emit('enemyActEnd', e);
    /* 继续敌人流程 */
    setTimeout(function () { if (!cb.ended) startTurnAfterExam(); }, 200);
  };
  function startTurnAfterExam() { afterEnemies(); }

  /* ---------- 战斗结束 ---------- */
  function endCombat(won) {
    var cb = G.state.combat;
    if (cb.ended) return;
    cb.ended = true; cb.won = won;
    if (won) {
      if (G.hasRelic('burningblood')) G.heal(G.relicById.burningblood.v);
      G.state.gold += 10 + G.rnd(11) + (cb.kind === 'elite' ? 20 : 0) + (cb.kind === 'boss' ? 40 : 0);
    }
    G.emit('combatEnd', { won: won, kind: cb.kind });
  }

  /* ---------- 学习：初次学习（战斗后卡奖励触发） ---------- */
  G.buildFirstLearn = function () {
    var deck = G.state.deck;
    var cands = deck.filter(function (c) { return !G.state.learnedThisRun[c.uid] && c.lvl < 1; });
    if (!cands.length) cands = deck.filter(function (c) { return !G.state.learnedThisRun[c.uid]; });
    if (!cands.length) return null;
    var card = G.pick(cands);
    return { card: card, q: card.word.w,
      correct: card.word.cn, opts: G.shuffle([card.word.cn].concat(G.distractorsCn(card.word.cn, 3))) };
  };
  G.applyFirstLearn = function (card, ok) {
    G.state.learnedThisRun[card.uid] = true;
    if (ok) {
      if (card.lvl < 1) card.lvl = 1;
      var bonus = G.hasRelic('ancientinkwell') ? 2 : 1;
      G.manualSet(card.word.w, Math.max(1, G.manualStar(card.word.w)));
      G.emit('cardUpgraded', { card: card, to: 1, bonus: bonus });
    }
  };
  /* 篝火复习：自选两张弱强化卡，构词测验，成功→强强化 */
  G.reviewCandidates = function () { return G.state.deck.filter(function (c) { return c.lvl === 1; }); };
  G.applyReview = function (card, ok) {
    if (ok) {
      card.lvl = 2;
      G.manualSet(card.word.w, 2);
      G.emit('cardUpgraded', { card: card, to: 2 });
    }
    return ok;
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
