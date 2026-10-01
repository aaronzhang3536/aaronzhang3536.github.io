/* 巴别塔规则引擎（public/standalone/babel/data.js + game.js）回归测试：零依赖，
   `node scripts/tests/babel.test.mjs`。在 vm 里加载两份脚本，桩掉 localStorage / fetch / setTimeout
   （假时钟，flush() 手动推进），Math.random 换成定种子 PRNG，结果可复现。
   覆盖评审发现的引擎 bug：构词题只用 ECDICT 核对过的形式、词义干扰项同词性近难度、回合阶段锁、
   退出后挂起回调作废、商店库存持久化、毒死判定、敌人格挡清空、意图实时算力量、献祭弃牌、
   单体技能选目标、自塑黏土 / 黑曜石心 / 铜鸟 / 古墨瓶、★★★ 精通、手册不被非答题路径污染、
   开局定首领、地图篝火约束。UI 部分（弹窗必答、指针捕获、地图滚动）需在浏览器里验证。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BABEL = path.join(ROOT, 'public', 'standalone', 'babel');
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'babel-words.json'), 'utf-8'));
const t0 = Date.now();

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
}

/* 定种子 PRNG（mulberry32） */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function boot(seed) {
  const timers = [], store = {};
  const M = Object.create(Math); M.random = rng(seed || 1);
  const ctx = {
    console, JSON, Date, Object, Array, Promise, Math: M,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout: (f) => { timers.push(f); return timers.length; },
    fetch: () => Promise.resolve({ json: () => JSON.parse(JSON.stringify(PACK)) }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['data.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(BABEL, f), 'utf-8'), ctx, { filename: f });
  const G = ctx.G;
  await G.loadWords();
  const events = [];
  ['enemyDead', 'combatEnd', 'cardUpgraded', 'bossExam'].forEach((ev) => G.on(ev, (d) => events.push([ev, d])));
  return {
    G, events, store,
    flush() { let n = 0; while (timers.length && n++ < 1000) timers.shift()(); return n; },
  };
}
/* 进入一场受控战斗：固定敌人、血量充足、清掉开局随机项 */
function fight(G, kind, sub) {
  G.startRun();
  G.state.hp = G.state.maxHp = 999;
  G.enterCombat(kind || 'normal', sub || 'normal');
  const cb = G.state.combat;
  cb.player.block = 0;
  return cb;
}
function card(G, defId, lvl) { const c = G.makeCard(defId); c.lvl = lvl || 0; return c; }

const env = await boot(7);
const { G } = env;

/* ---------- 1. 构词题：只用核对过的真实形式 ---------- */
{
  const W = (w) => G.wordByKey[w];
  check('词库已载入', G.words.length > 3000, String(G.words.length));
  const expect = { go: 'went', eat: 'ate', admit: 'admitted', bad: 'worse', big: 'bigger', happy: 'happier',
    child: 'children', crisis: 'crises', cliff: 'cliffs', belief: 'beliefs', knife: 'knives', person: 'people', sheep: 'sheep', die: 'died' };
  Object.keys(expect).forEach((w) => {
    const r = W(w);
    if (!r) return;                              /* 词表若变动，缺席的词跳过 */
    check('构词正确答案 ' + w, r.forms && r.forms[0] === expect[w], r.forms && r.forms.join('/'));
    const q = G.formQuiz(r);
    check('构词题用真实形式 ' + w, q && q.correct === expect[w], q && q.correct);
  });
  ['beautiful', 'information', 'knowledge', 'equipment', 'money', 'advice', 'news', 'can'].forEach((w) => {
    const r = W(w);
    if (!r) return;
    check('无可靠构词不出构词题 ' + w, G.formQuiz(r) === null && G.quizFor(r).kind === 'meaning');
  });
  const be = W('be');
  if (be) check('多种正确形式都登记（was/were）', be.forms.indexOf('were') >= 0);
  /* 全量：每个带构词的词出 6 次题，干扰项从不等于任何真实变形 / 原词 / 词库里的词 */
  let withForms = 0, noQuiz = 0, bad = 0, badEx = '';
  G.words.forEach((r) => {
    if (!r.forms) return;
    withForms++;
    const real = r.forms.concat(r.avoid, [r.w]);
    for (let k = 0; k < 6; k++) {
      const q = G.formQuiz(r);
      if (!q) { noQuiz++; return; }
      const wrong = q.opts.filter((o) => o !== q.correct);
      const okShape = q.opts.length === 4 && new Set(q.opts).size === 4 && q.opts.indexOf(r.forms[0]) >= 0 && q.correct === r.forms[0];
      const clash = wrong.filter((o) => real.indexOf(o) >= 0 || G.wordByKey[o]);
      if (!okShape || clash.length) { bad++; if (!badEx) badEx = r.w + ': ' + q.opts.join(',') + ' / real ' + real.join(','); }
    }
  });
  check('带核对构词的词足够多', withForms > 2000, String(withForms));
  check('构词题 4 个不重复选项、干扰项不撞真实变形', bad === 0, bad + ' 道  例 ' + badEx);
  check('几乎所有带构词的词都能凑满干扰项', noQuiz <= withForms * 0.01, noQuiz + '/' + withForms);
}

/* ---------- 2. 词义干扰项：同词性、相邻难度、不重复不同义 ---------- */
{
  const byCn = {};
  G.words.forEach((r) => { (byCn[r.cn] = byCn[r.cn] || []).push(r); });
  const senses = (s) => s.split(/[，,；;、]/).map((x) => x.trim()).filter(Boolean);
  let bad = 0, far = 0, ex = '';
  for (let i = 0; i < 400; i++) {
    const r = G.words[(i * 37) % G.words.length];
    const q = G.meaningQuiz(r);
    const ds = q.opts.filter((o) => o !== r.cn);
    if (q.opts.length !== 4 || new Set(q.opts).size !== 4 || ds.length !== 3) { bad++; ex = ex || r.w + ' ' + q.opts.join('|'); continue; }
    const mine = senses(r.cn);
    ds.forEach((d) => {
      if (senses(d).some((s) => mine.indexOf(s) >= 0)) { bad++; ex = ex || r.w + ' ' + d; }
      const near = (byCn[d] || []).some((x) => x.pos === r.pos && Math.abs(x.tier - r.tier) <= 1);
      if (!near) far++;
    });
  }
  check('词义题 4 个不重复选项、干扰项不与正确释义共享义项', bad === 0, bad + ' ' + ex);
  check('词义干扰项基本来自同词性 ±1 档', far <= 12, far + '/1200 个超出');
}

/* ---------- 3. 回合阶段锁 + 退出后挂起回调作废 ---------- */
{
  const cb = fight(G);
  const e = cb.enemies[0];
  e.intent = { type: 'attack', base: 10, cn: '' }; e.buffs = {};
  const turn0 = cb.turn, hp0 = G.state.hp;
  const r1 = G.endTurn(), r2 = G.endTurn();
  check('连点结束回合：第二次被拒绝', r1 === true && r2 === false && cb.phase === 'enemy');
  const c = card(G, 'strike'); cb.hand.push(c); cb.player.energy = 9;
  check('敌人阶段不能出牌', G.playCard(c, e.uid) === false && cb.hand.indexOf(c) >= 0);
  env.flush();
  check('连点只结算一次敌人行动（10 伤害不翻倍）', hp0 - G.state.hp === 10, String(hp0 - G.state.hp));
  check('回合数只 +1、回到玩家阶段', cb.turn === turn0 + 1 && cb.phase === 'player' && G.isPlayerPhase());

  /* 敌人行动中途退出到标题：挂起的定时回调不抛错 */
  const cb2 = fight(G, 'normal', 'pack');
  cb2.enemies.forEach((x) => { x.intent = { type: 'attack', base: 3, cn: '' }; });
  G.endTurn();
  G.quitRun();
  let threw = null;
  try { env.flush(); } catch (err) { threw = err; }
  check('敌人回合中退出：挂起回调不抛错', !threw && G.state === null, threw && threw.message);

  /* 首领测验中退出 */
  G.startRun(); G.state.bossId = 'amarth'; G.state.hp = 999;
  G.enterCombat('boss');
  const cb3 = G.state.combat, boss = cb3.enemies[0];
  boss.intent = { type: 'exam', cn: '' };
  G.endTurn();
  check('测验意图进入 exam 阶段', cb3.phase === 'exam' && G.endTurn() === false);
  G.quitRun();
  threw = null;
  try { G.resolveExam(boss, true, true); env.flush(); } catch (err) { threw = err; }
  check('测验中退出：结算回调不抛错', !threw, threw && threw.message);
  /* 测验重复结算被拒绝 */
  G.startRun(); G.state.bossId = 'amarth'; G.state.hp = 999; G.enterCombat('boss');
  const cb4 = G.state.combat; cb4.enemies[0].intent = { type: 'exam', cn: '' };
  G.endTurn(); G.buildExam();
  const a = G.resolveExam(cb4.enemies[0], true, true), b = G.resolveExam(cb4.enemies[0], true, true);
  env.flush();
  check('测验只能结算一次，之后回到玩家回合', a === true && b === false && cb4.phase === 'player', cb4.phase);
}

/* ---------- 5. 商店：库存持久化 / 圣物不重复 / 每店删牌一次 / 不白扣钱 ---------- */
{
  G.startRun();
  const shopNode = { r: 5, c: 0, id: 'shopA', edges: [], type: 'shop' };
  G.enterNode(shopNode);
  const s1 = G.shopStock(), bias = G.state.relicRareBias;
  const s2 = G.shopStock();
  check('同一商店只进货一次', s1 === s2 && s1.cards.length === 4 && G.state.relicRareBias === bias);
  let dup = 0;
  for (let i = 0; i < 400; i++) {
    G.state.node = { id: 'tmp' + i, edges: [] };
    const st = G.shopStock();
    if (st.relics.length === 2 && st.relics[0].id === st.relics[1].id) dup++;
  }
  check('两格圣物从不重复', dup === 0, String(dup));
  G.state.node = shopNode;
  G.state.gold = 1000;
  const item = s1.cards[0], deck0 = G.state.deck.length;
  check('买卡成功并记为已售', G.shopBuy(item, 'card') && item.sold && G.state.deck.length === deck0 + 1);
  const g1 = G.state.gold;
  check('已售商品不能再买', G.shopBuy(item, 'card') === false && G.state.gold === g1);
  const ri = s1.relics[0];
  G.addRelic(ri.id);
  check('已拥有的圣物不扣钱', G.shopBuy(ri, 'relic') === false && G.state.gold === g1 && !ri.sold);
  check('删牌一次成功', G.shopRemove(G.state.deck[0]) && s1.removed && G.state.gold === g1 - G.SHOP_REMOVE_PRICE);
  check('同一商店不能删第二次', G.shopRemove(G.state.deck[0]) === false);
  check('重进同一商店：已售状态保留', G.shopStock().cards[0].sold === true);
  G.state.node = { id: 'shopB', edges: [] };
  check('下一个商店可以再删一次', G.shopRemove(G.state.deck[0]) === true);
}

/* ---------- 6. 毒死判定 ---------- */
{
  const cb = fight(G);
  G.state.hp = 3; cb.player.buffs.poison = 8;
  cb.enemies[0].intent = { type: 'buff', buff: 'str', amt: 1, cn: '' };
  G.endTurn(); env.flush();
  check('玩家被毒死：战斗以失败结束', cb.ended && !cb.won && G.state.hp === 0 && !G.canPlay(card(G, 'strike')));
  const cb2 = fight(G);
  const e = cb2.enemies[0]; e.buffs.poison = 999;
  e.intent = { type: 'buff', buff: 'str', amt: 1, cn: '' };
  env.events.length = 0;
  G.endTurn(); env.flush();
  check('敌人被毒死：标记死亡并发 enemyDead，战斗胜利',
    e.dead && cb2.ended && cb2.won && env.events.some((x) => x[0] === 'enemyDead' && x[1] === e));
}

/* ---------- 7. 敌人格挡在其行动开始时清空 ---------- */
{
  const cb = fight(G, 'elite');
  const e = cb.enemies[0], log = [];
  for (let t = 0; t < 4; t++) { e.intent = { type: 'defend', val: 10, cn: '' }; G.endTurn(); env.flush(); log.push(e.block); }
  check('敌人连续防御格挡不累加', log.every((b) => b === 10), log.join(','));
}

/* ---------- 8. 意图伤害实时计算力量 ---------- */
{
  const cb = fight(G);
  const e = cb.enemies[0];
  e.buffs = { str: 9 }; e.intent = { type: 'attack', base: 13, cn: '' };
  check('意图显示含力量', G.intentDamage(e) === 22, String(G.intentDamage(e)));
  let hp = G.state.hp; G.endTurn(); env.flush();
  check('力量计入实际伤害', hp - G.state.hp === 22, String(hp - G.state.hp));
  const cb2 = fight(G);
  const e2 = cb2.enemies[0];
  e2.buffs = {}; e2.intent = { type: 'attack', base: 10, cn: '' };
  const dis = card(G, 'disarm'); cb2.hand.push(dis); cb2.player.energy = 9;
  G.playCard(dis, e2.uid);
  check('缴械削弱已宣告的攻击（显示）', G.intentDamage(e2) === 8, String(G.intentDamage(e2)));
  hp = G.state.hp; G.endTurn(); env.flush();
  check('缴械削弱已宣告的攻击（结算）', hp - G.state.hp === 8, String(hp - G.state.hp));
  /* 首领意图本身不再烘焙力量 */
  G.startRun(); G.state.bossId = 'bauglir'; G.enterCombat('boss');
  const bz = G.state.combat.enemies[0];
  check('首领攻击意图只存基础伤害', bz.intent.base != null && bz.intent.val === undefined);
}

/* ---------- 9. 献祭：弃掉其余手牌 ---------- */
{
  const cb = fight(G, 'normal', 'pack');
  cb.enemies.forEach((x) => { x.hp = x.maxHp = 500; });
  cb.player.energy = 9;
  const imm = card(G, 'immolate'); cb.hand.push(imm);
  const others = cb.hand.length - 1, disc0 = cb.discard.length;
  G.playCard(imm, null);
  check('献祭后手牌清空、其余手牌进弃牌堆', cb.hand.length === 0 && cb.discard.length === disc0 + others + 1);
}

/* ---------- 10/11. 单体技能选目标 / 单敌自动锁定（飞踢奖励） ---------- */
{
  const cb = fight(G, 'normal', 'pack');
  cb.enemies.forEach((x) => { x.hp = x.maxHp = 500; x.buffs = {}; });
  cb.player.energy = 9;
  const dis = card(G, 'disarm'); cb.hand.push(dis);
  check('缴械需要选目标', G.cardNeedsTarget(dis) && !G.cardNeedsTarget(card(G, 'shockwave')) && !G.cardNeedsTarget(card(G, 'defend')));
  const e0 = cb.player.energy;
  check('多敌时不给目标：拒绝出牌且不扣能量', G.playCard(dis, null) === false && cb.player.energy === e0);
  G.playCard(dis, cb.enemies[1].uid);
  check('缴械只作用于所选目标', cb.enemies.filter((x) => (x.buffs.str || 0) < 0).length === 1 && cb.enemies[1].buffs.str < 0);
  const cb2 = fight(G);
  const e = cb2.enemies[0]; e.hp = e.maxHp = 500; e.buffs = { vuln: 2 };
  cb2.player.energy = 5;
  const dk = card(G, 'dropkick'); cb2.hand.push(dk);
  const hand0 = cb2.hand.length;
  G.playCard(dk, null);          /* 触屏单敌：不带目标 uid 也应锁定唯一敌人 */
  check('单敌不带目标：飞踢奖励生效（+1 能量、抽 1）', cb2.player.energy === 5 - 1 + 1 && cb2.hand.length === hand0, cb2.player.energy + ' ' + cb2.hand.length);
}

/* ---------- 12/13. 自塑黏土 / 黑曜石心 ---------- */
{
  G.startRun(); G.addRelic('selfformingclay'); G.state.hp = G.state.maxHp = 999;
  G.enterCombat('normal', 'normal');
  const cb = G.state.combat, e = cb.enemies[0];
  cb.player.block = 0; e.buffs = {}; e.intent = { type: 'attack', base: 5, cn: '' };
  G.endTurn(); env.flush();
  check('自塑黏土：受未格挡伤害后下回合开始 +3 格挡', cb.player.block === 3, String(cb.player.block));
  e.intent = { type: 'defend', val: 1, cn: '' };
  cb.player.block = 0;
  G.endTurn(); env.flush();
  check('自塑黏土：没受伤则不加', cb.player.block === 0, String(cb.player.block));
  G.startRun(); G.addRelic('darkstone'); G.enterCombat('normal', 'normal');
  check('黑曜石心：回合开始多抽 1 张', G.state.combat.hand.length === 6, String(G.state.combat.hand.length));
}

/* ---------- 14/15. 铜鸟 / 古墨瓶 / 耸肩数据 ---------- */
{
  G.startRun();
  check('复习默认最多 2 张', G.reviewMax() === 2);
  G.addRelic('bird');
  check('铜鸟：复习最多 3 张', G.reviewMax() === 3);
  G.startRun(); G.addRelic('ancientinkwell'); G.state.hp = 30;
  G.applyFirstLearn(G.state.deck[0], true);
  check('古墨瓶：初次学习答对回复 5 生命', G.state.hp === 35, String(G.state.hp));
  const shrug = G.cardDefById.shrug;
  check('耸肩不再带「+0 再生」', !shrug.eff.applies && !G.cardNeedsTarget(card(G, 'shrug')));
}

/* ---------- 16. ★★★：最终测验答对已 ★★ 的词即精通 ---------- */
{
  G.manualReset();
  G.startRun(); G.state.bossId = 'amarth'; G.state.hp = 999; G.enterCombat('boss');
  const cb = G.state.combat;
  const c = G.state.deck.filter((x) => x.word.forms)[0] || G.state.deck[0];
  G.manualSet(c.word.w, 2); c.lvl = 2;
  cb.enemies[0].intent = { type: 'exam', cn: '' };
  G.endTurn();
  const ex = G.buildExam();
  check('测验优先考 ★★ 的词', ex.meaning.card.word.w === c.word.w || ex.form.card.word.w === c.word.w);
  G.resolveExam(cb.enemies[0], true, true); env.flush();
  check('答对即精通 ★★★（手册 + 卡牌）', G.manualStar(c.word.w) === 3 && c.lvl === 3);
  check('★★★ 的词新做的卡带 lvl 3（mastered）', G.makeCard('strike', c.word).lvl === 3);
}

/* ---------- 17. 手册只来自答题；释义显示只看手册 ---------- */
{
  G.manualReset();
  G.startRun(); G.addRelic('lexicon'); G.addRelic('whetstone');
  const c = G.state.deck[0];
  check('词典之魂/磨刀石只加强度，不写手册', c.lvl >= 1 && Object.keys(G.manual).length === 0);
  check('未学过的词即使 lvl≥1 也不显示释义', G.cardKnown(c) === false);
  check('未学过释义的卡不能篝火复习', G.reviewCandidates().length === 0);
  G.applyFirstLearn(c, true);
  check('初次学习答对：手册 ★、显示释义、可复习', G.manualStar(c.word.w) === 1 && G.cardKnown(c) && G.reviewCandidates().indexOf(c) >= 0);
  const fl = G.buildFirstLearn();
  check('初次学习优先考不认识的词', fl && G.manualStar(fl.card.word.w) === 0);
}

/* ---------- 18. 开局即定首领 ---------- */
{
  G.startRun();
  const bid = G.state.bossId;
  check('startRun 已选定首领', ['amarth', 'bauglir', 'dagnir'].indexOf(bid) >= 0);
  G.state.hp = 999; G.enterCombat('boss');
  check('首领战用的就是开局选定的首领', G.state.combat.enemies[0].defId === bid);
}

/* ---------- 19. 地图：篝火约束 ---------- */
{
  let fireFire = 0, r12 = 0, over5 = 0, zero = 0, shops = 0, early = 0;
  for (let i = 0; i < 200; i++) {
    G.startRun();
    const grid = G.state.map.grid, byId = {};
    grid.forEach((row) => row.forEach((n) => { byId[n.id] = n; }));
    grid.forEach((row) => row.forEach((n) => {
      if (n.type === 'fire') n.edges.forEach((id) => { if (byId[id].type === 'fire') fireFire++; });
      if (n.r === 12 && n.type === 'fire') r12++;
      if ((n.type === 'fire' || n.type === 'elite') && n.r > 0 && n.r < 5) early++;
      if (n.type === 'shop' && n.r < 4) early++;
    }));
    if (grid.reduce((s, row) => s + row.filter((n) => n.type === 'shop').length, 0) !== 3) shops++;
    G.pathsOf(grid).forEach((p) => {
      const f = p.filter((n) => n.type === 'fire').length;
      if (f > 5) over5++;
      if (f < 1) zero++;
    });
  }
  check('地图：篝火从不相连（含 r12→r13）', fireFire === 0 && r12 === 0, fireFire + ' / r12 ' + r12);
  check('地图：每条路径篝火 1~5', over5 === 0 && zero === 0, over5 + ' ' + zero);
  check('地图：恰好 3 商店', shops === 0, String(shops));
  check('地图：前 5 层无篝火/精英、前 4 层无商店', early === 0, String(early));
}

/* ---------- 23/24. 静态检查：报错文案、死代码 ---------- */
{
  const ui = fs.readFileSync(path.join(BABEL, 'ui.js'), 'utf-8');
  const game = fs.readFileSync(path.join(BABEL, 'game.js'), 'utf-8');
  check('加载失败提示指向 babel-words.json', ui.indexOf('/data/babel-words.json') >= 0 && ui.indexOf('/data/en/levels/') < 0);
  check('死代码已清理', !/goldDrained|_enemyContinue|st\.act\b|shopRemovedOnce|relicById\.crown\) \{\}/.test(game + ui));
}

console.log('babel.test: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
if (fail) process.exitCode = 1;
