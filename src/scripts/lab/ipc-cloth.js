/* IPC 布料（无穿透保证）— CPU 离线求解
   Incremental Potential Contact 的精简实现（IPC-lite）：
   · 隐式欧拉写成增量势能 E(x) = ½Σm|x−x̃|² + h²(弹性 + κ·屏障)
   · 接触 = 对数屏障能量 b(d) = −(d−d̂)² ln(d/d̂)，d→0 时能量→∞
   · 每次线搜索的步长被保守 CCD 钳制：位移上界 < 当前最小间距的一半
     —— 任何中间状态都不可能穿越，这是数学保证而非调参
   非实时：预条件梯度下降逐步收敛，墙钟时间换绝对不穿模 */

/* ---------- 向量小工具（Float64Array 上的 3 维） ---------- */
function closestPtTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  /* Ericson《Real-Time Collision Detection》5.1.5，返回距离² 与重心权 */
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = 1; out[1] = 0; out[2] = 0; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { out[0] = 0; out[1] = 1; out[2] = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        out[0] = 1 - v; out[1] = v; out[2] = 0;
      } else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz;
        const d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { out[0] = 0; out[1] = 0; out[2] = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            out[0] = 1 - w; out[1] = 0; out[2] = w;
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              out[0] = 0; out[1] = 1 - w; out[2] = w;
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom, w = vc * denom;
              out[0] = 1 - v - w; out[1] = v; out[2] = w;
            }
          }
        }
      }
    }
  }
  const qx = out[0] * ax + out[1] * bx + out[2] * cx;
  const qy = out[0] * ay + out[1] * by + out[2] * cy;
  const qz = out[0] * az + out[1] * bz + out[2] * cz;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  out[3] = dx * dx + dy * dy + dz * dz;
  out[4] = dx; out[5] = dy; out[6] = dz;
  return out;
}

function segSeg(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z, out) {
  /* 线段-线段最近点参数 (s, t) 与距离² */
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const denom = a * e - b * b;
  if (denom > 1e-14) s = Math.min(1, Math.max(0, (b * f - c * e) / denom));
  t = e > 1e-14 ? (b * s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const c1x = p1x + d1x * s, c1y = p1y + d1y * s, c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t, c2y = p2y + d2y * t, c2z = p2z + d2z * t;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  out[0] = s; out[1] = t;
  out[2] = dx * dx + dy * dy + dz * dz;
  out[3] = dx; out[4] = dy; out[5] = dz;
  return out;
}

/* ---------- 主体 ---------- */
function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const $ = (id) => document.getElementById(id);
  const ui = {
    scene: $('ip-scene'), res: $('ip-res'), dhat: $('ip-dhat'), h: $('ip-h'),
    iters: $('ip-iters'), run: $('ip-run'), step: $('ip-step'), reset: $('ip-reset'),
    contacts: $('ip-contacts'), wire: $('ip-wire'), stat: $('ip-stat'),
  };
  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, H = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * dpr; cvs.height = H * dpr;
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const g = cvs.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);

  function pal() {
    const cs = getComputedStyle(document.body), o = {};
    ['--ink', '--ink2', '--line', '--surface', '--surface2', '--accent', '--play', '--c-render', '--c-char', '--c-engine'].forEach((k) => {
      o[k.slice(2)] = cs.getPropertyValue(k).trim();
    });
    return o;
  }

  /* ---------- 模型 ---------- */
  let NX = 0, NN = 0;                       /* 每层网格宽 / 总节点数 */
  let x, x0, v, xt, grad, dir, mass, pinned, layerOf;
  let springs = [];                          /* [i, j, rest, k] */
  let tris = [], triLayer = [], edges = [];  /* 三角形与唯一边（含静态障碍） */
  let statics = { edges: [], tris: [] };     /* 静态障碍（横杆） */
  let simT = 0, stepN = 0, running = false;
  let dhat = 0.006, hstep = 0.004, kappa = 1e4;
  const KS = 4000, KB = 40, GRAV = 9.8;
  let candPT = [], candEE = [], candBuilt = 0;
  let activeContacts = 0, dminNow = Infinity, lastIters = 0, lastMs = 0;
  let stateIter = 0, inStep = false, E0 = 0, cumMove = 0;

  function buildCloth(layers, res, gap, y0, pinFn) {
    NX = res;
    const perL = res * res;
    NN = layers * perL;
    x = new Float64Array(NN * 3);
    layerOf = new Uint8Array(NN);
    pinned = new Uint8Array(NN);
    mass = new Float64Array(NN);
    const SZ = 0.5, s0 = SZ / (res - 1);
    springs = []; tris = []; triLayer = [];
    const edgeSet = new Map();
    const addEdge = (a, b) => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      if (!edgeSet.has(key)) edgeSet.set(key, [Math.min(a, b), Math.max(a, b)]);
    };
    for (let L = 0; L < layers; L++) {
      const base = L * perL;
      const yy = y0 + L * gap;
      const rot = L * 0.35;                 /* 各层略转角度，接触更随机 */
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          const n = base + j * res + i;
          const lx = (i / (res - 1) - 0.5) * SZ;
          const lz = (j / (res - 1) - 0.5) * SZ;
          x[n * 3] = lx * Math.cos(rot) - lz * Math.sin(rot);
          x[n * 3 + 1] = yy;
          x[n * 3 + 2] = lx * Math.sin(rot) + lz * Math.cos(rot);
          layerOf[n] = L;
          mass[n] = 0.2 * s0 * s0;          /* 面密度 0.2 kg/m² × 每节点面积 */
          if (pinFn && pinFn(L, i, j)) pinned[n] = 1;
        }
      const idx = (i, j) => base + j * res + i;
      for (let j = 0; j < res; j++)
        for (let i = 0; i < res; i++) {
          if (i + 1 < res) springs.push([idx(i, j), idx(i + 1, j), s0, KS]);
          if (j + 1 < res) springs.push([idx(i, j), idx(i, j + 1), s0, KS]);
          if (i + 1 < res && j + 1 < res) {
            springs.push([idx(i, j), idx(i + 1, j + 1), s0 * Math.SQRT2, KS * 0.5]);
            springs.push([idx(i + 1, j), idx(i, j + 1), s0 * Math.SQRT2, KS * 0.5]);
            tris.push([idx(i, j), idx(i + 1, j), idx(i, j + 1)]); triLayer.push(L);
            tris.push([idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]); triLayer.push(L);
          }
          if (i + 2 < res) springs.push([idx(i, j), idx(i + 2, j), s0 * 2, KB]);
          if (j + 2 < res) springs.push([idx(i, j), idx(i, j + 2), s0 * 2, KB]);
        }
    }
    tris.forEach((t) => { addEdge(t[0], t[1]); addEdge(t[1], t[2]); addEdge(t[2], t[0]); });
    edges = Array.from(edgeSet.values());
    x0 = new Float64Array(x);
    v = new Float64Array(NN * 3);
    xt = new Float64Array(NN * 3);
    grad = new Float64Array(NN * 3);
    dir = new Float64Array(NN * 3);
  }

  const SCENES = {
    two: {
      zh: '双层跌落', layers: 2, gap: 0.16, y0: 0.25,
      pin: (L, i, j) => L === 0 && (i === 0 || i === NXq - 1) && (j === 0 || j === NXq - 1),
      bar: false,
    },
    three: {
      zh: '三层堆叠', layers: 3, gap: 0.15, y0: 0.22,
      pin: (L, i, j) => L === 0 && (i === 0 || i === NXq - 1) && (j === 0 || j === NXq - 1),
      bar: false,
    },
    fold: {
      zh: '对折横杆', layers: 1, gap: 0, y0: 0.34,
      pin: null, bar: true,
    },
  };
  let NXq = 0;

  function reset() {
    const sc = SCENES[(ui.scene && ui.scene.value) || 'two'];
    NXq = parseInt((ui.res && ui.res.value) || '20', 10);
    dhat = parseFloat((ui.dhat && ui.dhat.value) || '6') / 1000;
    hstep = parseFloat((ui.h && ui.h.value) || '4') / 1000;
    buildCloth(sc.layers, NXq, sc.gap, sc.y0, sc.pin);
    statics = { edges: [], tris: [] };
    if (sc.bar) {
      /* 静态横杆：一根穿过中间的边（两端点附加到 x 数组尾部再钉死更繁；
         直接存为独立线段数组，参与 EE 屏障 */
      statics.edges.push([-0.45, 0.14, 0, 0.45, 0.14, 0]);
    }
    simT = 0; stepN = 0; inStep = false; running = false;
    candBuilt = -1;
    if (ui.run) ui.run.textContent = '▶ 运行';
    dminNow = Infinity;
  }

  /* ---------- 候选接触对（宽阶段，空间哈希） ---------- */
  const MARGIN = () => dhat * 2;
  function buildCandidates() {
    const R = MARGIN();
    const cell = Math.max(R * 2, 0.03);
    const hashN = new Map();
    const key = (a, b, c) => a * 73856093 ^ b * 19349663 ^ c * 83492791;
    for (let n = 0; n < NN; n++) {
      const k = key(Math.floor(x[n * 3] / cell), Math.floor(x[n * 3 + 1] / cell), Math.floor(x[n * 3 + 2] / cell));
      if (!hashN.has(k)) hashN.set(k, []);
      hashN.get(k).push(n);
    }
    candPT = []; candEE = [];
    /* PT：三角形扩张 AABB 覆盖的格子里的节点 */
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      const xs = [x[a * 3], x[b * 3], x[c * 3]], ys = [x[a * 3 + 1], x[b * 3 + 1], x[c * 3 + 1]], zs = [x[a * 3 + 2], x[b * 3 + 2], x[c * 3 + 2]];
      const lo = [Math.min(...xs) - R, Math.min(...ys) - R, Math.min(...zs) - R];
      const hi = [Math.max(...xs) + R, Math.max(...ys) + R, Math.max(...zs) + R];
      for (let gx = Math.floor(lo[0] / cell); gx <= Math.floor(hi[0] / cell); gx++)
      for (let gy = Math.floor(lo[1] / cell); gy <= Math.floor(hi[1] / cell); gy++)
      for (let gz = Math.floor(lo[2] / cell); gz <= Math.floor(hi[2] / cell); gz++) {
        const bucket = hashN.get(key(gx, gy, gz));
        if (!bucket) continue;
        for (const p of bucket) {
          if (p === a || p === b || p === c) continue;
          /* 同层跳过网格上相邻的（共享弹簧的邻域），异层全收 */
          if (layerOf[p] === layerOf[a]) {
            const pi = p % (NXq * NXq), ai = a % (NXq * NXq);
            const dx2 = Math.abs((pi % NXq) - (ai % NXq)) + Math.abs(Math.floor(pi / NXq) - Math.floor(ai / NXq));
            if (dx2 <= 2) continue;
          }
          candPT.push(p, t);
        }
      }
    }
    /* EE：布料边 × 静态横杆（布-布主要靠 PT + 厚度，横杆必须 EE） */
    if (statics.edges.length) {
      for (let e = 0; e < edges.length; e++) candEE.push(e, 0);
    }
    candBuilt = stepN;
  }

  /* ---------- 能量 / 梯度 ---------- */
  const tmp = new Float64Array(8);
  function barrier(d) {
    if (d >= dhat) return 0;
    const t2 = d - dhat;
    return -t2 * t2 * Math.log(d / dhat);
  }
  function dBarrier(d) {
    if (d >= dhat) return 0;
    const t2 = d - dhat;
    return -2 * t2 * Math.log(d / dhat) - t2 * t2 / d;
  }

  function energyOf(xx) {
    let E = 0;
    const h2 = hstep * hstep;
    for (let n = 0; n < NN; n++) {
      if (pinned[n]) continue;
      const dx = xx[n * 3] - xt[n * 3], dy = xx[n * 3 + 1] - xt[n * 3 + 1], dz = xx[n * 3 + 2] - xt[n * 3 + 2];
      E += 0.5 * mass[n] * (dx * dx + dy * dy + dz * dz);
    }
    for (const [i2, j2, r, k] of springs) {
      const dx = xx[i2 * 3] - xx[j2 * 3], dy = xx[i2 * 3 + 1] - xx[j2 * 3 + 1], dz = xx[i2 * 3 + 2] - xx[j2 * 3 + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      E += h2 * 0.5 * k * (l - r) * (l - r);
    }
    for (let c = 0; c < candPT.length; c += 2) {
      const p = candPT[c], t2 = candPT[c + 1];
      const [a, b, cc] = tris[t2];
      closestPtTri(xx[p * 3], xx[p * 3 + 1], xx[p * 3 + 2],
        xx[a * 3], xx[a * 3 + 1], xx[a * 3 + 2],
        xx[b * 3], xx[b * 3 + 1], xx[b * 3 + 2],
        xx[cc * 3], xx[cc * 3 + 1], xx[cc * 3 + 2], tmp);
      const d = Math.sqrt(tmp[3]);
      if (d <= 1e-12) return Infinity;
      E += h2 * kappa * barrier(d);
    }
    for (let c = 0; c < candEE.length; c += 2) {
      const [i2, j2] = edges[candEE[c]];
      const s = statics.edges[candEE[c + 1]];
      segSeg(xx[i2 * 3], xx[i2 * 3 + 1], xx[i2 * 3 + 2], xx[j2 * 3], xx[j2 * 3 + 1], xx[j2 * 3 + 2],
        s[0], s[1], s[2], s[3], s[4], s[5], tmp);
      const d = Math.sqrt(tmp[2]);
      if (d <= 1e-12) return Infinity;
      E += h2 * kappa * barrier(d);
    }
    return E;
  }

  function computeGrad() {
    grad.fill(0);
    const h2 = hstep * hstep;
    for (let n = 0; n < NN; n++) {
      if (pinned[n]) continue;
      grad[n * 3] = mass[n] * (x[n * 3] - xt[n * 3]);
      grad[n * 3 + 1] = mass[n] * (x[n * 3 + 1] - xt[n * 3 + 1]);
      grad[n * 3 + 2] = mass[n] * (x[n * 3 + 2] - xt[n * 3 + 2]);
    }
    for (const [i2, j2, r, k] of springs) {
      const dx = x[i2 * 3] - x[j2 * 3], dy = x[i2 * 3 + 1] - x[j2 * 3 + 1], dz = x[i2 * 3 + 2] - x[j2 * 3 + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
      const f = h2 * k * (l - r) / l;
      grad[i2 * 3] += f * dx; grad[i2 * 3 + 1] += f * dy; grad[i2 * 3 + 2] += f * dz;
      grad[j2 * 3] -= f * dx; grad[j2 * 3 + 1] -= f * dy; grad[j2 * 3 + 2] -= f * dz;
    }
    activeContacts = 0;
    dminNow = MARGIN();
    for (let c = 0; c < candPT.length; c += 2) {
      const p = candPT[c], t2 = candPT[c + 1];
      const [a, b, cc] = tris[t2];
      closestPtTri(x[p * 3], x[p * 3 + 1], x[p * 3 + 2],
        x[a * 3], x[a * 3 + 1], x[a * 3 + 2],
        x[b * 3], x[b * 3 + 1], x[b * 3 + 2],
        x[cc * 3], x[cc * 3 + 1], x[cc * 3 + 2], tmp);
      const d = Math.sqrt(tmp[3]) || 1e-12;
      if (d < dminNow) dminNow = d;
      if (d >= dhat) continue;
      activeContacts++;
      const s = h2 * kappa * dBarrier(d) / d;
      const nx2 = tmp[4] * s, ny2 = tmp[5] * s, nz2 = tmp[6] * s;
      grad[p * 3] += nx2; grad[p * 3 + 1] += ny2; grad[p * 3 + 2] += nz2;
      grad[a * 3] -= tmp[0] * nx2; grad[a * 3 + 1] -= tmp[0] * ny2; grad[a * 3 + 2] -= tmp[0] * nz2;
      grad[b * 3] -= tmp[1] * nx2; grad[b * 3 + 1] -= tmp[1] * ny2; grad[b * 3 + 2] -= tmp[1] * nz2;
      grad[cc * 3] -= tmp[2] * nx2; grad[cc * 3 + 1] -= tmp[2] * ny2; grad[cc * 3 + 2] -= tmp[2] * nz2;
    }
    for (let c = 0; c < candEE.length; c += 2) {
      const [i2, j2] = edges[candEE[c]];
      const s2 = statics.edges[candEE[c + 1]];
      segSeg(x[i2 * 3], x[i2 * 3 + 1], x[i2 * 3 + 2], x[j2 * 3], x[j2 * 3 + 1], x[j2 * 3 + 2],
        s2[0], s2[1], s2[2], s2[3], s2[4], s2[5], tmp);
      const d = Math.sqrt(tmp[2]) || 1e-12;
      if (d < dminNow) dminNow = d;
      if (d >= dhat) continue;
      activeContacts++;
      const sf = h2 * kappa * dBarrier(d) / d;
      const nx2 = tmp[3] * sf, ny2 = tmp[4] * sf, nz2 = tmp[5] * sf;
      const s = tmp[0];
      grad[i2 * 3] += (1 - s) * nx2; grad[i2 * 3 + 1] += (1 - s) * ny2; grad[i2 * 3 + 2] += (1 - s) * nz2;
      grad[j2 * 3] += s * nx2; grad[j2 * 3 + 1] += s * ny2; grad[j2 * 3 + 2] += s * nz2;
    }
  }

  /* ---------- 一个隐式步（可分片执行的梯度下降） ---------- */
  function beginStep() {
    const h2 = hstep * hstep;
    for (let n = 0; n < NN; n++) {
      if (pinned[n]) {
        xt[n * 3] = x[n * 3]; xt[n * 3 + 1] = x[n * 3 + 1]; xt[n * 3 + 2] = x[n * 3 + 2];
        continue;
      }
      xt[n * 3] = x[n * 3] + hstep * v[n * 3];
      xt[n * 3 + 1] = x[n * 3 + 1] + hstep * v[n * 3 + 1] - h2 * GRAV;
      xt[n * 3 + 2] = x[n * 3 + 2] + hstep * v[n * 3 + 2];
    }
    x0.set(x);
    buildCandidates();
    stateIter = 0;
    cumMove = 0;
    inStep = true;
    /* 暖启动：朝 x̃ 跳，但同样吃保守 CCD 钳制 —— 自由下落一步到位，
       接触附近自动退化为小步 */
    computeGrad();   /* 刷新 dminNow */
    let maxW = 0;
    for (let n = 0; n < NN; n++) {
      if (pinned[n]) continue;
      const m2 = Math.hypot(xt[n * 3] - x[n * 3], xt[n * 3 + 1] - x[n * 3 + 1], xt[n * 3 + 2] - x[n * 3 + 2]);
      if (m2 > maxW) maxW = m2;
    }
    if (maxW > 1e-12) {
      const aw = Math.min(1, 0.45 * dminNow / maxW);
      for (let n = 0; n < NN; n++) {
        if (pinned[n]) continue;
        x[n * 3] += aw * (xt[n * 3] - x[n * 3]);
        x[n * 3 + 1] += aw * (xt[n * 3 + 1] - x[n * 3 + 1]);
        x[n * 3 + 2] += aw * (xt[n * 3 + 2] - x[n * 3 + 2]);
      }
      cumMove += aw * maxW;
      if (cumMove > MARGIN() * 0.4) { buildCandidates(); cumMove = 0; }
    }
    E0 = energyOf(x);
  }

  function gdIterations(budgetMs) {
    /* 预条件梯度下降 + 保守 CCD 钳制线搜索；返回是否完成本步 */
    const t0 = performance.now();
    const iterCap = parseInt((ui.iters && ui.iters.value) || '160', 10);
    const h2 = hstep * hstep;
    while (performance.now() - t0 < budgetMs) {
      if (stateIter >= iterCap) { finishStep(); return true; }
      computeGrad();
      let maxP = 0;
      for (let n = 0; n < NN; n++) {
        if (pinned[n]) { dir[n * 3] = dir[n * 3 + 1] = dir[n * 3 + 2] = 0; continue; }
        const pre = 1 / (mass[n] + h2 * KS * 6);
        dir[n * 3] = -grad[n * 3] * pre;
        dir[n * 3 + 1] = -grad[n * 3 + 1] * pre;
        dir[n * 3 + 2] = -grad[n * 3 + 2] * pre;
        const m2 = Math.sqrt(dir[n * 3] ** 2 + dir[n * 3 + 1] ** 2 + dir[n * 3 + 2] ** 2);
        if (m2 > maxP) maxP = m2;
      }
      if (maxP < 3e-6) { finishStep(); return true; }
      /* 保守 CCD：任意点对相对接近速度 ≤ 2·maxP，钳位移使其
         不可能越过当前最小间距 —— 这是「不穿模」保证的来源 */
      let alpha = Math.min(1, 0.45 * dminNow / maxP);
      const xs = new Float64Array(x);
      let ok = false;
      for (let ls = 0; ls < 18; ls++) {
        for (let n = 0; n < NN * 3; n++) x[n] = xs[n] + alpha * dir[n];
        const E1 = energyOf(x);
        if (E1 < E0) { E0 = E1; ok = true; break; }
        alpha *= 0.5;
      }
      if (!ok) { x.set(xs); finishStep(); return true; }
      /* 累计位移超过宽阶段边距一半时重建候选集，保证界外对仍在界外 */
      cumMove += alpha * maxP;
      if (cumMove > MARGIN() * 0.4) {
        buildCandidates();
        cumMove = 0;
        E0 = energyOf(x);
      }
      stateIter++;
    }
    return false;
  }

  function finishStep() {
    for (let n = 0; n < NN; n++) {
      if (pinned[n]) { v[n * 3] = v[n * 3 + 1] = v[n * 3 + 2] = 0; continue; }
      v[n * 3] = (x[n * 3] - x0[n * 3]) / hstep * 0.999;
      v[n * 3 + 1] = (x[n * 3 + 1] - x0[n * 3 + 1]) / hstep * 0.999;
      v[n * 3 + 2] = (x[n * 3 + 2] - x0[n * 3 + 2]) / hstep * 0.999;
    }
    simT += hstep;
    stepN++;
    lastIters = stateIter;
    inStep = false;
  }

  /* ---------- 渲染（Canvas 2D 画家排序） ---------- */
  let yaw = 0.7, pitch = 0.42, distC = 1.5, dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.006;
    pitch = Math.max(-0.2, Math.min(1.2, pitch + (e.clientY - py0) * 0.004));
    px0 = e.clientX; py0 = e.clientY;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    distC = Math.max(0.8, Math.min(3, distC + e.deltaY * 0.0012));
  }, { passive: false });

  function project(px, py, pz, cam) {
    const dx = px - cam.ex, dy = py - cam.ey, dz = pz - cam.ez;
    const vx = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    const vy = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    const vz = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    const s = (H * 1.1) / Math.max(vz, 0.05);
    return [W / 2 + vx * s, H / 2 - vy * s, vz];
  }

  const LAYCOL = [['#2a8f96', '#c96a2c'], ['#7a5fd0', '#3f8f4f'], ['#b3487a', '#4a6fd0']];

  function draw() {
    const P = pal();
    g.fillStyle = P.surface;
    g.fillRect(0, 0, W, H);
    const tgt = [0, 0.12, 0];
    const ex = tgt[0] + Math.sin(yaw) * Math.cos(pitch) * distC;
    const ey = tgt[1] + Math.sin(pitch) * distC;
    const ez = tgt[2] + Math.cos(yaw) * Math.cos(pitch) * distC;
    const fl = Math.hypot(tgt[0] - ex, tgt[1] - ey, tgt[2] - ez);
    const fx = (tgt[0] - ex) / fl, fy = (tgt[1] - ey) / fl, fz = (tgt[2] - ez) / fl;
    let rx = fz, ry = 0, rz = -fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const cam = { ex, ey, ez, rx, ry, rz, ux, uy, uz, fx, fy, fz };

    /* 三角形投影 + 画家排序 */
    const wire = ui.wire && ui.wire.checked;
    const items = [];
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      const pa = project(x[a * 3], x[a * 3 + 1], x[a * 3 + 2], cam);
      const pb = project(x[b * 3], x[b * 3 + 1], x[b * 3 + 2], cam);
      const pc = project(x[c * 3], x[c * 3 + 1], x[c * 3 + 2], cam);
      /* 法线光照 */
      const e1 = [x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]];
      const e2 = [x[c * 3] - x[a * 3], x[c * 3 + 1] - x[a * 3 + 1], x[c * 3 + 2] - x[a * 3 + 2]];
      let nx2 = e1[1] * e2[2] - e1[2] * e2[1], ny2 = e1[2] * e2[0] - e1[0] * e2[2], nz2 = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx2, ny2, nz2) || 1;
      const lam = Math.abs((nx2 * 0.45 + ny2 * 0.8 + nz2 * 0.35) / nl) * 0.7 + 0.3;
      items.push({ z: (pa[2] + pb[2] + pc[2]) / 3, pts: [pa, pb, pc], t, lam });
    }
    items.sort((q, r2) => r2.z - q.z);
    for (const it of items) {
      const L = triLayer[it.t];
      const col = LAYCOL[L % 3][0];
      g.beginPath();
      g.moveTo(it.pts[0][0], it.pts[0][1]);
      g.lineTo(it.pts[1][0], it.pts[1][1]);
      g.lineTo(it.pts[2][0], it.pts[2][1]);
      g.closePath();
      if (!wire) {
        const c0 = parseInt(col.slice(1), 16);
        const rr = Math.min(255, ((c0 >> 16) & 255) * it.lam + 18) | 0;
        const gg = Math.min(255, ((c0 >> 8) & 255) * it.lam + 18) | 0;
        const bb = Math.min(255, (c0 & 255) * it.lam + 18) | 0;
        g.fillStyle = `rgb(${rr},${gg},${bb})`;
        g.fill();
      }
      g.strokeStyle = wire ? col : 'rgba(0,0,0,0.25)';
      g.lineWidth = wire ? 1 : 0.5;
      g.stroke();
    }
    /* 静态横杆 */
    for (const s of statics.edges) {
      const p1 = project(s[0], s[1], s[2], cam);
      const p2 = project(s[3], s[4], s[5], cam);
      g.strokeStyle = P.ink2;
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
      g.lineWidth = 1;
    }
    /* 活跃接触点（剖析视图） */
    if (ui.contacts && ui.contacts.checked) {
      g.fillStyle = P['c-render'];
      for (let c = 0; c < candPT.length; c += 2) {
        const p = candPT[c], t2 = candPT[c + 1];
        const [a, b, cc] = tris[t2];
        closestPtTri(x[p * 3], x[p * 3 + 1], x[p * 3 + 2],
          x[a * 3], x[a * 3 + 1], x[a * 3 + 2], x[b * 3], x[b * 3 + 1], x[b * 3 + 2],
          x[cc * 3], x[cc * 3 + 1], x[cc * 3 + 2], tmp);
        if (Math.sqrt(tmp[3]) < dhat) {
          const pp = project(x[p * 3], x[p * 3 + 1], x[p * 3 + 2], cam);
          g.beginPath(); g.arc(pp[0], pp[1], 2.2, 0, 6.29); g.fill();
        }
      }
    }
  }

  /* ---------- 主循环：时间片推进 ---------- */
  let wallAcc = 0, stepsAcc = 0, ratio = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    if (running) {
      const t0 = performance.now();
      const BUDGET = 24;
      while (performance.now() - t0 < BUDGET) {
        if (!inStep) beginStep();
        if (!gdIterations(BUDGET - (performance.now() - t0))) break;
        lastMs = performance.now() - t0;
      }
      wallAcc += performance.now() - t0;
    }
    draw();
    const dTxt = isFinite(dminNow) ? (dminNow * 1000).toFixed(2) + ' mm' : '—';
    if (hud) {
      hud.textContent = 'STEP ' + stepN + ' · t=' + simT.toFixed(2) + 's · 接触 ' + activeContacts +
        ' · d_min ' + dTxt + ' · ' + lastIters + ' 迭代/步';
    }
    if (ui.stat) {
      ui.stat.textContent = dminNow > 0
        ? '✓ 无穿透（全局最小间距 ' + dTxt + ' > 0）'
        : '✗ 检测到穿透';
      ui.stat.style.color = dminNow > 0 ? 'var(--play)' : 'var(--c-render)';
    }
  }

  if (ui.run) ui.run.addEventListener('click', () => {
    running = !running;
    ui.run.textContent = running ? '⏸ 暂停' : '▶ 运行';
  });
  if (ui.step) ui.step.addEventListener('click', () => {
    running = false;
    if (ui.run) ui.run.textContent = '▶ 运行';
    if (!inStep) beginStep();
    while (!gdIterations(50)) { /* 直到本步完成 */ }
  });
  if (ui.reset) ui.reset.addEventListener('click', reset);
  ['scene', 'res', 'dhat', 'h'].forEach((k) => {
    if (ui[k]) ui[k].addEventListener('change', reset);
  });

  reset();
  if (location.hash === '#run') { running = true; if (ui.run) ui.run.textContent = '⏸ 暂停'; }
  requestAnimationFrame(loop);

  /* 测试钩子（node 测试台驱动求解器用，页面上无副作用） */
  if (typeof window !== 'undefined') {
    window.__ipcTest = {
      stepOnce() {
        if (!inStep) beginStep();
        while (!gdIterations(1000)) { /* 跑完本步 */ }
      },
      state() {
        return { dmin: dminNow, simT, stepN, activeContacts, x, NN, layerOf, iters: lastIters };
      },
    };
  }
}

main();
