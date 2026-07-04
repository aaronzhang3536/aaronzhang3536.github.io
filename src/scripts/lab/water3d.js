/* 3D 水体（SPH）— 裸 WebGPU：WCSPH 光滑粒子流体动力学
   空间哈希网格邻居搜索（atomic 计数 + 定容散射）· XSPH 粘性 · 球形 impostor 渲染 */
import { mat4 } from 'wgpu-matrix';

/* 模拟 uniform：
   a: x dt, y h, z 压力刚度, w XSPH 粘性
   b: xyz 盒半长, w 静息密度 rho0
   c: xyz 推挤球位置, w 半径（0 = 关）
   d: xyz 推挤球速度, w 重力
   e: x 粒子数, yzw 网格三维格数 */
const SU_DECL = /* wgsl */ `
struct SU { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
const CAP = 32u;   // 每格最多登记的粒子数
`;

const CLEAR_WGSL = SU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read_write> cnt: array<atomic<u32>>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let total = u32(su.e.y) * u32(su.e.z) * u32(su.e.w);
  if (id.x >= total) { return; }
  atomicStore(&cnt[id.x], 0u);
}`;

const BIN_WGSL = SU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> cnt: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> tbl: array<u32>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(su.e.x)) { return; }
  let g = vec3u(clamp(vec3i((pos[id.x].xyz + su.b.xyz) / su.a.y),
                      vec3i(0), vec3i(su.e.yzw) - 1));
  let cell = (g.z * u32(su.e.z) + g.y) * u32(su.e.y) + g.x;
  let slot = atomicAdd(&cnt[cell], 1u);
  if (slot < CAP) { tbl[cell * CAP + slot] = id.x; }
}`;

/* 27 格邻居遍历（密度与受力共用的骨架） */
const NEIGH = /* wgsl */ `
fn cellOf(p: vec3f) -> vec3i {
  return clamp(vec3i((p + su.b.xyz) / su.a.y), vec3i(0), vec3i(su.e.yzw) - 1);
}
fn cellIdx(g: vec3i) -> u32 {
  return (u32(g.z) * u32(su.e.z) + u32(g.y)) * u32(su.e.y) + u32(g.x);
}`;

const DENSITY_WGSL = SU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> cnt: array<u32>;
@group(0) @binding(3) var<storage, read> tbl: array<u32>;
@group(0) @binding(4) var<storage, read_write> rho: array<f32>;
` + NEIGH + /* wgsl */ `
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(su.e.x)) { return; }
  let h = su.a.y;
  let h2 = h * h;
  let poly6 = 315.0 / (64.0 * 3.14159265 * pow(h, 9.0));
  let pi = pos[id.x].xyz;
  var r = 0.0;
  let g0 = cellOf(pi);
  for (var dz = -1; dz <= 1; dz++) {
  for (var dy = -1; dy <= 1; dy++) {
  for (var dx = -1; dx <= 1; dx++) {
    let g = g0 + vec3i(dx, dy, dz);
    if (any(g < vec3i(0)) || any(g >= vec3i(su.e.yzw))) { continue; }
    let c = cellIdx(g);
    let n = min(cnt[c], CAP);
    for (var k = 0u; k < n; k++) {
      let d = pi - pos[tbl[c * CAP + k]].xyz;
      let r2 = dot(d, d);
      if (r2 < h2) {
        let w = h2 - r2;
        r += poly6 * w * w * w;
      }
    }
  }}}
  rho[id.x] = r;
}`;

const FORCE_WGSL = SU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> cnt: array<u32>;
@group(0) @binding(4) var<storage, read> tbl: array<u32>;
@group(0) @binding(5) var<storage, read> rho: array<f32>;
` + NEIGH + /* wgsl */ `
/* 密度统一除以静息密度做无量纲化，刚度滑块因此有稳定的物理直觉 */
fn pres(rn: f32) -> f32 { return su.a.z * max(rn - 1.0, 0.0); }
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(su.e.x)) { return; }
  let h = su.a.y;
  let h2 = h * h;
  let spiky = -45.0 / (3.14159265 * pow(h, 6.0));
  let poly6 = 315.0 / (64.0 * 3.14159265 * pow(h, 9.0));
  let pi = pos[id.x].xyz;
  let vi = vel[id.x].xyz;
  let rni = max(rho[id.x] / su.b.w, 0.25);
  let Pi = pres(rni);

  var fp = vec3f(0.0);
  var dv = vec3f(0.0);
  let g0 = cellOf(pi);
  for (var dz = -1; dz <= 1; dz++) {
  for (var dy = -1; dy <= 1; dy++) {
  for (var dx = -1; dx <= 1; dx++) {
    let g = g0 + vec3i(dx, dy, dz);
    if (any(g < vec3i(0)) || any(g >= vec3i(su.e.yzw))) { continue; }
    let c = cellIdx(g);
    let n = min(cnt[c], CAP);
    for (var k = 0u; k < n; k++) {
      let j = tbl[c * CAP + k];
      if (j == id.x) { continue; }
      let d = pi - pos[j].xyz;
      let r2 = dot(d, d);
      if (r2 >= h2 || r2 < 1e-10) { continue; }
      let r = sqrt(r2);
      let rnj = max(rho[j] / su.b.w, 0.25);
      /* 对称压力（spiky 梯度，按 rho0 归一） */
      let gw = spiky * (h - r) * (h - r) / su.b.w;
      fp -= (Pi / (rni * rni) + pres(rnj) / (rnj * rnj)) * gw * (d / r);
      /* XSPH 粘性（poly6 权重的速度平滑） */
      let w = h2 - r2;
      dv += (vel[j].xyz - vi) * (poly6 * w * w * w / (rnj * su.b.w));
    }
  }}}

  var v = vi + su.a.x * (fp + vec3f(0.0, -su.d.w, 0.0));
  v += su.a.w * dv;

  /* 推挤球（鼠标搅水） */
  if (su.c.w > 0.0) {
    let off = pi - su.c.xyz;
    let dist = length(off);
    if (dist < su.c.w) {
      let push = (su.c.w - dist) / su.c.w;
      v += (off / max(dist, 1e-4)) * push * 3.0 + su.d.xyz * push * 1.6;
    }
  }

  /* 限速防爆 */
  let sp = length(v);
  if (sp > 3.0) { v *= 3.0 / sp; }

  var p = pi + su.a.x * v;
  /* 盒体碰撞：位置钳制 + 法向速度衰减 */
  let lo = -su.b.xyz;
  let hi = vec3f(su.b.x, su.b.y * 2.2, su.b.z);
  if (p.x < lo.x) { p.x = lo.x; v.x *= -0.3; }
  if (p.x > hi.x) { p.x = hi.x; v.x *= -0.3; }
  if (p.z < lo.z) { p.z = lo.z; v.z *= -0.3; }
  if (p.z > hi.z) { p.z = hi.z; v.z *= -0.3; }
  if (p.y < lo.y) { p.y = lo.y; v.y *= -0.3; }
  if (p.y > hi.y) { p.y = hi.y; v.y *= -0.3; }

  pos[id.x] = vec4f(p, sp);
  vel[id.x] = vec4f(v, 0.0);
}`;

const DRAW_WGSL = /* wgsl */ `
struct Cam {
  vp: mat4x4f,
  right: vec4f,   // xyz, w 粒子半径
  up: vec4f,      // xyz, w 未用
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) spd: f32,
};
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let p = pos[vi / 6u];
  let c = corners[vi % 6u];
  let wp = p.xyz + (cam.right.xyz * c.x + cam.up.xyz * c.y) * cam.right.w;
  var o: VSOut;
  o.pos = cam.vp * vec4f(wp, 1.0);
  o.uv = c;
  o.spd = p.w;
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let n = vec3f(in.uv, sqrt(1.0 - r2));
  let L = normalize(vec3f(0.4, 0.8, 0.5));
  let dif = max(dot(n, L), 0.0);
  let fres = pow(1.0 - n.z, 2.0);
  let foam = clamp(in.spd * 0.55 - 0.25, 0.0, 1.0);
  var col = mix(vec3f(0.05, 0.22, 0.55), vec3f(0.25, 0.55, 0.9), dif);
  col = mix(col, vec3f(0.85, 0.95, 1.0), foam * 0.75);
  col += vec3f(0.5, 0.7, 0.9) * fres * 0.35;
  col += vec3f(1.0) * pow(max(dot(reflect(-L, n), vec3f(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.5;
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}`;

const LINE_WGSL = /* wgsl */ `
struct Cam { vp: mat4x4f, right: vec4f, up: vec4f };
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> pts: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return cam.vp * vec4f(pts[vi].xyz, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.35, 0.42, 0.55, 1.0); }`;

const H = 0.04;                        /* 平滑核半径 */
const BOX = [0.7, 0.5, 0.45];          /* 盒半长（y 向上留 2.2 倍飞溅高度） */

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) {
    wgslEl.textContent =
      '// ---- 网格登记（atomic 计数散射） ----' + BIN_WGSL +
      '\n\n// ---- SPH 密度 ----' + DENSITY_WGSL +
      '\n\n// ---- 压力/粘性/积分 ----' + FORCE_WGSL;
  }
  function fail(msg) {
    if (hud) hud.textContent = '';
    if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; }
    cvs.style.display = 'none';
  }
  if (!navigator.gpu) { fail('当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge / Firefox 打开这个实验。'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('WebGPU adapter 请求失败。'); return; }
  const canTime = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: canTime ? ['timestamp-query'] : [] });

  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, Hc = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(Hc * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const depthTex = device.createTexture({
    size: [cvs.width, cvs.height], format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTex.createView();

  /* 静息密度：在 0.8h 立方晶格上数值求和 poly6 */
  const SPACING = H * 0.8;
  let rho0 = 0;
  {
    const poly6 = 315 / (64 * Math.PI * Math.pow(H, 9));
    const n = Math.ceil(H / SPACING);
    for (let x = -n; x <= n; x++)
      for (let y = -n; y <= n; y++)
        for (let z = -n; z <= n; z++) {
          const r2 = (x * x + y * y + z * z) * SPACING * SPACING;
          if (r2 < H * H) rho0 += poly6 * Math.pow(H * H - r2, 3);
        }
  }

  /* 网格维度（y 方向给飞溅留 2.2 倍高度） */
  const CELLS = [
    Math.ceil(BOX[0] * 2 / H),
    Math.ceil(BOX[1] * (1 + 2.2) / H),
    Math.ceil(BOX[2] * 2 / H),
  ];
  const CELL_TOTAL = CELLS[0] * CELLS[1] * CELLS[2];
  const CAP = 32;

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const clearP = mkCP(CLEAR_WGSL);
  const binP = mkCP(BIN_WGSL);
  const denP = mkCP(DENSITY_WGSL);
  const frcP = mkCP(FORCE_WGSL);
  const drawMod = device.createShaderModule({ code: DRAW_WGSL });
  const drawP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: drawMod, entryPoint: 'vs' },
    fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const lineMod = device.createShaderModule({ code: LINE_WGSL });
  const lineP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: lineMod, entryPoint: 'vs' },
    fragment: { module: lineMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'line-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const suBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const camBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cntBuf = device.createBuffer({ size: CELL_TOTAL * 4, usage: GPUBufferUsage.STORAGE });
  const tblBuf = device.createBuffer({ size: CELL_TOTAL * CAP * 4, usage: GPUBufferUsage.STORAGE });

  /* 容器线框（12 条边） */
  const hi = [BOX[0], BOX[1] * 2.2, BOX[2]], lo = [-BOX[0], -BOX[1], -BOX[2]];
  const cor = [];
  for (let i = 0; i < 8; i++) cor.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
  const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const lineArr = new Float32Array(edges.length * 2 * 4);
  edges.flat().forEach((ci, k) => lineArr.set([...cor[ci], 1], k * 4));
  const lineBuf = device.createBuffer({ size: lineArr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lineBuf, 0, lineArr);
  const lineBG = device.createBindGroup({
    layout: lineP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camBuf } },
      { binding: 1, resource: { buffer: lineBuf } },
    ],
  });

  /* 粒子缓冲（可按数量重建） */
  let N = 0, posBuf = null, velBuf = null, rhoBuf = null;
  let BGs = null;
  function rebuild(n) {
    if (posBuf) { posBuf.destroy(); velBuf.destroy(); rhoBuf.destroy(); }
    const pos = new Float32Array(n * 4);
    let i = 0;
    outer:
    for (let y = 0; ; y++) {
      for (let z = 0; z < Math.floor(BOX[2] * 2 / SPACING) - 1; z++) {
        for (let x = 0; x < Math.floor(BOX[0] * 2 / SPACING) - 1; x++) {
          if (i >= n) break outer;
          pos[i * 4] = lo[0] + SPACING * (x + 0.7) + (Math.random() - 0.5) * SPACING * 0.1;
          pos[i * 4 + 1] = lo[1] + SPACING * (y + 0.7);
          pos[i * 4 + 2] = lo[2] + SPACING * (z + 0.7) + (Math.random() - 0.5) * SPACING * 0.1;
          pos[i * 4 + 3] = 0;
          i++;
        }
      }
    }
    N = n;
    posBuf = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    velBuf = device.createBuffer({ size: n * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    rhoBuf = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE });
    device.queue.writeBuffer(posBuf, 0, pos);
    device.queue.writeBuffer(velBuf, 0, new Float32Array(n * 4));
    const bg = (pipe, entries) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map((r, k) => ({ binding: k, resource: typeof r.size === 'number' || r.buffer ? r : { buffer: r } })),
    });
    BGs = {
      clear: bg(clearP, [{ buffer: suBuf }, { buffer: cntBuf }]),
      bin: bg(binP, [{ buffer: suBuf }, { buffer: posBuf }, { buffer: cntBuf }, { buffer: tblBuf }]),
      den: bg(denP, [{ buffer: suBuf }, { buffer: posBuf }, { buffer: cntBuf }, { buffer: tblBuf }, { buffer: rhoBuf }]),
      frc: bg(frcP, [{ buffer: suBuf }, { buffer: posBuf }, { buffer: velBuf }, { buffer: cntBuf }, { buffer: tblBuf }, { buffer: rhoBuf }]),
      draw: bg(drawP, [{ buffer: camBuf }, { buffer: posBuf }]),
    };
  }

  /* GPU 计时 */
  let qs = null, qBuf = null, readPool = [], simMs = 0;
  if (canTime) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 });
    qBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) {
      readPool.push({
        buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        busy: false,
      });
    }
  }

  /* 交互：拖拽 = 搅水（推挤球沿视平面移动），滚轮 = 推拉，视角自动缓转 */
  const $ = (id) => document.getElementById(id);
  const ui = { n: $('wt-n'), visc: $('wt-visc'), stiff: $('wt-stiff'), grav: $('wt-grav') };
  let radius = 2.1, yaw = 0.6;
  let pusher = null;   /* { p:[x,y,z], v:[x,y,z] } */
  let lastPt = null, dragging = false;
  function rayPoint(e, eye, rightV, upV, fwdV) {
    const r = cvs.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const th = Math.tan(0.38), aspect = cvs.width / cvs.height;
    const dist = radius;
    return [
      eye[0] + (fwdV[0] + rightV[0] * nx * th * aspect + upV[0] * ny * th) * dist,
      eye[1] + (fwdV[1] + rightV[1] * nx * th * aspect + upV[1] * ny * th) * dist,
      eye[2] + (fwdV[2] + rightV[2] * nx * th * aspect + upV[2] * ny * th) * dist,
    ];
  }
  let camBasis = null;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; lastPt = null; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging || !camBasis) return;
    const p = rayPoint(e, camBasis.eye, camBasis.right, camBasis.up, camBasis.fwd);
    const v = lastPt ? [(p[0] - lastPt[0]) * 30, (p[1] - lastPt[1]) * 30, (p[2] - lastPt[2]) * 30] : [0, 0, 0];
    pusher = { p, v };
    lastPt = p;
  });
  const stop = () => { dragging = false; pusher = null; lastPt = null; };
  cvs.addEventListener('pointerup', stop);
  cvs.addEventListener('pointercancel', stop);
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(1.2, Math.min(3.6, radius + e.deltaY * 0.0015));
  }, { passive: false });
  if (ui.n) ui.n.addEventListener('change', () => rebuild(parseInt(ui.n.value, 10)));

  rebuild(parseInt((ui.n && ui.n.value) || '16384', 10));

  const proj = mat4.perspective(0.76, cvs.width / cvs.height, 0.05, 30);
  const suArr = new Float32Array(20);
  const camArr = new Float32Array(24);
  const SUBSTEPS = 3;
  let prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.033) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;
    yaw += dtF * 0.05;

    /* 相机 */
    const pitch = 0.42;
    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const tgt = [0, 0.1, 0];
    const view = mat4.lookAt(eye, tgt, [0, 1, 0]);
    const vp = mat4.multiply(proj, view);
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = nrm([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
    const right = nrm(crs(fwd, [0, 1, 0]));
    const up = crs(right, fwd);
    camBasis = { eye, right, up, fwd };

    camArr.set(vp, 0);
    camArr[16] = right[0]; camArr[17] = right[1]; camArr[18] = right[2]; camArr[19] = SPACING * 0.72;
    camArr[20] = up[0]; camArr[21] = up[1]; camArr[22] = up[2]; camArr[23] = 0;
    device.queue.writeBuffer(camBuf, 0, camArr);

    const visc = parseFloat((ui.visc && ui.visc.value) || '0.08');
    const stiff = parseFloat((ui.stiff && ui.stiff.value) || '8');
    const grav = parseFloat((ui.grav && ui.grav.value) || '9.8');
    const dt = 1 / 180;
    suArr[0] = dt; suArr[1] = H; suArr[2] = stiff; suArr[3] = visc;
    suArr[4] = BOX[0]; suArr[5] = BOX[1]; suArr[6] = BOX[2]; suArr[7] = rho0;
    suArr[8] = pusher ? pusher.p[0] : 99; suArr[9] = pusher ? pusher.p[1] : 99;
    suArr[10] = pusher ? pusher.p[2] : 99; suArr[11] = pusher ? 0.24 : 0;
    suArr[12] = pusher ? pusher.v[0] : 0; suArr[13] = pusher ? pusher.v[1] : 0;
    suArr[14] = pusher ? pusher.v[2] : 0; suArr[15] = grav;
    suArr[16] = N; suArr[17] = CELLS[0]; suArr[18] = CELLS[1]; suArr[19] = CELLS[2];
    device.queue.writeBuffer(suBuf, 0, suArr);

    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    for (let s = 0; s < SUBSTEPS; s++) {
      cp.setPipeline(clearP); cp.setBindGroup(0, BGs.clear); cp.dispatchWorkgroups(Math.ceil(CELL_TOTAL / 64));
      cp.setPipeline(binP); cp.setBindGroup(0, BGs.bin); cp.dispatchWorkgroups(Math.ceil(N / 64));
      cp.setPipeline(denP); cp.setBindGroup(0, BGs.den); cp.dispatchWorkgroups(Math.ceil(N / 64));
      cp.setPipeline(frcP); cp.setBindGroup(0, BGs.frc); cp.dispatchWorkgroups(Math.ceil(N / 64));
    }
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0.012, g: 0.014, b: 0.022, a: 1 }, storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store',
      },
    });
    rp.setPipeline(lineP);
    rp.setBindGroup(0, lineBG);
    rp.draw(24);
    rp.setPipeline(drawP);
    rp.setBindGroup(0, BGs.draw);
    rp.draw(N * 6);
    rp.end();

    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) {
        enc.resolveQuerySet(qs, 0, 2, qBuf, 0);
        enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 16);
      }
    }
    device.queue.submit([enc.finish()]);
    if (slot) {
      slot.busy = true;
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigInt64Array(slot.buf.getMappedRange());
        simMs += (Number(q[1] - q[0]) / 1e6 - simMs) * 0.1;
        slot.buf.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (hud) {
      hud.textContent = N.toLocaleString() + ' 粒子 · ' + SUBSTEPS + ' 子步 · ' +
        (canTime ? 'sim ' + simMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
