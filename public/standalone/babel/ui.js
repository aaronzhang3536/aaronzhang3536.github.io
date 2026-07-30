/* 巴别塔 —— 表现层：屏幕路由 / 战斗渲染 / 拖拽出牌 / 动画 / 粒子 / 弹窗 */
(function (G) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('screen'), fx = $('fx'), modal = $('modal'), toastEl = $('toast');
  var isTouch = matchMedia('(hover: none)').matches;

  var EMOJI = { player: '🧙', louse: '🐛', slime: '🫧', cultist: '🧛', fungus: '🍄', jaw: '👹', sentry: '🗿', gremlin: '👺', knight: '🛡️', amarth: '💀', bauglir: '👿', dagnir: '🐉' };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function toast(msg, ms) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1600); }
  G.toast = toast;

  /* ---------- 居中飞字（打牌/回合横幅） ---------- */
  function centerText(txt, cls) {
    var b = el('div', 'center-flash ' + (cls || ''), txt);
    fx.appendChild(b);
    setTimeout(function () { b.classList.add('go'); }, 20);
    setTimeout(function () { b.remove(); }, 1100);
  }
  /* ---------- 粒子（死亡消散 / 消耗溶解 / 升级） ---------- */
  function burst(x, y, color, n) {
    for (var i = 0; i < (n || 26); i++) {
      var p = el('div', 'particle');
      var a = Math.random() * 6.283, sp = 30 + Math.random() * 120;
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = color;
      p.style.setProperty('--dx', (Math.cos(a) * sp) + 'px');
      p.style.setProperty('--dy', (Math.sin(a) * sp) + 'px');
      fx.appendChild(p);
      setTimeout((function (pp) { return function () { pp.remove(); }; })(p), 850);
    }
  }
  function rectCenter(node) { var r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /* ================= 屏幕路由 ================= */
  G.go = function (name, arg) {
    clear(screen);
    screen.dataset.screen = name;
    ({ title: renderTitle, map: renderMap, combat: renderCombat, reward: renderReward,
      campfire: renderCampfire, shop: renderShop, event: renderEvent, treasure: renderTreasure,
      gameover: renderGameover })[name](arg);
  };

  /* ---------- 标题 ---------- */
  function renderTitle() {
    var w = el('div', 'ti-wrap');
    var learned = Object.keys(G.manual).length;
    var stars3 = Object.keys(G.manual).filter(function (k) { return G.manual[k] >= 3; }).length;
    w.innerHTML =
      '<div class="ti-glow"></div>' +
      '<h1 class="ti-title">巴别塔</h1>' +
      '<div class="ti-sub">Tower&nbsp;of&nbsp;Babel — 一座用词汇筑成的塔</div>' +
      '<p class="ti-lead">一层层向上攀爬，用英语的词汇武装自己。<br>战斗中学习，学会的词让你的卡牌更强——学识即力量。</p>' +
      '<div class="ti-stat mono">生词手册：已识 ' + learned + ' 词 · 精通 ' + stars3 + ' 词</div>' +
      '<div class="ti-btns">' +
      '<button class="btn primary" id="ti-start">开始攀登</button>' +
      '<button class="btn" id="ti-manual">生词手册</button>' +
      '<button class="btn ghost" id="ti-reset">重置记录</button>' +
      '</div>';
    screen.appendChild(w);
    $('ti-start').onclick = function () { G.startRun(); G.go('map'); };
    $('ti-manual').onclick = showManual;
    $('ti-reset').onclick = function () {
      confirmModal('确定重置生词手册？所有单词的词义与星级都会清空。', function () { G.manualReset(); toast('生词手册已清空'); G.go('title'); });
    };
  }
  function showManual() {
    var words = Object.keys(G.manual).sort();
    var body = el('div', 'manual-wrap');
    body.innerHTML = '<h3>生词手册 <span class="mono">' + words.length + ' 词</span></h3>' +
      '<div class="manual-hint mono">★ 弱强化 · ★★ 篝火复习 · ★★★ 最终测验精通</div>';
    var grid = el('div', 'manual-grid');
    if (!words.length) grid.innerHTML = '<div class="dim">还没有学会任何单词，去塔里战斗吧。</div>';
    words.forEach(function (k) {
      var rec = G.wordByKey[k], star = G.manual[k];
      var it = el('div', 'manual-it' + (star >= 3 ? ' mastered' : ''));
      it.innerHTML = '<b>' + k + '</b><i>' + '★'.repeat(star) + '</i><span>' + (rec ? rec.cn : '') + '</span>';
      grid.appendChild(it);
    });
    body.appendChild(grid);
    openModal(body);
  }

  /* ================= 地图 ================= */
  function nodeIcon(t) { return { fight: '⚔', pack: '⚔', elite: '☠', boss: '👑', fire: '🔥', shop: '🛒', treasure: '💎', event: '❓' }[t] || '⚔'; }
  function nodeColor(t) { return { fight: '#c9d3df', elite: '#ff8f6b', boss: '#ff5ca8', fire: '#ffb347', shop: '#5fd0ff', treasure: '#ffcf40', event: '#9d86d9' }[t] || '#c9d3df'; }
  function nodeCn(t) { return { fight: '战斗', pack: '群战', elite: '精英', boss: '首领', fire: '篝火', shop: '商店', treasure: '宝藏', event: '奇遇' }[t] || '战斗'; }

  function renderMap() {
    var st = G.state;
    var wrap = el('div', 'map-wrap');
    wrap.appendChild(topBar());
    var scroll = el('div', 'map-scroll');
    var canvas = el('div', 'map-canvas');
    var grid = st.map.grid, ROWS = grid.length;
    var COLW = 100, ROWH = 84, PADX = 40;
    canvas.style.height = (ROWS * ROWH + 60) + 'px';
    canvas.style.width = (5 * COLW + PADX * 2) + 'px';
    /* 连线（SVG） */
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'map-lines');
    var reach = G.reachable();
    function pos(n) { return { x: PADX + n.c * COLW + COLW / 2, y: (ROWS - 1 - n.r) * ROWH + 46 }; }
    grid.forEach(function (row) {
      row.forEach(function (n) {
        n.edges.forEach(function (eid) {
          var m = G.nodeById(eid), a = pos(n), b = pos(m);
          var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
          /* 高亮：当前可走的连线用「下一层节点自身颜色」 */
          var isNext = (st.node && st.node.edges.indexOf(eid) >= 0) || (!st.node && n.r === 0 && false);
          var onPath = (n.cleared && m.cleared);
          if (isNext) { line.setAttribute('stroke', nodeColor(m.type)); line.setAttribute('stroke-width', '3'); line.setAttribute('opacity', '0.9'); }
          else if (onPath) { line.setAttribute('stroke', '#ff8a1e'); line.setAttribute('stroke-width', '2'); line.setAttribute('opacity', '0.8'); }
          else { line.setAttribute('stroke', '#2b3549'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('opacity', '0.6'); }
          svg.appendChild(line);
        });
      });
    });
    canvas.appendChild(svg);
    /* 节点 */
    grid.forEach(function (row) {
      row.forEach(function (n) {
        var p = pos(n);
        var reachable = reach.indexOf(n) >= 0;
        var b = el('button', 'map-node' + (n.cleared && st.node === n ? ' current' : '') + (reachable ? ' reach' : '') + (n.cleared ? ' done' : ''));
        b.style.left = (p.x - 26) + 'px'; b.style.top = (p.y - 26) + 'px';
        b.style.setProperty('--nc', nodeColor(n.type));
        b.innerHTML = '<span class="mn-ic">' + nodeIcon(n.type) + '</span>';
        b.title = nodeCn(n.type) + (n.type === 'boss' ? '（' + bossName() + '）' : '');
        if (reachable) b.onclick = function () { chooseNode(n); };
        canvas.appendChild(b);
      });
    });
    scroll.appendChild(canvas);
    wrap.appendChild(scroll);
    screen.appendChild(wrap);
    scroll.scrollTop = scroll.scrollHeight;
  }
  function bossName() { return G.BOSS_DEFS[G.state.bossId || 'amarth'].cn; }

  function chooseNode(n) {
    G.enterNode(n);
    if (n.type === 'fight') G.go('combat', { kind: 'normal', sub: n.sub || 'normal' });
    else if (n.type === 'elite') G.go('combat', { kind: 'elite' });
    else if (n.type === 'boss') G.go('combat', { kind: 'boss' });
    else if (n.type === 'fire') G.go('campfire');
    else if (n.type === 'shop') G.go('shop');
    else if (n.type === 'treasure') G.go('treasure');
    else if (n.type === 'event') G.go('event');
  }

  /* ---------- 顶栏（生命 / 金币 / 圣物） ---------- */
  function topBar() {
    var st = G.state;
    var bar = el('div', 'topbar');
    bar.innerHTML =
      '<div class="tb-left">' +
      '<span class="tb-hp">❤ <b>' + st.hp + '</b>/' + st.maxHp + '</span>' +
      '<span class="tb-gold">🪙 <b>' + st.gold + '</b></span>' +
      '<span class="tb-floor mono">第 ' + (st.floor) + ' 层</span>' +
      '</div>' +
      '<div class="tb-relics" id="tb-relics"></div>' +
      '<div class="tb-right"><button class="btn tiny ghost" id="tb-deck">牌组 ' + st.deck.length + '</button>' +
      '<button class="btn tiny ghost" id="tb-quit">退出</button></div>';
    setTimeout(function () {
      var rc = $('tb-relics');
      st.relics.forEach(function (id) {
        var r = G.relicById[id];
        var s = el('span', 'relic', r.cn[0]);
        s.style.color = G.RELIC_COL[r.r];
        s.style.borderColor = G.RELIC_COL[r.r];
        s.title = r.cn + '：' + r.desc;
        rc.appendChild(s);
      });
      $('tb-deck').onclick = function () { showPile(st.deck, '当前牌组', true); };
      $('tb-quit').onclick = function () {
        confirmModal('退出到标题？本局进度不会保存。', function () { G.state = null; G.go('title'); });
      };
    }, 0);
    return bar;
  }

  /* ================= 战斗 ================= */
  var C = { hovering: null, dragging: null, arrowSVG: null };
  function renderCombat(arg) {
    G.state.bossId = G.state.bossId || G.pick(['amarth', 'bauglir', 'dagnir']);
    buildCombatShell();                       /* 先建 DOM 外壳，容器就位 */
    G.enterCombat(arg.kind, arg.sub);         /* 再进战斗：turnStart 会渲染进已存在的容器 */
    renderPlayer(); renderEnemies(); renderHand(); renderHud();
  }
  function buildCombatShell() {
    clear(screen);
    var wrap = el('div', 'cb-wrap');
    wrap.appendChild(topBar());
    var stage = el('div', 'cb-stage'); stage.id = 'cb-stage';
    stage.innerHTML =
      '<div class="cb-side player" id="cb-player"></div>' +
      '<div class="cb-side enemies" id="cb-enemies"></div>' +
      '<div class="cb-dropzone" id="cb-drop"><span>拖到此处释放技能</span></div>';
    wrap.appendChild(stage);
    var hud = el('div', 'cb-hud');
    hud.innerHTML =
      '<div class="cb-piles">' +
      '<button class="pile mono" id="pl-draw">抽 <b>0</b></button>' +
      '<button class="pile mono" id="pl-disc">弃 <b>0</b></button>' +
      '<button class="pile mono" id="pl-exh">耗 <b>0</b></button>' +
      '</div>' +
      '<div class="cb-energy" id="cb-energy"><span class="en-orb"><b>3</b>/3</span></div>' +
      '<button class="btn end-turn" id="cb-end">结束回合</button>';
    wrap.appendChild(hud);
    var hand = el('div', 'cb-hand'); hand.id = 'cb-hand';
    wrap.appendChild(hand);
    screen.appendChild(wrap);
    $('cb-end').onclick = function () { if (!G.state.combat.ended) G.endTurn(); };
    $('pl-draw').onclick = function () { showPile(G.state.combat.draw, '抽牌堆（乱序）', false, true); };
    $('pl-disc').onclick = function () { showPile(G.state.combat.discard, '弃牌堆', false); };
    $('pl-exh').onclick = function () { showPile(G.state.combat.exhaust, '消耗堆', false); };
  }

  function renderPlayer() {
    var cb = G.state.combat, p = cb.player, box = $('cb-player');
    clear(box);
    var fig = el('div', 'unit-fig player-fig', '<div class="fig-art art-player" data-emoji="' + EMOJI.player + '"></div>');
    var hpbar = unitHpBar(G.state.hp, G.state.maxHp, p.block, p.buffs, '旅人 Wanderer');
    box.appendChild(fig);
    box.appendChild(hpbar);
  }
  function renderEnemies() {
    var cb = G.state.combat, box = $('cb-enemies');
    clear(box);
    cb.enemies.forEach(function (e) {
      var wrap = el('div', 'enemy' + (e.dead ? ' dead' : ''));
      wrap.dataset.uid = e.uid;
      var intentHtml = e.dead ? '' : intentBadge(e);
      wrap.innerHTML =
        '<div class="intent">' + intentHtml + '</div>' +
        '<div class="unit-fig enemy-fig' + (e.isBoss ? ' boss' : '') + '"><div class="fig-art art-' + e.art + '" data-emoji="' + (EMOJI[e.defId] || '👾') + '"></div></div>';
      wrap.appendChild(unitHpBar(e.hp, e.maxHp, e.block, e.buffs, e.cn + (e.isBoss ? '' : '')));
      /* 命中 / 目标高亮 */
      if (!e.dead) {
        wrap.onmouseenter = function () { C.hovering = e.uid; refreshHandPreview(); };
        wrap.onmouseleave = function () { C.hovering = null; refreshHandPreview(); };
        if (isTouch) wrap.onclick = function () { tapEnemy(e); };
      }
      box.appendChild(wrap);
    });
  }
  function intentBadge(e) {
    var it = e.intent; if (!it) return '';
    var num = '';
    if (it.type === 'attack' || it.type === 'attackdebuff') {
      var baseNoStr = it.val - (e.buffs.str || 0);
      var shown = G.atkDamage(baseNoStr, e.buffs, G.state.combat.player.buffs);   /* 动态：玩家易伤/敌人虚弱都反映 */
      num = '<b>' + shown + '</b>';
      var ic = it.type === 'attackdebuff' ? '⚔+' : '⚔';
      return '<span class="int-ic atk">' + ic + '</span>' + num;
    }
    if (it.type === 'defend') return '<span class="int-ic def">🛡</span><b>' + it.val + '</b>';
    if (it.type === 'buff') return '<span class="int-ic buf">⬆</span>';
    if (it.type === 'poison') return '<span class="int-ic psn">☠</span><b>' + it.amt + '</b>';
    if (it.type === 'exam') return '<span class="int-ic exam">📖</span>';
    return '<span class="int-ic">…</span>';
  }
  function unitHpBar(hp, maxHp, block, buffs, name) {
    var box = el('div', 'hpwrap');
    var pct = Math.max(0, hp / maxHp * 100);
    box.innerHTML =
      '<div class="uname mono">' + name + '</div>' +
      '<div class="hpbar"><div class="hpfill" style="width:' + pct + '%"></div>' +
      '<span class="hptext mono">' + hp + '/' + maxHp + '</span></div>' +
      (block > 0 ? '<div class="block-badge" title="格挡">🛡 ' + block + '</div>' : '') +
      '<div class="buffs">' + buffRow(buffs) + '</div>';
    return box;
  }
  function buffRow(buffs) {
    var out = '';
    Object.keys(buffs).forEach(function (k) {
      if (k[0] === '_') return;
      var def = G.BUFFS[k]; if (!def) return;
      out += '<span class="buff ' + (def.good ? 'good' : 'bad') + '" title="' + def.name + '：' + def.desc + '">' + def.icon + '<i>' + buffs[k] + '</i></span>';
    });
    return out;
  }

  function renderHud() {
    var cb = G.state.combat, p = cb.player;
    $('pl-draw').querySelector('b').textContent = cb.draw.length;
    $('pl-disc').querySelector('b').textContent = cb.discard.length;
    $('pl-exh').querySelector('b').textContent = cb.exhaust.length;
    $('cb-energy').innerHTML = '<span class="en-orb"><b>' + p.energy + '</b>/' + p.maxEnergy + '</span>';
  }

  /* ---------- 手牌 ---------- */
  function renderHand() {
    var cb = G.state.combat, hand = $('cb-hand');
    clear(hand);
    cb.hand.forEach(function (c, i) {
      var card = cardEl(c, true);
      card.style.setProperty('--i', i);
      card.dataset.uid = c.uid;
      hand.appendChild(card);
      wireCard(card, c);
    });
    refreshHandPreview();
  }
  function cardEl(c, inHand) {
    var def = G.cardDefById[c.defId];
    var e = G.cardEff(c), type = G.cardType(c), rarity = G.cardRarity(c);
    var known = G.cardKnown(c);
    var card = el('div', 'card t-' + type + ' r-' + rarity + (c.lvl >= 3 ? ' mastered' : c.lvl === 2 ? ' up2' : c.lvl === 1 ? ' up1' : ''));
    var stars = c.lvl > 0 ? '<span class="cd-stars">' + '★'.repeat(Math.min(3, c.lvl)) + '</span>' : '';
    card.innerHTML =
      '<div class="cd-cost">' + G.cardCost(c) + '</div>' +
      stars +
      '<div class="cd-word">' + c.word.w + '</div>' +
      '<div class="cd-ipa mono">' + (c.word.ipa ? '/' + c.word.ipa + '/' : '') + '</div>' +
      '<div class="cd-art art-card-' + type + '"></div>' +
      '<div class="cd-cn">' + (known ? c.word.cn : '<i class="dim">词义未掌握</i>') + '</div>' +
      '<div class="cd-txt">' + cardText(c, e, type) + '</div>' +
      '<div class="cd-type mono">' + typeCn(type) + kwText(c) + '</div>';
    return card;
  }
  function typeCn(t) { return { attack: '攻击', skill: '技能', power: '能力' }[t] || t; }
  function kwText(c) {
    var m = { exhaust: '· 消耗', innate: '· 固有', retain: '· 保留' };
    return c.kw.map(function (k) { return m[k] || ''; }).join(' ');
  }
  function cardText(c, e, type, tgtBuffs) {
    var p = G.state.combat ? G.state.combat.player : { buffs: {} };
    var parts = [];
    if (e.dmg) {
      var dv = G.atkDamage(e.dmg, p.buffs, tgtBuffs || null);
      parts.push('造成 <b class="dmg">' + dv + '</b>' + (e.hits ? '×' + e.hits : '') + ' 伤害' + (e.aoe ? '(群体)' : ''));
    }
    if (e.blk) parts.push('获得 <b class="blk">' + G.blockGain(e.blk, p.buffs) + '</b> 格挡');
    if (e.blkDouble) parts.push('格挡翻倍');
    if (e.draw) parts.push('抽 ' + e.draw + ' 张');
    if (e.energy) parts.push('+' + e.energy + ' 能量');
    if (e.loseHp) parts.push('失去 ' + e.loseHp + ' 生命');
    (e.applies || []).forEach(function (a) {
      var nm = G.BUFFS[a.buff] ? G.BUFFS[a.buff].name : a.buff;
      parts.push((a.self ? '自身' : '') + (a.amt < 0 ? '' : '+') + a.amt + ' ' + nm + (a.perTurn ? '/回合' : ''));
    });
    if (e.lifesteal) parts.push('伤害吸血');
    if (e.feed) parts.push('击杀+' + e.feed + '最大生命');
    if (e.burnDiscard) parts.push('弃全部手牌');
    return parts.join('，');
  }

  function refreshHandPreview() {
    var cb = G.state.combat; if (!cb) return;
    var hoverE = C.hovering ? cb.enemies.filter(function (x) { return x.uid === C.hovering; })[0] : null;
    Array.prototype.forEach.call($('cb-hand').children, function (node) {
      var uid = node.dataset.uid, c = cb.hand.filter(function (x) { return x.uid === uid; })[0];
      if (!c) return;
      var e = G.cardEff(c), type = G.cardType(c);
      var tgtBuffs = (type === 'attack' && hoverE) ? hoverE.buffs : null;
      var txt = node.querySelector('.cd-txt');
      if (txt) txt.innerHTML = cardText(c, e, type, tgtBuffs);
      node.classList.toggle('unplayable', !G.canPlay(c));
    });
  }

  /* ---------- 出牌交互：桌面拖拽 / 触屏点选 ---------- */
  function wireCard(node, c) {
    node.onmouseenter = function () { if (!C.dragging) node.classList.add('hover'); };
    node.onmouseleave = function () { node.classList.remove('hover'); };
    node.oncontextmenu = function (ev) { ev.preventDefault(); showCardDetail(c); };
    if (isTouch) {
      node.onclick = function () { tapCard(c, node); };
    } else {
      node.onpointerdown = function (ev) { startDrag(ev, c, node); };
    }
  }
  var tapSelected = null;
  function tapCard(c, node) {
    var type = G.cardType(c);
    if (!G.canPlay(c)) { toast('能量不足'); return; }
    if (type === 'attack' && needsTarget()) {
      tapSelected = c;
      Array.prototype.forEach.call($('cb-hand').children, function (n) { n.classList.remove('sel'); });
      node.classList.add('sel');
      toast('选择要攻击的敌人');
    } else {
      doPlay(c, needsTarget() && type === 'attack' ? soleEnemy() : null, node);
    }
  }
  function tapEnemy(e) {
    if (tapSelected) { var c = tapSelected; tapSelected = null; doPlay(c, e.uid, cardNode(c.uid)); }
  }
  function needsTarget() { return G.state.combat.enemies.filter(function (e) { return !e.dead; }).length > 1; }
  function soleEnemy() { var a = G.state.combat.enemies.filter(function (e) { return !e.dead; }); return a.length ? a[0].uid : null; }
  function cardNode(uid) { return Array.prototype.filter.call($('cb-hand').children, function (n) { return n.dataset.uid === uid; })[0]; }

  function startDrag(ev, c, node) {
    if (!G.canPlay(c)) { toast('能量不足'); return; }
    ev.preventDefault();
    C.dragging = { c: c, node: node, type: G.cardType(c) };
    node.classList.add('dragging');
    node.style.pointerEvents = 'none';   /* 关键：让 elementFromPoint 穿透卡片看到背后的敌人 */
    $('cb-drop').classList.toggle('show', C.dragging.type !== 'attack');
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragUp);
    onDragMove(ev);
  }
  function onDragMove(ev) {
    if (!C.dragging) return;
    var node = C.dragging.node;
    node.style.position = 'fixed';
    node.style.left = (ev.clientX - 55) + 'px';
    node.style.top = (ev.clientY - 75) + 'px';
    node.style.zIndex = 200;
    node.style.transform = 'none';
    /* 命中判定 */
    var over = document.elementFromPoint(ev.clientX, ev.clientY);
    var enemyEl = over && over.closest ? over.closest('.enemy') : null;
    C.hovering = enemyEl && !enemyEl.classList.contains('dead') ? enemyEl.dataset.uid : null;
    document.querySelectorAll('.enemy').forEach(function (n) { n.classList.toggle('target', n.dataset.uid === C.hovering); });
    var drop = $('cb-drop');
    var overDrop = over && over.closest && over.closest('#cb-drop');
    if (C.dragging.type !== 'attack') drop.classList.toggle('active', !!overDrop || inStage(ev));
    refreshHandPreview();
  }
  function inStage(ev) {
    var r = $('cb-stage').getBoundingClientRect();
    return ev.clientY < r.bottom && ev.clientY > r.top;
  }
  function onDragUp(ev) {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragUp);
    var d = C.dragging; C.dragging = null;
    $('cb-drop').classList.remove('show', 'active');
    document.querySelectorAll('.enemy').forEach(function (n) { n.classList.remove('target'); });
    if (!d) return;
    var played = false;
    if (d.type === 'attack') {
      var tgt = C.hovering;
      /* 兜底：单敌时拖到战斗区任意处即锁定唯一敌人，避免非要精准压中 */
      if (!tgt && !needsTarget() && inStage(ev)) tgt = soleEnemy();
      if (tgt) { doPlay(d.c, tgt, d.node); played = true; }
    } else {
      if (inStage(ev)) { doPlay(d.c, null, d.node); played = true; }
    }
    if (!played) { d.node.classList.remove('dragging'); resetCardPos(d.node); renderHand(); }
    C.hovering = null;
  }
  function resetCardPos(node) { node.style.position = ''; node.style.left = ''; node.style.top = ''; node.style.zIndex = ''; node.style.transform = ''; node.style.pointerEvents = ''; }

  function doPlay(c, targetUid, node) {
    var type = G.cardType(c), e = G.cardEff(c);
    /* 攻击动画：卡片飞向目标 */
    centerText(c.word.w + (G.cardKnown(c) ? ' · ' + c.word.cn : ''), 'play-word');
    var ok = G.playCard(c, targetUid);
    if (!ok) { renderHand(); return; }
    if (type === 'attack' && targetUid) {
      var en = document.querySelector('.enemy[data-uid="' + targetUid + '"]');
      if (en) { en.classList.add('hit'); setTimeout(function () { en.classList.remove('hit'); }, 260); }
    }
    afterAction();
  }
  function afterAction() {
    if (G.state.combat.ended) return;
    renderPlayer(); renderEnemies(); renderHand(); renderHud();
  }

  /* ---------- 战斗事件订阅 ---------- */
  G.on('turnStart', function (d) {
    if (!screen.dataset.screen || screen.dataset.screen !== 'combat') return;
    renderPlayer(); renderEnemies(); renderHand(); renderHud();
    centerText('第 ' + d.turn + ' 回合', 'turn-banner');
  });
  G.on('enemyHit', function (d) { });
  G.on('enemyDead', function (e) {
    var node = document.querySelector('.enemy[data-uid="' + e.uid + '"]');
    if (node) { var c = rectCenter(node); burst(c.x, c.y, '#ff6b6b', 40); node.classList.add('dying'); }
  });
  G.on('cardExhaust', function (c) { /* 溶解特效由打牌处触发 */ });
  G.on('playerHurt', function (d) {
    var pl = $('cb-player'); if (pl) { pl.classList.add('shake'); setTimeout(function () { pl.classList.remove('shake'); }, 300); }
  });
  G.on('cardUpgraded', function (d) {
    centerText('✦ 强化！' + d.card.word.w + ' ' + '★'.repeat(d.to), 'upgrade');
  });
  G.on('turnEnd', function () { if (screen.dataset.screen === 'combat') { renderEnemies(); renderHud(); } });
  G.on('enemyActStart', function (e) {
    var node = document.querySelector('.enemy[data-uid="' + e.uid + '"]');
    if (node) { node.classList.add('acting'); setTimeout(function () { node.classList.remove('acting'); }, 300); }
  });
  G.on('enemyActEnd', function () { if (screen.dataset.screen === 'combat') { renderPlayer(); renderEnemies(); renderHud(); } });
  G.on('bossExam', function (e) { openExam(e); });
  G.on('combatEnd', function (d) {
    setTimeout(function () {
      if (d.won) {
        if (d.kind === 'boss') { G.go('gameover', { win: true }); return; }
        G.go('reward', { kind: d.kind });
      } else {
        G.go('gameover', { win: false });
      }
    }, 700);
  });

  /* ---------- 首领台词 + 最终测验 ---------- */
  function openExam(e) {
    var lines = e.def.lines || {};
    var exam = G.buildExam();
    var stepM = { done: false, ok: false }, stepF = { done: false, ok: false };
    var body = el('div', 'exam-wrap');
    body.innerHTML = '<div class="exam-boss">' + (lines.open || '接受测验！') + '</div>' +
      '<h3>最终测验 · 第一题（词义）</h3>' +
      '<div class="exam-q mono">' + exam.meaning.q + '</div>' +
      '<div class="exam-opts" id="exam-opts"></div>';
    function renderOpts(quiz, onPick) {
      var box = body.querySelector('#exam-opts'); clear(box);
      quiz.opts.forEach(function (o) {
        var b = el('button', 'exam-opt', o);
        b.onclick = function () {
          var correct = (o === quiz.correct);
          b.classList.add(correct ? 'right' : 'wrong');
          if (!correct) { Array.prototype.forEach.call(box.children, function (n) { if (n.textContent === quiz.correct) n.classList.add('right'); }); }
          Array.prototype.forEach.call(box.children, function (n) { n.disabled = true; });
          setTimeout(function () { onPick(correct); }, 700);
        };
        box.appendChild(b);
      });
    }
    renderOpts(exam.meaning, function (ok) {
      stepM.ok = ok;
      body.querySelector('h3').textContent = '最终测验 · 第二题（' + exam.form.label + '）';
      body.querySelector('.exam-q').textContent = exam.form.q;
      renderOpts(exam.form, function (ok2) {
        stepF.ok = ok2;
        var res = el('div', 'exam-res');
        var right = (stepM.ok ? 1 : 0) + (stepF.ok ? 1 : 0);
        var line = right === 2 ? lines.pass : right === 0 ? lines.fail : '……';
        res.innerHTML = '<div class="exam-boss">' + line + '</div><div class="mono">答对 ' + right + '/2</div>' +
          '<button class="btn primary" id="exam-ok">继续</button>';
        body.appendChild(res);
        $('exam-ok').onclick = function () { closeModal(); G.resolveExam(e, stepM.ok, stepF.ok); };
      });
    });
    openModal(body, true);
  }

  /* ================= 战斗奖励 + 初次学习 ================= */
  function renderReward(arg) {
    var st = G.state;
    var wrap = el('div', 'reward-wrap');
    wrap.appendChild(topBar());
    var inner = el('div', 'reward-inner');
    inner.innerHTML = '<h2>战斗胜利</h2><p class="dim mono">选择一张卡牌加入牌组，或跳过</p>';
    var opts = el('div', 'reward-cards');
    var pool = G.CARD_DEFS.filter(function (d) { return !d.starter; });
    var picks = [];
    /* 稀有度权重 */
    for (var k = 0; k < 3; k++) {
      var roll = Math.random();
      var rar = roll < 0.62 ? 'common' : roll < 0.9 ? 'uncommon' : 'rare';
      var cands = pool.filter(function (d) { return d.rarity === rar; });
      picks.push(G.makeCard(G.pick(cands).id));
    }
    picks.forEach(function (c) {
      var ce = cardEl(c, false);
      ce.classList.add('reward-card');
      ce.onclick = function () { st.deck.push(c); afterPick(); };
      ce.oncontextmenu = function (ev) { ev.preventDefault(); showCardDetail(c); };
      opts.appendChild(ce);
    });
    inner.appendChild(opts);
    var skip = el('button', 'btn ghost', '跳过');
    skip.onclick = function () { afterPick(); };
    inner.appendChild(skip);
    /* 金币奖励提示 */
    wrap.appendChild(inner);
    screen.appendChild(wrap);

    function afterPick() {
      /* 初次学习：随机抽一张未学卡考词义 */
      var fl = G.buildFirstLearn();
      if (!fl) { G.go('map'); return; }
      openFirstLearn(fl);
    }
  }
  function openFirstLearn(fl) {
    var body = el('div', 'learn-wrap');
    body.innerHTML = '<h3>初次学习</h3><p class="dim">这个词是什么意思？答对则该卡获得弱强化 ★</p>' +
      '<div class="learn-word">' + fl.card.word.w + '<span class="mono">' + (fl.card.word.ipa ? '/' + fl.card.word.ipa + '/' : '') + '</span></div>' +
      '<div class="learn-opts" id="learn-opts"></div>';
    var box = body.querySelector('#learn-opts');
    fl.opts.forEach(function (o) {
      var b = el('button', 'learn-opt', o);
      b.onclick = function () {
        var ok = (o === fl.correct);
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) Array.prototype.forEach.call(box.children, function (n) { if (n.textContent === fl.correct) n.classList.add('right'); });
        Array.prototype.forEach.call(box.children, function (n) { n.disabled = true; });
        G.applyFirstLearn(fl.card, ok);
        setTimeout(function () { closeModal(); toast(ok ? '学会了「' + fl.card.word.w + '」！' : '记错了，下次再来'); G.go('map'); }, 900);
      };
      box.appendChild(b);
    });
    openModal(body, true);
  }

  /* ================= 篝火 ================= */
  function renderCampfire() {
    var st = G.state;
    var wrap = el('div', 'room-wrap fire-room');
    wrap.appendChild(topBar());
    var inner = el('div', 'room-inner');
    inner.innerHTML = '<div class="room-art art-fire"></div><h2>篝火 · Campfire</h2><p class="dim">在火边休息，或复习词汇以精通卡牌。</p>';
    var btns = el('div', 'room-btns');
    var canRest = !G.hasRelic('coffeedripper');
    if (canRest) {
      var rest = el('button', 'btn primary', '🔥 休息（回复 30% 生命）');
      rest.onclick = function () { G.heal(Math.floor(st.maxHp * 0.3)); toast('回复生命'); G.go('map'); };
      btns.appendChild(rest);
    }
    var review = el('button', 'btn', '📖 复习（精通两张已学卡）');
    review.onclick = openReview;
    btns.appendChild(review);
    var leave = el('button', 'btn ghost', '离开');
    leave.onclick = function () { G.go('map'); };
    btns.appendChild(leave);
    inner.appendChild(btns);
    wrap.appendChild(inner);
    screen.appendChild(wrap);
  }
  function openReview() {
    var cands = G.reviewCandidates();
    if (cands.length < 1) {
      /* 没有弱强化卡：提示并随机抽两张做初次学习 */
      toast('没有可复习的卡，先做两次初次学习');
      var picks = G.shuffle(G.state.deck).slice(0, 2), i = 0;
      (function next() {
        if (i >= picks.length) { G.go('map'); return; }
        var c = picks[i++];
        openFirstLearnCard(c, next);
      })();
      return;
    }
    var chosen = [];
    var body = el('div', 'review-wrap');
    body.innerHTML = '<h3>篝火复习</h3><p class="dim">选择最多两张 ★ 卡进行复习（名词考复数 / 动词考时态），成功升为 ★★</p><div class="review-grid" id="rv-grid"></div><button class="btn primary" id="rv-go" disabled>开始复习</button>';
    var grid = body.querySelector('#rv-grid');
    cands.forEach(function (c) {
      var ce = cardEl(c, false); ce.classList.add('mini');
      ce.onclick = function () {
        var idx = chosen.indexOf(c);
        if (idx >= 0) { chosen.splice(idx, 1); ce.classList.remove('sel'); }
        else if (chosen.length < 2) { chosen.push(c); ce.classList.add('sel'); }
        body.querySelector('#rv-go').disabled = chosen.length === 0;
      };
      grid.appendChild(ce);
    });
    body.querySelector('#rv-go').onclick = function () {
      closeModal();
      var i = 0;
      (function next() {
        if (i >= chosen.length) { G.go('map'); return; }
        var c = chosen[i++];
        var quiz = G.formQuiz(c.word); quiz.card = c;
        openFormQuiz(quiz, function (ok) { G.applyReview(c, ok); next(); });
      })();
    };
    openModal(body, true);
  }
  function openFirstLearnCard(c, done) {
    var fl = { card: c, q: c.word.w, correct: c.word.cn, opts: G.shuffle([c.word.cn].concat(G.distractorsCn(c.word.cn, 3))) };
    var body = el('div', 'learn-wrap');
    body.innerHTML = '<h3>初次学习</h3><div class="learn-word">' + c.word.w + '</div><div class="learn-opts" id="lo"></div>';
    var box = body.querySelector('#lo');
    fl.opts.forEach(function (o) {
      var b = el('button', 'learn-opt', o);
      b.onclick = function () { var ok = o === fl.correct; b.classList.add(ok ? 'right' : 'wrong'); Array.prototype.forEach.call(box.children, function (n) { n.disabled = true; }); G.applyFirstLearn(c, ok); setTimeout(function () { closeModal(); done(); }, 700); };
      box.appendChild(b);
    });
    openModal(body, true);
  }
  function openFormQuiz(quiz, done) {
    var body = el('div', 'learn-wrap');
    var posLbl = { verb: 'v.', adj: 'a.', noun: 'n.' }[quiz.card.word.pos] || 'n.';
    body.innerHTML = '<h3>复习 · ' + quiz.label + '</h3><div class="learn-word">' + quiz.q + ' <span class="mono dim">' + posLbl + '</span></div><div class="learn-opts" id="fo"></div>';
    var box = body.querySelector('#fo');
    quiz.opts.forEach(function (o) {
      var b = el('button', 'learn-opt', o);
      b.onclick = function () {
        var ok = o === quiz.correct;
        b.classList.add(ok ? 'right' : 'wrong');
        if (!ok) Array.prototype.forEach.call(box.children, function (n) { if (n.textContent === quiz.correct) n.classList.add('right'); });
        Array.prototype.forEach.call(box.children, function (n) { n.disabled = true; });
        setTimeout(function () { closeModal(); toast(ok ? '精通！' + quiz.card.word.w + ' ★★' : '复习失败'); if (ok) centerText('✦ ★★ ' + quiz.card.word.w, 'upgrade'); done(ok); }, 800);
      };
      box.appendChild(b);
    });
    openModal(body, true);
  }

  /* ================= 商店 ================= */
  function renderShop() {
    var st = G.state;
    var wrap = el('div', 'room-wrap shop-room');
    wrap.appendChild(topBar());
    var inner = el('div', 'shop-inner');
    inner.innerHTML = '<h2>商店 · Merchant</h2><p class="dim mono">金币 ' + st.gold + '</p>';
    /* 卖 3 卡 + 2 圣物 + 删牌 */
    var cardRow = el('div', 'shop-row');
    var pool = G.CARD_DEFS.filter(function (d) { return !d.starter; });
    for (var i = 0; i < 4; i++) {
      var c = G.makeCard(G.pick(pool).id);
      var price = { common: 45, uncommon: 68, rare: 145 }[G.cardRarity(c)] + G.rnd(20) - 10;
      cardRow.appendChild(shopItem(cardEl(c, false), price, (function (cc, pp) { return function () { st.deck.push(cc); return true; }; })(c, price)));
    }
    inner.appendChild(el('h3', null, '卡牌'));
    inner.appendChild(cardRow);
    var relicRow = el('div', 'shop-row');
    for (var j = 0; j < 2; j++) {
      var rid = G.rollRelic();
      if (!rid) continue;
      var r = G.relicById[rid], price = G.relicPrice(rid);
      var rEl = el('div', 'shop-relic');
      rEl.innerHTML = '<span class="relic" style="color:' + G.RELIC_COL[r.r] + ';border-color:' + G.RELIC_COL[r.r] + '">' + r.cn[0] + '</span><div><b>' + r.cn + '</b><br><span class="dim">' + r.desc + '</span></div>';
      relicRow.appendChild(shopItem(rEl, price, (function (id) { return function () { G.addRelic(id); return true; }; })(rid), true));
    }
    inner.appendChild(el('h3', null, '圣物'));
    inner.appendChild(relicRow);
    /* 删牌（一次） */
    var rm = el('button', 'btn', st.shopRemovedOnce ? '删牌已用尽' : '🗑 删除一张牌（75 金）');
    rm.disabled = st.shopRemovedOnce;
    rm.onclick = function () {
      if (st.gold < 75) { toast('金币不足'); return; }
      openRemove();
    };
    inner.appendChild(rm);
    var leave = el('button', 'btn ghost', '离开商店');
    leave.onclick = function () { G.go('map'); };
    inner.appendChild(leave);
    wrap.appendChild(inner);
    screen.appendChild(wrap);
  }
  function shopItem(inner, price, buy, isRelic) {
    var box = el('div', 'shop-item');
    box.appendChild(inner);
    var pr = el('button', 'shop-price mono', '🪙 ' + price);
    pr.onclick = function () {
      if (box.classList.contains('sold')) return;
      if (G.state.gold < price) { toast('金币不足'); return; }
      if (buy()) { G.state.gold -= price; box.classList.add('sold'); pr.textContent = '已购'; toast('购买成功'); refreshTopOnly(); }
    };
    box.appendChild(pr);
    return box;
  }
  function refreshTopOnly() {
    var old = screen.querySelector('.topbar'); if (old) { var nb = topBar(); old.replaceWith(nb); }
    var gd = screen.querySelector('.shop-inner .dim.mono'); if (gd) gd.textContent = '金币 ' + G.state.gold;
  }
  function openRemove() {
    var st = G.state;
    var body = el('div', 'review-wrap');
    body.innerHTML = '<h3>删除一张牌</h3><div class="review-grid" id="rm-grid"></div>';
    var grid = body.querySelector('#rm-grid');
    st.deck.forEach(function (c) {
      var ce = cardEl(c, false); ce.classList.add('mini');
      ce.onclick = function () {
        st.deck.splice(st.deck.indexOf(c), 1); st.gold -= 75; st.shopRemovedOnce = true;
        closeModal(); toast('已删除'); G.go('shop');
      };
      grid.appendChild(ce);
    });
    openModal(body, true);
  }

  /* ================= 宝藏 ================= */
  function renderTreasure() {
    var wrap = el('div', 'room-wrap');
    wrap.appendChild(topBar());
    var inner = el('div', 'room-inner');
    inner.innerHTML = '<div class="room-art art-treasure"></div><h2>宝藏 · Treasure</h2>';
    var rid = G.rollRelic();
    if (rid) {
      var r = G.relicById[rid];
      var open = el('button', 'btn primary', '打开宝箱');
      open.onclick = function () {
        G.addRelic(rid);
        inner.innerHTML = '<div class="room-art art-treasure open"></div><h2>获得圣物</h2><div class="treasure-relic"><span class="relic" style="color:' + G.RELIC_COL[r.r] + ';border-color:' + G.RELIC_COL[r.r] + '">' + r.cn[0] + '</span><b>' + r.cn + '</b><p class="dim">' + r.desc + '</p></div>';
        var go = el('button', 'btn', '继续'); go.onclick = function () { G.go('map'); };
        inner.appendChild(go);
        burst(window.innerWidth / 2, window.innerHeight / 2, G.RELIC_COL[r.r], 40);
      };
      inner.appendChild(open);
    } else {
      G.state.gold += 30; inner.innerHTML += '<p>空空如也，捡到 30 金币</p>';
      var go = el('button', 'btn', '继续'); go.onclick = function () { G.go('map'); }; inner.appendChild(go);
    }
    wrap.appendChild(inner);
    screen.appendChild(wrap);
  }

  /* ================= 奇遇 ================= */
  function renderEvent() {
    var st = G.state;
    var wrap = el('div', 'room-wrap');
    wrap.appendChild(topBar());
    var inner = el('div', 'room-inner');
    /* 低血触发献祭事件 Crimson Altar */
    var lowHp = st.hp < st.maxHp * 0.4;
    if (lowHp && Math.random() < 0.7) {
      inner.innerHTML = '<div class="room-art art-altar"></div><h2>殷红的祭坛 · Crimson Altar</h2><p class="dim">祭坛渴求一张卡牌。献上它，或许能换回气力——但结果无人知晓。</p>';
      var give = el('button', 'btn primary', '献祭一张牌');
      give.onclick = function () {
        var body = el('div', 'review-wrap');
        body.innerHTML = '<h3>献祭哪张牌？</h3><div class="review-grid" id="sac"></div>';
        var grid = body.querySelector('#sac');
        st.deck.forEach(function (c) {
          var ce = cardEl(c, false); ce.classList.add('mini');
          ce.onclick = function () {
            var rar = G.cardRarity(c);
            var heal = rar === 'rare' ? Math.floor(st.maxHp / 2) : rar === 'uncommon' ? 15 : 5;
            st.deck.splice(st.deck.indexOf(c), 1);
            G.heal(heal);
            closeModal();
            toast('祭坛回应了你：+' + heal + ' 生命');
            burst(window.innerWidth / 2, window.innerHeight / 2, '#c0392b', 36);
            G.go('map');
          };
          grid.appendChild(ce);
        });
        openModal(body, true);
      };
      var no = el('button', 'btn ghost', '离开');
      no.onclick = function () { G.go('map'); };
      inner.appendChild(give); inner.appendChild(no);
    } else {
      /* 普通奇遇：迷光 / 废弃书库 */
      var kind = G.pick(['gwath', 'partham']);
      if (kind === 'gwath') {
        inner.innerHTML = '<div class="room-art art-event"></div><h2>迷光 · Wisp</h2><p class="dim">幽微的光引你深入。</p>';
        var a = el('button', 'btn', '追随（失 6 血，得 60 金）');
        a.onclick = function () { G.damagePlayerRaw ? (st.hp = Math.max(1, st.hp - 6)) : null; st.gold += 60; toast('+60 金'); G.go('map'); };
        var b = el('button', 'btn', '一张随机卡进入弱强化');
        b.onclick = function () { var c = G.pick(st.deck); if (c && c.lvl < 1) { c.lvl = 1; G.manualSet(c.word.w, 1); } toast('一张卡获得强化'); G.go('map'); };
        var c = el('button', 'btn ghost', '离开'); c.onclick = function () { G.go('map'); };
        inner.appendChild(a); inner.appendChild(b); inner.appendChild(c);
      } else {
        inner.innerHTML = '<div class="room-art art-event"></div><h2>废弃书库 · Lost Library</h2><p class="dim">尘封的书架间藏着知识。</p>';
        var a2 = el('button', 'btn', '研读（升级随机一张卡）');
        a2.onclick = function () { var cs = st.deck.filter(function (x) { return x.lvl < 2; }); if (cs.length) { var c = G.pick(cs); c.lvl = Math.min(2, c.lvl + 1); G.manualSet(c.word.w, c.lvl); } toast('一张卡获得强化'); G.go('map'); };
        var b2 = el('button', 'btn', '休息（回 20% 血）');
        b2.onclick = function () { G.heal(Math.floor(st.maxHp * 0.2)); G.go('map'); };
        var c2 = el('button', 'btn ghost', '离开'); c2.onclick = function () { G.go('map'); };
        inner.appendChild(a2); inner.appendChild(b2); inner.appendChild(c2);
      }
    }
    wrap.appendChild(inner);
    screen.appendChild(wrap);
  }

  /* ================= 结束 ================= */
  function renderGameover(arg) {
    var wrap = el('div', 'over-wrap' + (arg.win ? ' win' : ' lose'));
    wrap.innerHTML =
      '<div class="over-glow"></div>' +
      '<h1>' + (arg.win ? 'The Tower is Conquered.' : 'The Tower Still Stands.') + '</h1>' +
      '<p class="over-cn">' + (arg.win ? '命运被征服了 —— 你登顶了巴别塔。' : '塔仍矗立 —— 但你会再来。') + '</p>' +
      '<p class="mono dim">生词手册已保存本局学到的词汇</p>' +
      '<button class="btn primary" id="over-again">回到塔前</button>';
    screen.appendChild(wrap);
    burst(window.innerWidth / 2, window.innerHeight / 2, arg.win ? '#ffcf40' : '#5a6b80', 60);
    $('over-again').onclick = function () { G.state = null; G.go('title'); };
  }

  /* ================= 弹窗 / 牌堆查看 / 卡详情 ================= */
  function openModal(body, center) {
    clear(modal); modal.hidden = false;
    var box = el('div', 'modal-box' + (center ? ' center' : ''));
    var close = el('button', 'modal-x', '✕'); close.onclick = closeModal;
    box.appendChild(close); box.appendChild(body);
    modal.appendChild(box);
    modal.onclick = function (ev) { if (ev.target === modal) closeModal(); };
  }
  function closeModal() { modal.hidden = true; clear(modal); }
  G.closeModal = closeModal;
  function confirmModal(msg, onYes) {
    var body = el('div', 'confirm-wrap');
    body.innerHTML = '<p>' + msg + '</p>';
    var yes = el('button', 'btn primary', '确认'); yes.onclick = function () { closeModal(); onYes(); };
    var no = el('button', 'btn ghost', '取消'); no.onclick = closeModal;
    body.appendChild(yes); body.appendChild(no);
    openModal(body, true);
  }
  function showPile(pile, title, sorted, shuffled) {
    var body = el('div', 'pile-wrap');
    body.appendChild(el('h3', null, title + ' <span class="mono">' + pile.length + '</span>'));
    var grid = el('div', 'pile-grid');
    var list = sorted ? pile.slice().sort(function (a, b) { return G.cardCost(a) - G.cardCost(b); }) : (shuffled ? G.shuffle(pile) : pile);
    if (!list.length) grid.innerHTML = '<div class="dim">（空）</div>';
    list.forEach(function (c) {
      var ce = cardEl(c, false); ce.classList.add('mini');
      ce.onclick = function () { showCardDetail(c); };
      ce.oncontextmenu = function (ev) { ev.preventDefault(); showCardDetail(c); };
      grid.appendChild(ce);
    });
    body.appendChild(grid);
    openModal(body);
  }
  function showCardDetail(c) {
    var body = el('div', 'detail-wrap');
    body.appendChild(el('h3', null, '卡牌详情 —— ' + c.word.w + (G.cardKnown(c) ? ' · ' + c.word.cn : '')));
    var row = el('div', 'detail-row');
    [0, 1, 2].forEach(function (lvl, i) {
      var cc = { uid: c.uid + '_' + lvl, defId: c.defId, word: c.word, lvl: lvl, kw: c.kw };
      var col = el('div', 'detail-col');
      col.innerHTML = '<div class="detail-lbl mono">' + (lvl === 0 ? '基础' : lvl === 1 ? '弱强化 ★' : '强强化 ★★') + '</div>';
      col.appendChild(cardEl(cc, false));
      row.appendChild(col);
      if (i < 2) { var ar = el('div', 'detail-arrow', '→'); row.appendChild(ar); }
    });
    body.appendChild(row);
    openModal(body, true);
  }

  /* ================= 启动 ================= */
  G.on('runStart', function () {});
  G.loadWords().then(function (n) {
    if (!n) { screen.innerHTML = '<div class="ti-wrap"><p class="dim">词库加载失败，请检查 /data/en/levels/ 是否可访问。</p></div>'; return; }
    G.go('title');
  }).catch(function (err) {
    screen.innerHTML = '<div class="ti-wrap"><p class="dim">加载出错：' + err.message + '</p></div>';
  });

})(window.G);
