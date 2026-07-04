/* 八位五级流水线 CPU — 周期精确模拟 + Canvas 可视化
   经典 RISC 五级：IF 取指 → ID 译码/读寄存器 → EX 执行 → MEM 访存 → WB 写回
   完整实现：EX/MEM 与 MEM/WB 前递、load-use 停顿、分支冲刷（EX 判定，预测不跳转）
   EX 阶段的加法展开为 8 个全加器，逐位看进位涟漪 */

/* ---------- ISA（16 位指令，8 位数据通路，8 个寄存器） ---------- */
const OP = { NOP: 0, LDI: 1, ADD: 2, SUB: 3, AND: 4, LD: 5, ST: 6, BEQ: 7, HALT: 15 };
const OP_NAME = ['NOP', 'LDI', 'ADD', 'SUB', 'AND', 'LD', 'ST', 'BEQ'];

function asm(op, a, b, c) { return { op, a: a | 0, b: b | 0, c: c | 0 }; }
function iText(ins) {
  if (!ins || ins.op === OP.NOP) return 'NOP';
  if (ins.op === OP.HALT) return 'HALT';
  if (ins.op === OP.LDI) return `LDI R${ins.a},${ins.b}`;
  if (ins.op === OP.LD) return `LD R${ins.a},[R${ins.b}+${ins.c}]`;
  if (ins.op === OP.ST) return `ST R${ins.a},[R${ins.b}+${ins.c}]`;
  if (ins.op === OP.BEQ) return `BEQ R${ins.a},R${ins.b},${ins.c > 7 ? ins.c - 16 : ins.c}`;
  return `${OP_NAME[ins.op]} R${ins.a},R${ins.b},R${ins.c}`;
}

const PROGRAMS = {
  add: {
    zh: '一条加法（5+7）',
    note: 'LDI R2 → ADD 距离 1 拍，必须靠 EX/MEM 前递才不停顿',
    code: [
      asm(OP.LDI, 1, 5), asm(OP.LDI, 2, 7),
      asm(OP.ADD, 3, 1, 2), asm(OP.ST, 3, 0, 0), asm(OP.HALT),
    ],
  },
  chain: {
    zh: '数据冒险连锁',
    note: '每条 ADD 都依赖上一条的结果，前递网络火力全开',
    code: [
      asm(OP.LDI, 1, 1), asm(OP.ADD, 2, 1, 1), asm(OP.ADD, 3, 2, 2),
      asm(OP.ADD, 4, 3, 3), asm(OP.ADD, 5, 4, 4), asm(OP.HALT),
    ],
  },
  loaduse: {
    zh: 'Load-Use 冒险',
    note: 'LD 的数据 MEM 末才拿到，下一条要用必须塞一个气泡，前递也救不了',
    code: [
      asm(OP.LDI, 1, 10), asm(OP.ST, 1, 0, 2), asm(OP.LD, 2, 0, 2),
      asm(OP.ADD, 3, 2, 2), asm(OP.HALT),
    ],
  },
  branch: {
    zh: '分支冲刷',
    note: '预测不跳转、EX 才判定：猜错时冲掉已经进流水线的 2 条指令',
    code: [
      asm(OP.LDI, 1, 3), asm(OP.LDI, 2, 3), asm(OP.BEQ, 1, 2, 2),
      asm(OP.LDI, 7, 99), asm(OP.LDI, 7, 88),
      asm(OP.ADD, 3, 1, 2), asm(OP.HALT),
    ],
  },
  loop: {
    zh: '循环：1+2+…+5',
    note: '真实的循环体：累加 + 计数 + 条件回跳，观察稳态下的流水吞吐',
    code: [
      asm(OP.LDI, 1, 0),  /* sum */
      asm(OP.LDI, 2, 1),  /* i */
      asm(OP.LDI, 3, 6),  /* bound */
      asm(OP.LDI, 4, 1),
      asm(OP.ADD, 1, 1, 2),
      asm(OP.ADD, 2, 2, 4),
      asm(OP.BEQ, 2, 3, 1),
      asm(OP.BEQ, 0, 0, -4 & 15),
      asm(OP.ST, 1, 0, 0), asm(OP.HALT),
    ],
  },
};

/* ---------- 周期精确流水线模拟 ---------- */
function makeCPU(program, forwarding) {
  const NOPI = asm(OP.NOP, 0, 0, 0);
  const cpu = {
    pc: 0, cycle: 0, halted: false, forwarding,
    reg: new Uint8Array(8), mem: new Uint8Array(16),
    imem: program,
    if_id: { ins: NOPI, pc: 0, valid: false, tag: -1 },
    id_ex: { ins: NOPI, va: 0, vb: 0, valid: false, tag: -1, fwdA: '', fwdB: '' },
    ex_mem: { ins: NOPI, alu: 0, vb: 0, valid: false, tag: -1 },
    mem_wb: { ins: NOPI, val: 0, valid: false, tag: -1 },
    fetchTag: 0, events: [], gantt: [], done: false,
  };
  return cpu;
}

function writesReg(ins) {
  return ins.op === OP.LDI || ins.op === OP.ADD || ins.op === OP.SUB ||
         ins.op === OP.AND || ins.op === OP.LD;
}
function destOf(ins) { return ins.a; }
function srcsOf(ins) {
  if (ins.op === OP.ADD || ins.op === OP.SUB || ins.op === OP.AND) return [ins.b, ins.c];
  if (ins.op === OP.LD) return [ins.b];
  if (ins.op === OP.ST) return [ins.a, ins.b];
  if (ins.op === OP.BEQ) return [ins.a, ins.b];
  return [];
}

function stepCPU(c) {
  if (c.done) return;
  const NOPI = asm(OP.NOP, 0, 0, 0);
  const ev = { fwd: [], stall: false, flush: false, adder: null, wbWrite: null, memOp: null };
  const g = {};   /* tag → stage 记录 */

  /* ---- WB ---- */
  const wb = c.mem_wb;
  if (wb.valid && writesReg(wb.ins) && destOf(wb.ins) !== 0) {
    c.reg[destOf(wb.ins)] = wb.val & 0xff;
    ev.wbWrite = { r: destOf(wb.ins), v: wb.val & 0xff };
  }
  if (wb.valid) g[wb.tag] = 'W';
  if (wb.valid && wb.ins.op === OP.HALT) c.done = true;

  /* ---- MEM ---- */
  const mx = c.ex_mem;
  let memVal = mx.alu;
  if (mx.valid && mx.ins.op === OP.LD) {
    memVal = c.mem[mx.alu & 15];
    ev.memOp = { kind: 'LD', addr: mx.alu & 15, val: memVal };
  }
  if (mx.valid && mx.ins.op === OP.ST) {
    c.mem[mx.alu & 15] = mx.vb & 0xff;
    ev.memOp = { kind: 'ST', addr: mx.alu & 15, val: mx.vb & 0xff };
  }
  if (mx.valid) g[mx.tag] = 'M';
  const new_mem_wb = { ins: mx.valid ? mx.ins : NOPI, val: memVal, valid: mx.valid, tag: mx.tag };

  /* ---- EX（含前递选择） ---- */
  const ex = c.id_ex;
  let va = ex.va, vb2 = ex.vb;
  ex.fwdA = ''; ex.fwdB = '';
  if (ex.valid && c.forwarding) {
    const s = srcsOf(ex.ins);
    /* EX/MEM 前递优先（更新的值） */
    const tryFwd = (reg2) => {
      if (mx.valid && writesReg(mx.ins) && mx.ins.op !== OP.LD && destOf(mx.ins) === reg2 && reg2 !== 0) return { v: mx.alu, from: 'EX/MEM' };
      if (wb.valid && writesReg(wb.ins) && destOf(wb.ins) === reg2 && reg2 !== 0) return { v: wb.val, from: 'MEM/WB' };
      return null;
    };
    if (s[0] !== undefined) { const f = tryFwd(s[0]); if (f) { va = f.v; ex.fwdA = f.from; ev.fwd.push({ to: 'A', from: f.from }); } }
    if (s[1] !== undefined) { const f = tryFwd(s[1]); if (f) { vb2 = f.v; ex.fwdB = f.from; ev.fwd.push({ to: 'B', from: f.from }); } }
  }
  let alu = 0, branchTaken = false;
  if (ex.valid) {
    const i2 = ex.ins;
    if (i2.op === OP.LDI) alu = i2.b;
    else if (i2.op === OP.ADD) alu = (va + vb2) & 0x1ff;
    else if (i2.op === OP.SUB) alu = (va - vb2) & 0xff;
    else if (i2.op === OP.AND) alu = va & vb2;
    else if (i2.op === OP.LD) alu = (va + i2.c) & 0xff;      /* 基址在 A 槽（前递可达） */
    else if (i2.op === OP.ST) alu = (vb2 + i2.c) & 0xff;
    else if (i2.op === OP.BEQ) branchTaken = va === vb2;
    if (i2.op === OP.ADD || i2.op === OP.SUB) {
      /* 逐位全加器记录（SUB 用补码：B 取反 + 进位 1） */
      const bIn = i2.op === OP.SUB ? (~vb2 & 0xff) : (vb2 & 0xff);
      const c0 = i2.op === OP.SUB ? 1 : 0;
      const bits = [];
      let carry = c0;
      for (let b3 = 0; b3 < 8; b3++) {
        const ab = (va >> b3) & 1, bb = (bIn >> b3) & 1;
        const sum = ab ^ bb ^ carry;
        const cout = (ab & bb) | (carry & (ab ^ bb));
        bits.push({ a: ab, b: bb, cin: carry, s: sum, cout });
        carry = cout;
      }
      ev.adder = { a: va & 0xff, b: vb2 & 0xff, op: i2.op, bits, out: alu & 0xff, cout: carry };
    }
    alu &= 0xff;
    g[ex.tag] = 'E';
  }
  const new_ex_mem = {
    ins: ex.valid ? ex.ins : NOPI, alu, vb: ex.ins.op === OP.ST ? va : vb2,
    valid: ex.valid, tag: ex.tag,
  };
  /* ST 的待写值是 Ra（第一源），上面 va 已含前递 */

  /* ---- ID + 冒险检测 ---- */
  const fd = c.if_id;
  let stall = false;
  if (fd.valid) {
    const s = srcsOf(fd.ins).filter((r) => r !== 0);
    /* load-use：EX 里是 LD 且目的being用 */
    if (ex.valid && ex.ins.op === OP.LD && s.includes(destOf(ex.ins))) stall = true;
    if (!c.forwarding) {
      /* 无前递：任何在飞的写都得等 */
      [ex, mx, wb].forEach((st) => {
        if (st.valid && writesReg(st.ins) && s.includes(destOf(st.ins))) stall = true;
      });
    }
  }
  ev.stall = stall;
  let new_id_ex;
  if (stall) {
    new_id_ex = { ins: NOPI, va: 0, vb: 0, valid: false, tag: -1, fwdA: '', fwdB: '' };
    if (fd.valid) g[fd.tag] = 's';
  } else if (fd.valid) {
    const i3 = fd.ins;
    const s = srcsOf(i3);
    new_id_ex = {
      ins: i3,
      va: s[0] !== undefined ? c.reg[s[0]] : 0,
      vb: s[1] !== undefined ? c.reg[s[1]] : (i3.op === OP.LD || i3.op === OP.ST ? c.reg[i3.b] : 0),
      valid: true, tag: fd.tag, fwdA: '', fwdB: '',
    };
    /* LD：基址进 A 槽；ST：待存值进 A、基址进 B（与 srcsOf 的前递槽位一致） */
    if (i3.op === OP.LD) {
      new_id_ex.va = c.reg[i3.b];
      new_id_ex.vb = 0;
    } else if (i3.op === OP.ST) {
      new_id_ex.va = c.reg[i3.a];
      new_id_ex.vb = c.reg[i3.b];
    }
    g[fd.tag] = 'D';
  } else {
    new_id_ex = { ins: NOPI, va: 0, vb: 0, valid: false, tag: -1, fwdA: '', fwdB: '' };
  }

  /* ---- 分支冲刷 ---- */
  let new_if_id, newPc = c.pc;
  if (branchTaken) {
    ev.flush = true;
    c.fetchedHalt = false;   /* 被冲掉的 HALT 不作数，恢复取指 */
    const off = ex.ins.c > 7 ? ex.ins.c - 16 : ex.ins.c;
    newPc = (ex.pcAt + 1 + off) & 15;
    if (fd.valid) g[fd.tag] = 'x';
    if (new_id_ex.valid) { g[new_id_ex.tag] = 'x'; }
    new_if_id = { ins: NOPI, pc: 0, valid: false, tag: -1 };
    new_id_ex = { ins: NOPI, va: 0, vb: 0, valid: false, tag: -1, fwdA: '', fwdB: '' };
  } else if (stall) {
    new_if_id = fd;   /* 保持 */
  } else {
    /* ---- IF ---- */
    const fetched = c.imem[c.pc];
    if (fetched && !c.fetchedHalt) {
      new_if_id = { ins: fetched, pc: c.pc, valid: true, tag: c.fetchTag };
      g[c.fetchTag] = 'F';
      c.fetchTag++;
      if (fetched.op === OP.HALT) c.fetchedHalt = true;
      newPc = (c.pc + 1) & 15;
    } else {
      new_if_id = { ins: NOPI, pc: c.pc, valid: false, tag: -1 };
    }
  }
  new_id_ex.pcAt = stall || branchTaken ? 0 : (fd.valid ? fd.pc : 0);

  c.retired = wb.valid ? { ins: wb.ins, tag: wb.tag } : null;
  c.mem_wb = new_mem_wb;
  c.ex_mem = new_ex_mem;
  c.id_ex = new_id_ex;
  c.if_id = new_if_id;
  c.pc = newPc;
  c.cycle++;
  c.events = ev;
  c.gantt.push(g);
}

/* ---------- 可视化 ---------- */
function pal() {
  const cs = getComputedStyle(document.body), o = {};
  ['--ink', '--ink2', '--line', '--surface', '--surface2', '--accent', '--play',
   '--c-render', '--c-engine', '--c-char', '--c-tool', '--c-ai', '--c-life'].forEach((k) => {
    o[k.slice(2)] = cs.getPropertyValue(k).trim();
  });
  return o;
}
const CHIP_COLS = ['c-render', 'c-engine', 'c-char', 'c-tool', 'c-ai', 'c-life'];

function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const $ = (id) => document.getElementById(id);
  const ui = {
    prog: $('cp-prog'), fwd: $('cp-fwd'), step: $('cp-step'), run: $('cp-run'),
    speed: $('cp-speed'), reset: $('cp-reset'), note: $('cp-note'),
  };
  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, H = Math.round(wrapW * 0.72);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * dpr; cvs.height = H * dpr;
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const g = cvs.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  let cpu = null, running = false, animT = 1, lastStep = 0;

  function reset() {
    const key = (ui.prog && ui.prog.value) || 'add';
    cpu = makeCPU(PROGRAMS[key].code, !ui.fwd || ui.fwd.checked);
    cpu.events = { fwd: [], stall: false, flush: false, adder: null, wbWrite: null, memOp: null };
    running = false;
    animT = 1;
    if (ui.run) ui.run.textContent = '▶ 运行';
    if (ui.note) ui.note.textContent = PROGRAMS[key].note;
    draw();
  }
  function doStep() {
    if (cpu.done) return;
    stepCPU(cpu);
    animT = 0;
  }

  /* ---- 布局 ---- */
  const SX = 14, SW = (W - 28) / 5, SY = 52, SH = 118;
  const STAGES = ['IF 取指', 'ID 译码', 'EX 执行', 'MEM 访存', 'WB 写回'];

  function chipCol(P, tag) { return P[CHIP_COLS[(tag >= 0 ? tag : 0) % CHIP_COLS.length]]; }

  function drawChip(P, x, y, w, ins, tag, dim) {
    g.globalAlpha = dim ? 0.35 : 1;
    g.fillStyle = chipCol(P, tag);
    g.fillRect(x, y, w, 22);
    g.fillStyle = '#0b0d12';
    g.font = '600 11px Consolas,monospace';
    g.textAlign = 'center';
    g.fillText(iText(ins), x + w / 2, y + 15);
    g.globalAlpha = 1;
  }

  function draw() {
    const P = pal();
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    const ev = cpu.events;

    /* 阶段框 */
    for (let i = 0; i < 5; i++) {
      const x = SX + i * SW;
      g.strokeStyle = P.line;
      g.strokeRect(x + 4, SY, SW - 8, SH);
      g.fillStyle = P.ink2;
      g.font = '600 11px Consolas,monospace';
      g.textAlign = 'left';
      g.fillText(STAGES[i], x + 12, SY - 8);
      /* 级间寄存器竖条 */
      if (i < 4) {
        g.fillStyle = P.surface2;
        g.fillRect(x + SW - 4, SY, 8, SH);
        g.strokeRect(x + SW - 4, SY, 8, SH);
      }
    }
    g.fillStyle = P.ink2;
    g.font = '11px Consolas,monospace';
    g.textAlign = 'right';
    g.fillText('PC = ' + cpu.pc + ' · 前递 ' + (cpu.forwarding ? 'ON' : 'OFF'), W - 18, 18);

    /* 各级当前指令 chip（带滑入动画） */
    const slide = 1 - Math.pow(1 - Math.min(animT, 1), 3);
    const stages = [
      { st: cpu.if_id, i: 0, extra: (x, y) => { g.fillText('PC→' + cpu.if_id.pc, x, y); } },
      { st: cpu.id_ex, i: 1, extra: (x, y) => {
        if (cpu.id_ex.valid) g.fillText('A=' + cpu.id_ex.va + ' B=' + cpu.id_ex.vb, x, y);
      } },
      { st: cpu.ex_mem, i: 2, extra: (x, y) => {
        if (cpu.ex_mem.valid) g.fillText('ALU=' + cpu.ex_mem.alu, x, y);
      } },
      { st: cpu.mem_wb, i: 3, extra: (x, y) => {
        if (ev.memOp) g.fillText(ev.memOp.kind + ' [' + ev.memOp.addr + ']=' + ev.memOp.val, x, y);
      } },
      { st: null, i: 4, extra: (x, y) => {
        if (ev.wbWrite) g.fillText('R' + ev.wbWrite.r + ' ← ' + ev.wbWrite.v, x, y);
      } },
    ];
    stages.forEach(({ st, i, extra }) => {
      const bx = SX + i * SW + 12;
      const bw = SW - 24;
      let show = null, tag = -1;
      if (i === 4) {
        if (cpu.retired) { show = cpu.retired.ins; tag = cpu.retired.tag; }
      } else if (st && st.valid) { show = st.ins; tag = st.tag; }
      if (show && show.op !== OP.NOP) {
        const fromX = SX + Math.max(i - 1, 0) * SW + 12;
        const x = fromX + (bx - fromX) * slide;
        drawChip(P, x, SY + 12, bw, show, tag, false);
      } else if (i === 1 && (ev.stall || ev.flush)) {
        g.fillStyle = P.surface2;
        g.fillRect(bx, SY + 12, bw, 22);
        g.fillStyle = P.ink2;
        g.font = '11px Consolas,monospace';
        g.textAlign = 'center';
        g.fillText(ev.flush ? '✕ 冲刷' : '○ 气泡', bx + bw / 2, SY + 27);
      }
      g.fillStyle = P.ink2;
      g.font = '10.5px Consolas,monospace';
      g.textAlign = 'left';
      extra(bx, SY + 52);
    });

    /* 前递箭头 */
    if (ev.fwd.length) {
      g.strokeStyle = P.play;
      g.fillStyle = P.play;
      g.lineWidth = 1.6;
      ev.fwd.forEach((f, k) => {
        const srcI = f.from === 'EX/MEM' ? 3 : 4;
        const x1 = SX + srcI * SW + 12;
        const x2 = SX + 2 * SW + SW / 2 + (f.to === 'A' ? -22 : 22);
        const y0 = SY + SH - 16 - k * 10;
        g.beginPath();
        g.moveTo(x1, SY + 40);
        g.lineTo(x1, y0);
        g.lineTo(x2, y0);
        g.lineTo(x2, SY + 44);
        g.stroke();
        g.beginPath();
        g.moveTo(x2, SY + 40);
        g.lineTo(x2 - 4, SY + 48);
        g.lineTo(x2 + 4, SY + 48);
        g.closePath();
        g.fill();
        g.font = '10px Consolas,monospace';
        g.textAlign = 'left';
        g.fillText('前递→' + f.to, Math.min(x1, x2) + 6, y0 - 3);
      });
      g.lineWidth = 1;
    }
    if (ev.stall) {
      g.fillStyle = P['c-render'];
      g.font = '600 11px Consolas,monospace';
      g.textAlign = 'center';
      g.fillText('⚠ 冒险停顿：IF/ID 保持，向 EX 注入气泡', SX + SW * 1.5, SY + SH + 16);
    }
    if (ev.flush) {
      g.fillStyle = P['c-render'];
      g.font = '600 11px Consolas,monospace';
      g.textAlign = 'center';
      g.fillText('⚡ 分支跳转：冲刷 IF/ID 与 ID/EX', SX + SW * 1.5, SY + SH + 16);
    }

    /* ---- 8 位全加器（EX 有 ADD/SUB 时） ---- */
    const AY = SY + SH + 34;
    g.fillStyle = P.ink2;
    g.font = '600 11px Consolas,monospace';
    g.textAlign = 'left';
    g.fillText('ALU · 8 位行波进位加法器', SX + 4, AY - 6);
    const cellW = Math.min(52, (W - 100) / 8), AX = SX + 44;
    if (ev.adder) {
      const ad = ev.adder;
      /* 进位涟漪：animT 从 0→1 依次点亮 bit0→bit7 */
      const lit = Math.floor(Math.min(animT * 1.6, 1) * 8.99);
      for (let b = 0; b < 8; b++) {
        const x = AX + (7 - b) * cellW;   /* 高位在左 */
        const on = b < lit;
        g.strokeStyle = on ? P.accent : P.line;
        g.strokeRect(x, AY, cellW - 6, 64);
        g.font = '10px Consolas,monospace';
        g.fillStyle = P.ink2;
        g.textAlign = 'center';
        const bit = ad.bits[b];
        g.fillText('a' + b + '=' + bit.a + ' b' + b + '=' + bit.b, x + (cellW - 6) / 2, AY + 14);
        g.fillStyle = on ? P.play : P.ink2;
        g.fillText('cin ' + bit.cin, x + (cellW - 6) / 2, AY + 28);
        g.font = '600 15px Consolas,monospace';
        g.fillStyle = on ? P.ink : P.ink2;
        g.fillText(on ? String(bit.s) : '·', x + (cellW - 6) / 2, AY + 48);
        /* 进位线 */
        if (b < 7) {
          g.strokeStyle = on && bit.cout ? P.play : P.line;
          g.lineWidth = on && bit.cout ? 2 : 1;
          g.beginPath();
          g.moveTo(x, AY + 24);
          g.lineTo(x - 6, AY + 24);
          g.stroke();
          g.lineWidth = 1;
        }
      }
      g.font = '11px Consolas,monospace';
      g.fillStyle = P.ink2;
      g.textAlign = 'left';
      const opc = ad.op === OP.SUB ? '−' : '+';
      g.fillText(ad.a + ' ' + opc + ' ' + ad.b, SX + 4, AY + 30);
      g.textAlign = 'right';
      if (lit >= 8) {
        g.fillStyle = P.play;
        g.font = '600 13px Consolas,monospace';
        g.fillText('= ' + ad.out + '  (0b' + ad.out.toString(2).padStart(8, '0') + ')' + (ad.cout ? ' 进位溢出' : ''), W - 18, AY + 78);
      }
    } else {
      for (let b = 0; b < 8; b++) {
        g.strokeStyle = P.line;
        g.strokeRect(AX + (7 - b) * cellW, AY, cellW - 6, 64);
      }
      g.fillStyle = P.ink2;
      g.font = '11px Consolas,monospace';
      g.textAlign = 'left';
      g.fillText('（EX 阶段有 ADD/SUB 时，这里逐位展示进位涟漪）', AX, AY + 80);
    }

    /* ---- 甘特图 ---- */
    const GY = AY + 100;
    g.fillStyle = P.ink2;
    g.font = '600 11px Consolas,monospace';
    g.textAlign = 'left';
    g.fillText('流水线时空图（行 = 指令，列 = 周期）', SX + 4, GY - 6);
    const rows = cpu.fetchTag;
    const cellH2 = 16, cellW2 = 22;
    const maxCols = Math.floor((W - 190) / cellW2);
    const c0 = Math.max(0, cpu.gantt.length - maxCols);
    /* 找每条指令的文本（按 tag 找程序序） */
    const tagToText = {};
    {
      /* 重放 fetch 顺序太重——用 gantt 里首次出现的 F 反查不了文本；
         直接重新模拟 tag→指令：按程序静态顺序 + 分支目标无法静态推；
         简化：在 stepCPU 里我们没存，这里从各级在飞指令收集 + 历史缓存 */
    }
    if (!cpu.tagText) cpu.tagText = {};
    [[cpu.if_id], [cpu.id_ex], [cpu.ex_mem], [cpu.mem_wb]].forEach((a) => {
      a.forEach((st) => { if (st.valid && st.tag >= 0) cpu.tagText[st.tag] = iText(st.ins); });
    });
    for (let r = 0; r < rows; r++) {
      const y = GY + r * cellH2;
      if (y > H - 90) break;
      g.fillStyle = chipCol(P, r);
      g.fillRect(SX + 4, y + 3, 8, 8);
      g.fillStyle = P.ink2;
      g.font = '10px Consolas,monospace';
      g.textAlign = 'left';
      g.fillText((cpu.tagText[r] || '').slice(0, 14), SX + 17, y + 11);
      for (let cc = c0; cc < cpu.gantt.length; cc++) {
        const s = cpu.gantt[cc][r];
        if (!s) continue;
        const x = SX + 150 + (cc - c0) * cellW2;
        const isB = s === 's' || s === 'x';
        g.fillStyle = isB ? P.surface2 : chipCol(P, r);
        g.globalAlpha = isB ? 1 : 0.85;
        g.fillRect(x, y + 1, cellW2 - 2, cellH2 - 3);
        g.globalAlpha = 1;
        g.fillStyle = isB ? P['c-render'] : '#0b0d12';
        g.font = '600 10px Consolas,monospace';
        g.textAlign = 'center';
        g.fillText(s === 's' ? '○' : s === 'x' ? '✕' : s, x + cellW2 / 2 - 1, y + 12);
      }
    }

    /* ---- 寄存器 / 内存 ---- */
    const RY = H - 64;
    g.fillStyle = P.ink2;
    g.font = '600 11px Consolas,monospace';
    g.textAlign = 'left';
    g.fillText('寄存器', SX + 4, RY - 4);
    for (let r = 0; r < 8; r++) {
      const x = SX + 4 + r * 54;
      const hot = ev.wbWrite && ev.wbWrite.r === r;
      g.strokeStyle = hot ? P.play : P.line;
      g.strokeRect(x, RY, 48, 20);
      g.fillStyle = hot ? P.play : P.ink;
      g.font = '11px Consolas,monospace';
      g.textAlign = 'center';
      g.fillText('R' + r + '=' + cpu.reg[r], x + 24, RY + 14);
    }
    g.fillStyle = P.ink2;
    g.font = '600 11px Consolas,monospace';
    g.textAlign = 'left';
    g.fillText('数据内存', SX + 4, RY + 36);
    for (let m = 0; m < 16; m++) {
      const x = SX + 70 + m * 32;
      if (x > W - 40) break;
      const hot = ev.memOp && ev.memOp.addr === m;
      g.fillStyle = hot ? P.play : P.ink2;
      g.font = '10px Consolas,monospace';
      g.textAlign = 'center';
      g.fillText(String(cpu.mem[m]), x, RY + 36);
      g.fillText('[' + m + ']', x, RY + 47);
    }
  }

  /* ---- 主循环 ---- */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const spd = parseFloat((ui.speed && ui.speed.value) || '1');
    const cycleMs = 1400 / spd;
    if (animT < 1) {
      animT = Math.min(1, animT + 16 / (cycleMs * 0.6));
      draw();
    }
    if (running && !cpu.done && ts - lastStep > cycleMs) {
      lastStep = ts;
      doStep();
    }
    if (running && cpu.done) {
      running = false;
      if (ui.run) ui.run.textContent = '▶ 运行';
      draw();
    }
    if (hud) {
      hud.textContent = 'CYCLE ' + cpu.cycle + ' · ' + (cpu.done ? '程序完成' : running ? '运行中' : '暂停') +
        ' · CPI 观察：' + (cpu.fetchTag ? (cpu.cycle / Math.max(cpu.fetchTag, 1)).toFixed(2) : '—');
    }
  }

  if (ui.step) ui.step.addEventListener('click', () => { running = false; if (ui.run) ui.run.textContent = '▶ 运行'; doStep(); });
  if (ui.run) ui.run.addEventListener('click', () => {
    running = !running;
    ui.run.textContent = running ? '⏸ 暂停' : '▶ 运行';
    lastStep = 0;
  });
  if (ui.reset) ui.reset.addEventListener('click', reset);
  if (ui.prog) ui.prog.addEventListener('change', reset);
  if (ui.fwd) ui.fwd.addEventListener('change', reset);

  reset();
  if (location.hash === '#run') {
    running = true;
    if (ui.run) ui.run.textContent = '⏸ 暂停';
  }
  requestAnimationFrame(loop);
}

main();
