/* 布料试验场 — 裸 WebGPU
   三种解算器：XPBD（柔度约束）· PBD（位置约束）· 显式质点弹簧
   约束按图着色分组，组内无共享粒子 → GPU 并行 Gauss-Seidel
   五种场景 · 球/地面碰撞 · 抓取拖拽 · 全参数可调 */
import { mat4 } from 'wgpu-matrix';

/* 布料 uniform：
   a: x dt, y 阻尼, z 重力, w 风力
   b: xyz 风向量, w 时间
   c: x 模式(0 XPBD/1 PBD/2 弹簧), y 迭代数, z 拉伸参数, w 弯曲参数
   d: xyz 球心, w 球半径（0 关）
   e: x 地面 y（<-900 关）, y 抓取粒子 id（<0 无）, z 分辨率 N, w 未用
   f: xyz 抓取目标, w 未用 */
const CU_DECL = /* wgsl */ `
struct CU { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f, f: vec4f };
`;

const NORMAL_WGSL = CU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> nrm: array<vec4f>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(cu.e.z);
  if (id.x >= N * N) { return; }
  let x = i32(id.x % N);
  let y = i32(id.x / N);
  let p = pos[id.x].xyz;
  var n = vec3f(0.0);
  let R = i32(N);
  if (x + 1 < R && y + 1 < R) { n += cross(pos[id.x + 1u].xyz - p, pos[id.x + N].xyz - p); }
  if (x - 1 >= 0 && y + 1 < R) { n += cross(pos[id.x + N].xyz - p, pos[id.x - 1u].xyz - p); }
  if (x - 1 >= 0 && y - 1 >= 0) { n += cross(pos[id.x - 1u].xyz - p, pos[id.x - N].xyz - p); }
  if (x + 1 < R && y - 1 >= 0) { n += cross(pos[id.x - N].xyz - p, pos[id.x + 1u].xyz - p); }
  let l = length(n);
  nrm[id.x] = vec4f(select(vec3f(0.0, 0.0, 1.0), n / l, l > 1e-9), 0.0);
}`;

const INTEGRATE_WGSL = CU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prev: array<vec4f>;
@group(0) @binding(3) var<storage, read> nrm: array<vec4f>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(cu.e.z);
  if (id.x >= N * N) { return; }
  var p = pos[id.x];
  if (i32(cu.e.y) == i32(id.x)) {          /* 被抓取：钉到目标 */
    prev[id.x] = vec4f(cu.f.xyz, p.w);
    pos[id.x] = vec4f(cu.f.xyz, p.w);
    return;
  }
  if (p.w == 0.0) { prev[id.x] = p; return; }   /* 固定点 */
  let dt = cu.a.x;
  var v = (p.xyz - prev[id.x].xyz) / dt * (1.0 - cu.a.y);
  /* 风：法向承风面 */
  let n = nrm[id.x].xyz;
  let wind = cu.b.xyz * cu.a.w;
  var a = vec3f(0.0, -cu.a.z, 0.0) + n * dot(n, wind - v) * 1.4;
  prev[id.x] = vec4f(p.xyz, p.w);
  let np = p.xyz + v * dt + a * dt * dt;
  pos[id.x] = vec4f(np, p.w);
}`;

const RESETL_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> lam: array<f32>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&lam)) { return; }
  lam[id.x] = 0.0;
}`;

/* 组内约束无共享粒子，可直接写 pos */
const SOLVE_WGSL = CU_DECL + /* wgsl */ `
struct GRP { off: u32, num: u32, p0: u32, p1: u32 };
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<uniform> grp: GRP;
@group(0) @binding(2) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(3) var<storage, read> cIdx: array<vec2u>;
@group(0) @binding(4) var<storage, read> cRest: array<vec2f>;   /* x rest, y kind(0/1/2) */
@group(0) @binding(5) var<storage, read_write> lam: array<f32>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= grp.num) { return; }
  let ci = grp.off + id.x;
  let ij = cIdx[ci];
  var pa = pos[ij.x];
  var pb = pos[ij.y];
  let wsum = pa.w + pb.w;
  if (wsum == 0.0) { return; }
  let d = pa.xyz - pb.xyz;
  let len = max(length(d), 1e-7);
  let rest = cRest[ci].x;
  let C = len - rest;
  let dir = d / len;
  var dl: f32;
  /* 弯曲约束用弯曲参数，其余用拉伸参数 */
  let isBend = cRest[ci].y > 1.5;
  if (cu.c.x < 0.5) {
    /* XPBD：柔度 α̃ = α/dt² */
    let alpha = select(cu.c.z, cu.c.w, isBend) / (cu.a.x * cu.a.x);
    dl = (-C - alpha * lam[ci]) / (wsum + alpha);
    lam[ci] += dl;
  } else {
    /* PBD：刚度直接衰减修正量 */
    dl = -C / wsum * select(cu.c.z, cu.c.w, isBend);
  }
  pos[ij.x] = vec4f(pa.xyz + dir * dl * pa.w, pa.w);
  pos[ij.y] = vec4f(pb.xyz - dir * dl * pb.w, pb.w);
}`;

const COLLIDE_WGSL = CU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> prev: array<vec4f>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(cu.e.z);
  if (id.x >= N * N) { return; }
  var p = pos[id.x];
  if (p.w == 0.0) { return; }
  var q = p.xyz;
  /* 球 */
  if (cu.d.w > 0.0) {
    let off = q - cu.d.xyz;
    let dist = length(off);
    if (dist < cu.d.w) { q = cu.d.xyz + off / max(dist, 1e-6) * cu.d.w; }
  }
  /* 地面（带摩擦：拖回 prev 的切向分量） */
  if (cu.e.x > -900.0 && q.y < cu.e.x) {
    q.y = cu.e.x;
    let pv = prev[id.x];
    prev[id.x] = vec4f(mix(pv.xyz, q, vec3f(0.6, 0.0, 0.6)), pv.w);
  }
  pos[id.x] = vec4f(q, p.w);
}`;

/* 显式质点弹簧：每粒子读邻接表求合力，半隐式欧拉多子步 */
const SPRING_WGSL = CU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(3) var<storage, read> adjIdx: array<u32>;
@group(0) @binding(4) var<storage, read> adjRest: array<vec2f>;
@group(0) @binding(5) var<storage, read> nrm: array<vec4f>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(cu.e.z);
  if (id.x >= N * N) { return; }
  var p = pos[id.x];
  if (i32(cu.e.y) == i32(id.x)) {
    pos[id.x] = vec4f(cu.f.xyz, p.w);
    vel[id.x] = vec4f(0.0);
    return;
  }
  if (p.w == 0.0) { return; }
  var v = vel[id.x].xyz;
  let n = nrm[id.x].xyz;
  let wind = cu.b.xyz * cu.a.w;
  var f = vec3f(0.0, -cu.a.z, 0.0) + n * dot(n, wind - v) * 1.4;
  let kS = cu.c.z;
  let kB = cu.c.w;
  for (var s = 0u; s < 12u; s++) {
    let j = adjIdx[id.x * 12u + s];
    if (j == 0xffffffffu) { continue; }
    let ar = adjRest[id.x * 12u + s];
    let d = pos[j].xyz - p.xyz;
    let len = max(length(d), 1e-7);
    let dir = d / len;
    let k = select(kS, kB, ar.y > 1.5);
    f += dir * (len - ar.x) * k;
    /* 弹簧内阻尼 */
    f += dir * dot(vel[j].xyz - v, dir) * sqrt(k) * 0.06;
  }
  let dt = cu.a.x;
  v = (v + f * dt) * (1.0 - cu.a.y * dt * 24.0);
  var q = p.xyz + v * dt;
  if (cu.d.w > 0.0) {
    let off = q - cu.d.xyz;
    let dist = length(off);
    if (dist < cu.d.w) {
      q = cu.d.xyz + off / max(dist, 1e-6) * cu.d.w;
      v -= dir3(off) * min(dot(v, dir3(off)), 0.0);
    }
  }
  if (cu.e.x > -900.0 && q.y < cu.e.x) { q.y = cu.e.x; v.y = max(v.y, 0.0); v = vec3f(v.x * 0.8, v.y, v.z * 0.8); }
  pos[id.x] = vec4f(q, p.w);
  vel[id.x] = vec4f(v, 0.0);
}
fn dir3(v: vec3f) -> vec3f { return v / max(length(v), 1e-6); }`;

const PICK_WGSL = CU_DECL + /* wgsl */ `
struct PK { vp: mat4x4f, mouse: vec4f };   /* mouse: xy ndc */
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<uniform> pk: PK;
@group(0) @binding(2) var<storage, read> pos: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> best: atomic<u32>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let N = u32(cu.e.z);
  if (id.x >= N * N) { return; }
  let clip = pk.vp * vec4f(pos[id.x].xyz, 1.0);
  if (clip.w <= 0.0) { return; }
  let ndc = clip.xy / clip.w;
  let d = distance(ndc, pk.mouse.xy);
  let packed = (min(u32(d * 2048.0), 0xffffu) << 16u) | (id.x & 0xffffu);
  atomicMin(&best, packed);
}`;

const CLOTH_DRAW_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, eye: vec4f, misc: vec4f };   /* misc.x = N */
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> nrm: array<vec4f>;
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) n: vec3f,
  @location(1) wp: vec3f,
  @location(2) uv: vec2f,
};
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let N = u32(ru.misc.x);
  var o: VSOut;
  o.wp = pos[vi].xyz;
  o.pos = ru.vp * vec4f(o.wp, 1.0);
  o.n = nrm[vi].xyz;
  o.uv = vec2f(f32(vi % N), f32(vi / N)) / f32(N - 1u);
  return o;
}
@fragment
fn fs(in: VSOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(in.n);
  if (!ff) { n = -n; }
  let L1 = normalize(vec3f(0.5, 0.8, 0.4));
  let L2 = normalize(vec3f(-0.6, 0.2, -0.5));
  let dif = max(dot(n, L1), 0.0) * 0.85 + max(dot(n, L2), 0.0) * 0.3 + 0.14;
  /* 正反面异色 + 细条纹显形变 */
  var base = select(vec3f(0.82, 0.36, 0.16), vec3f(0.16, 0.52, 0.58), ff);
  let stripe = step(0.5, fract(in.uv.y * 12.0)) * 0.12 + step(0.5, fract(in.uv.x * 12.0)) * 0.07;
  base *= 1.0 - stripe;
  let v = normalize(ru.eye.xyz - in.wp);
  let rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
  var c = base * dif + vec3f(rim);
  return vec4f(pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}`;

const LINE_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, eye: vec4f, misc: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> pts: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return ru.vp * vec4f(pts[vi].xyz, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.42, 0.55, 0.62, 1.0); }`;

const SPHERE_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, eye: vec4f, misc: vec4f };
struct SP { c: vec4f };   /* xyz 球心, w 半径 */
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<uniform> sp: SP;
struct VSOut { @builtin(position) pos: vec4f, @location(0) n: vec3f };
@vertex
fn vs(@location(0) p: vec3f) -> VSOut {
  var o: VSOut;
  o.n = p;
  o.pos = ru.vp * vec4f(sp.c.xyz + p * sp.c.w, 1.0);
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let n = normalize(in.n);
  let dif = max(dot(n, normalize(vec3f(0.5, 0.8, 0.4))), 0.0) * 0.8 + 0.18;
  let c = vec3f(0.42, 0.44, 0.5) * dif;
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}`;

/* 场景定义 */
const SCENES = {
  flag:    { zh: '旗帜',    orient: 'v', pins: 'left',  wind: [1, 0.05, 0.22], windDef: 1.6, sphere: 0,    floor: -999, net: false },
  table:   { zh: '桌布落球', orient: 'h', pins: 'none',  wind: [0, 0, 0],       windDef: 0,   sphere: 0.30, floor: -0.85, net: false },
  curtain: { zh: '帘幕',    orient: 'v', pins: 'top',   wind: [0.3, 0, 1],     windDef: 0.5, sphere: 0,    floor: -999, net: false },
  net:     { zh: '渔网落球', orient: 'h', pins: 'corners', wind: [0, 0, 0],    windDef: 0,   sphere: 0.30, floor: -0.85, net: true },
  fall:    { zh: '自由飘落', orient: 'v', pins: 'none',  wind: [0.6, 0, 0.8],   windDef: 0.8, sphere: 0,    floor: -0.85, net: false },
};

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) {
    wgslEl.textContent =
      '// ---- 约束求解（XPBD / PBD 同核，组内并行 Gauss-Seidel） ----' + SOLVE_WGSL +
      '\n\n// ---- 显式质点弹簧 ----' + SPRING_WGSL +
      '\n\n// ---- 积分（Verlet + 法向承风） ----' + INTEGRATE_WGSL;
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
  const depthView = device.createTexture({
    size: [cvs.width, cvs.height], format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  }).createView();

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const nrmP = mkCP(NORMAL_WGSL);
  const intP = mkCP(INTEGRATE_WGSL);
  const rstP = mkCP(RESETL_WGSL);
  const slvP = mkCP(SOLVE_WGSL);
  const colP = mkCP(COLLIDE_WGSL);
  const sprP = mkCP(SPRING_WGSL);
  const pikP = mkCP(PICK_WGSL);
  const mkRP = (code, topo, buffers) => {
    const m = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: m, entryPoint: 'vs', buffers: buffers || [] },
      fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: topo, cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
  };
  const clothRP = mkRP(CLOTH_DRAW_WGSL, 'triangle-list');
  const lineRP = mkRP(LINE_WGSL, 'line-list');
  const sphereRP = mkRP(SPHERE_WGSL, 'triangle-list',
    [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]);

  const cuBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const spBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pkBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bestBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const bestRead = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  /* 球体网格 */
  let sphereVB = null, sphereIB = null, sphereIdxN = 0;
  {
    const RG = 20, SG = 28, vs = [], is = [];
    for (let r = 0; r <= RG; r++) {
      const ph = (r / RG) * Math.PI;
      for (let s = 0; s <= SG; s++) {
        const th = (s / SG) * Math.PI * 2;
        vs.push(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
      }
    }
    for (let r = 0; r < RG; r++)
      for (let s = 0; s < SG; s++) {
        const a = r * (SG + 1) + s;
        is.push(a, a + SG + 1, a + 1, a + 1, a + SG + 1, a + SG + 2);
      }
    sphereVB = device.createBuffer({ size: vs.length * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    sphereIB = device.createBuffer({ size: is.length * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(sphereVB, 0, new Float32Array(vs));
    device.queue.writeBuffer(sphereIB, 0, new Uint32Array(is));
    sphereIdxN = is.length;
  }
  const sphereBG = device.createBindGroup({
    layout: sphereRP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ruBuf } },
      { binding: 1, resource: { buffer: spBuf } },
    ],
  });

  /* 地面网格线 */
  const floorPts = [];
  for (let i = -5; i <= 5; i++) {
    floorPts.push(i * 0.22, 0, -1.1, 1, i * 0.22, 0, 1.1, 1);
    floorPts.push(-1.1, 0, i * 0.22, 1, 1.1, 0, i * 0.22, 1);
  }
  const floorBuf = device.createBuffer({ size: floorPts.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const floorArr = new Float32Array(floorPts);
  const floorN = floorPts.length / 4;

  /* ---------- 场景构建 ---------- */
  const $ = (id) => document.getElementById(id);
  const ui = {
    algo: $('cl-algo'), scene: $('cl-scene'), res: $('cl-res'), iter: $('cl-iter'),
    stretch: $('cl-stretch'), bend: $('cl-bend'), damp: $('cl-damp'), wind: $('cl-wind'),
    reset: $('cl-reset'), iterV: $('cl-iter-v'),
  };
  let N = 0, PN = 0, CN = 0, groups = [], scene = null;
  let posBuf, prevBuf, velBuf, nrmBuf, cIdxBuf, cRestBuf, lamBuf, adjIdxBuf, adjRestBuf;
  let clothIdxBuf, clothIdxN, netIdxBuf, netIdxN;
  let BG = null, grpBufs = [], grabId = -1;

  function build() {
    scene = SCENES[(ui.scene && ui.scene.value) || 'flag'];
    N = parseInt((ui.res && ui.res.value) || '49', 10);
    PN = N * N;
    const SZ = 1.3, s0 = SZ / (N - 1);
    const pos = new Float32Array(PN * 4);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        let px, py, pz;
        if (scene.orient === 'v') {
          px = (x / (N - 1) - 0.5) * SZ;
          py = 0.85 - (y / (N - 1)) * SZ;
          pz = (Math.random() - 0.5) * 0.01;
        } else {
          px = (x / (N - 1) - 0.5) * SZ;
          py = 0.55;
          pz = (y / (N - 1) - 0.5) * SZ;
        }
        let inv = 1;
        if (scene.pins === 'left' && x === 0 && (y % Math.floor((N - 1) / 4) === 0 || y === N - 1)) inv = 0;
        if (scene.pins === 'top' && y === 0) inv = 0;
        if (scene.pins === 'corners' && (y === 0 || y === N - 1) && (x === 0 || x === N - 1)) inv = 0;
        pos.set([px, py, pz, inv], i * 4);
      }

    /* 约束 + 图着色分组：结构 H/V 各 2 组，斜拉 2 向各 4 组，弯曲 H/V 各 4 组 */
    const gArr = [];
    const addG = () => { gArr.push([]); return gArr.length - 1; };
    const D2 = Math.SQRT2 * s0;
    const idx = (x, y) => y * N + x;
    /* 结构 */
    let g0 = addG(), g1 = addG();
    for (let y = 0; y < N; y++) for (let x = 0; x < N - 1; x++) gArr[x % 2 ? g1 : g0].push([idx(x, y), idx(x + 1, y), s0, 0]);
    let g2 = addG(), g3 = addG();
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N; x++) gArr[y % 2 ? g3 : g2].push([idx(x, y), idx(x, y + 1), s0, 0]);
    if (!scene.net) {
      /* 斜拉 */
      const sh = [addG(), addG(), addG(), addG()];
      for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++)
        gArr[sh[(x % 2) * 2 + (y % 2)]].push([idx(x, y), idx(x + 1, y + 1), D2, 1]);
      const sh2 = [addG(), addG(), addG(), addG()];
      for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++)
        gArr[sh2[(x % 2) * 2 + (y % 2)]].push([idx(x + 1, y), idx(x, y + 1), D2, 1]);
      /* 弯曲 */
      const bh = [addG(), addG(), addG(), addG()];
      for (let y = 0; y < N; y++) for (let x = 0; x < N - 2; x++)
        gArr[bh[x % 4]].push([idx(x, y), idx(x + 2, y), s0 * 2, 2]);
      const bv = [addG(), addG(), addG(), addG()];
      for (let y = 0; y < N - 2; y++) for (let x = 0; x < N; x++)
        gArr[bv[y % 4]].push([idx(x, y), idx(x, y + 2), s0 * 2, 2]);
    }
    const flat = [];
    groups = [];
    gArr.forEach((g) => {
      if (!g.length) return;
      groups.push({ off: flat.length, num: g.length });
      g.forEach((c) => flat.push(c));
    });
    CN = flat.length;
    const cIdx = new Uint32Array(CN * 2);
    const cRest = new Float32Array(CN * 2);
    flat.forEach((c, i) => {
      cIdx[i * 2] = c[0]; cIdx[i * 2 + 1] = c[1];
      cRest[i * 2] = c[2]; cRest[i * 2 + 1] = c[3];
    });

    /* 显式弹簧邻接表（每粒子 ≤12 根） */
    const adjIdx = new Uint32Array(PN * 12).fill(0xffffffff);
    const adjRest = new Float32Array(PN * 24);
    const adjCnt = new Uint32Array(PN);
    flat.forEach((c) => {
      [[c[0], c[1]], [c[1], c[0]]].forEach(([a, b]) => {
        if (adjCnt[a] < 12) {
          adjIdx[a * 12 + adjCnt[a]] = b;
          adjRest[(a * 12 + adjCnt[a]) * 2] = c[2];
          adjRest[(a * 12 + adjCnt[a]) * 2 + 1] = c[3];
          adjCnt[a]++;
        }
      });
    });

    /* 三角形与渔网线的 index buffer */
    const tris = [];
    for (let y = 0; y < N - 1; y++)
      for (let x = 0; x < N - 1; x++) {
        const a = idx(x, y), b = idx(x + 1, y), c = idx(x, y + 1), d = idx(x + 1, y + 1);
        tris.push(a, b, c, b, d, c);
      }
    const nets = [];
    flat.forEach((c) => { if (c[3] === 0) nets.push(c[0], c[1]); });

    [posBuf, prevBuf, velBuf, nrmBuf, cIdxBuf, cRestBuf, lamBuf, adjIdxBuf, adjRestBuf, clothIdxBuf, netIdxBuf]
      .forEach((b) => { if (b) b.destroy(); });
    const mkS = (arr, extra) => {
      const b = device.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | (extra || 0) });
      device.queue.writeBuffer(b, 0, arr);
      return b;
    };
    posBuf = mkS(pos);
    prevBuf = mkS(pos.slice());
    velBuf = mkS(new Float32Array(PN * 4));
    nrmBuf = mkS(new Float32Array(PN * 4));
    cIdxBuf = mkS(cIdx);
    cRestBuf = mkS(cRest);
    lamBuf = mkS(new Float32Array(CN));
    adjIdxBuf = mkS(adjIdx);
    adjRestBuf = mkS(adjRest);
    clothIdxN = tris.length;
    clothIdxBuf = device.createBuffer({ size: tris.length * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(clothIdxBuf, 0, new Uint32Array(tris));
    netIdxN = nets.length;
    netIdxBuf = device.createBuffer({ size: Math.max(nets.length, 2) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(netIdxBuf, 0, new Uint32Array(nets));

    /* 地面高度写入场景 */
    const fy = scene.floor;
    for (let i = 0; i < floorN; i++) floorArr[i * 4 + 1] = fy > -900 ? fy : 0;
    device.queue.writeBuffer(floorBuf, 0, floorArr);

    /* 组 uniform 与 bind group */
    grpBufs.forEach((g) => g.buf.destroy());
    grpBufs = groups.map((g) => {
      const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Uint32Array([g.off, g.num, 0, 0]));
      return { buf, num: g.num };
    });
    const bg = (pipe, entries) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map((r, i) => ({ binding: i, resource: { buffer: r } })),
    });
    BG = {
      nrm: bg(nrmP, [cuBuf, posBuf, nrmBuf]),
      int: bg(intP, [cuBuf, posBuf, prevBuf, nrmBuf]),
      rst: bg(rstP, [lamBuf]),
      col: bg(colP, [cuBuf, posBuf, prevBuf]),
      spr: bg(sprP, [cuBuf, posBuf, velBuf, adjIdxBuf, adjRestBuf, nrmBuf]),
      pik: bg(pikP, [cuBuf, pkBuf, posBuf, bestBuf]),
      slv: grpBufs.map((g) => bg(slvP, [cuBuf, g.buf, posBuf, cIdxBuf, cRestBuf, lamBuf])),
      draw: device.createBindGroup({
        layout: clothRP.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ruBuf } },
          { binding: 1, resource: { buffer: posBuf } },
          { binding: 2, resource: { buffer: nrmBuf } },
        ],
      }),
      netLine: bg(lineRP, [ruBuf, posBuf]),
      floorLine: bg(lineRP, [ruBuf, floorBuf]),
    };
    grabId = -1;
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

  /* 交互：点中布料 → 抓取；点空 → 旋转视角；滚轮推拉 */
  let yaw = 0.55, pitch = 0.18, radius = 2.5;
  let dragging = false, mode = 'none', px0 = 0, py0 = 0, mouseNdc = [0, 0], pickPending = false;
  let vpMat = null, camBasis = null, grabDepth = 2.0;
  function ndcOf(e) {
    const r = cvs.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  }
  cvs.addEventListener('pointerdown', (e) => {
    dragging = true; mode = 'pending'; px0 = e.clientX; py0 = e.clientY;
    mouseNdc = ndcOf(e);
    pickPending = true;
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    mouseNdc = ndcOf(e);
    if (mode === 'orbit' || (mode === 'pending' && Math.abs(e.clientX - px0) + Math.abs(e.clientY - py0) > 40)) {
      mode = 'orbit';
      yaw += (e.clientX - px0) * 0.006;
      pitch = Math.max(-0.4, Math.min(1.0, pitch + (e.clientY - py0) * 0.004));
    }
    px0 = e.clientX; py0 = e.clientY;
  });
  const release = () => { dragging = false; mode = 'none'; grabId = -1; };
  cvs.addEventListener('pointerup', release);
  cvs.addEventListener('pointercancel', release);
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(1.5, Math.min(4.5, radius + e.deltaY * 0.0018));
  }, { passive: false });
  if (ui.reset) ui.reset.addEventListener('click', build);
  if (ui.scene) ui.scene.addEventListener('change', build);
  if (ui.res) ui.res.addEventListener('change', build);
  if (ui.algo) ui.algo.addEventListener('change', () => { if (ui.algo.value === 'spring') build(); });

  build();

  const proj = mat4.perspective(0.8, cvs.width / cvs.height, 0.05, 30);
  const cuArr = new Float32Array(24);
  const ruArr = new Float32Array(24);
  const pkArr = new Float32Array(20);
  let prevT = 0, fps = 60, bestReading = false;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prevT) / 1000, 0.033) || 0.016;
    prevT = ts;
    const t = ts / 1000;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;

    const algo = (ui.algo && ui.algo.value) || 'xpbd';
    const iters = parseInt((ui.iter && ui.iter.value) || '16', 10);
    if (ui.iterV) ui.iterV.textContent = iters;
    const stretch = parseFloat((ui.stretch && ui.stretch.value) || '0.85');
    const bend = parseFloat((ui.bend && ui.bend.value) || '0.4');
    const damp = parseFloat((ui.damp && ui.damp.value) || '0.02');
    const windP = parseFloat((ui.wind && ui.wind.value) || String(scene.windDef));

    /* 相机 */
    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, 0.15 + Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const tgt = [0, scene.orient === 'v' ? 0.15 : 0, 0];
    const view = mat4.lookAt(eye, tgt, [0, 1, 0]);
    const vp = mat4.multiply(proj, view);
    vpMat = vp;
    const nrm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = nrm3([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
    const rightV = nrm3(crs(fwd, [0, 1, 0]));
    const upV = crs(rightV, fwd);
    camBasis = { eye, fwd, rightV, upV };
    grabDepth = Math.hypot(eye[0] - tgt[0], eye[1] - tgt[1], eye[2] - tgt[2]);

    /* 抓取目标：鼠标射线在 grabDepth 处的点 */
    const th = Math.tan(0.4), aspect = cvs.width / cvs.height;
    const grabTarget = [
      eye[0] + (fwd[0] + rightV[0] * mouseNdc[0] * th * aspect + upV[0] * mouseNdc[1] * th) * grabDepth,
      eye[1] + (fwd[1] + rightV[1] * mouseNdc[0] * th * aspect + upV[1] * mouseNdc[1] * th) * grabDepth,
      eye[2] + (fwd[2] + rightV[2] * mouseNdc[0] * th * aspect + upV[2] * mouseNdc[1] * th) * grabDepth,
    ];

    /* 风（带阵风起伏） */
    const gust = 0.55 + 0.35 * Math.sin(t * 1.3) + 0.22 * Math.sin(t * 3.7 + 1.7);
    const wd = scene.wind;

    /* 解算参数映射 */
    const mode3 = algo === 'xpbd' ? 0 : algo === 'pbd' ? 1 : 2;
    let cz, cw, dt;
    if (mode3 === 0) {
      cz = Math.pow(10, -7 + 5 * (1 - stretch));   /* 柔度 */
      cw = Math.pow(10, -5.5 + 5 * (1 - bend));
      dt = dtF;
    } else if (mode3 === 1) {
      cz = 0.2 + 0.8 * stretch;                    /* 刚度 */
      cw = 0.05 + 0.75 * bend;
      dt = dtF;
    } else {
      cz = 400 + stretch * 26000;                  /* 弹簧 k */
      cw = 80 + bend * 4000;
      dt = dtF / iters;
    }

    cuArr[0] = dt; cuArr[1] = damp; cuArr[2] = 9.8; cuArr[3] = windP * gust;
    cuArr[4] = wd[0]; cuArr[5] = wd[1]; cuArr[6] = wd[2]; cuArr[7] = t;
    cuArr[8] = mode3; cuArr[9] = iters; cuArr[10] = cz; cuArr[11] = cw;
    cuArr[12] = 0; cuArr[13] = scene.sphere ? -0.25 : 0; cuArr[14] = 0; cuArr[15] = scene.sphere;
    cuArr[16] = scene.floor; cuArr[17] = grabId; cuArr[18] = N; cuArr[19] = 0;
    cuArr[20] = grabTarget[0]; cuArr[21] = grabTarget[1]; cuArr[22] = grabTarget[2]; cuArr[23] = 0;
    device.queue.writeBuffer(cuBuf, 0, cuArr);

    ruArr.set(vp, 0);
    ruArr[16] = eye[0]; ruArr[17] = eye[1]; ruArr[18] = eye[2]; ruArr[19] = 0;
    ruArr[20] = N; ruArr[21] = 0; ruArr[22] = 0; ruArr[23] = 0;
    device.queue.writeBuffer(ruBuf, 0, ruArr);
    if (scene.sphere) {
      device.queue.writeBuffer(spBuf, 0, new Float32Array([0, -0.25, 0, scene.sphere * 0.97]));
    }

    /* 拾取（pointerdown 后一帧） */
    if (pickPending && vpMat) {
      pickPending = false;
      device.queue.writeBuffer(bestBuf, 0, new Uint32Array([0xffffffff]));
      pkArr.set(vpMat, 0);
      pkArr[16] = mouseNdc[0]; pkArr[17] = mouseNdc[1];
      device.queue.writeBuffer(pkBuf, 0, pkArr);
      const e2 = device.createCommandEncoder();
      const c2 = e2.beginComputePass();
      c2.setPipeline(pikP); c2.setBindGroup(0, BG.pik);
      c2.dispatchWorkgroups(Math.ceil(PN / 64));
      c2.end();
      e2.copyBufferToBuffer(bestBuf, 0, bestRead, 0, 4);
      device.queue.submit([e2.finish()]);
      if (!bestReading) {
        bestReading = true;
        bestRead.mapAsync(GPUMapMode.READ).then(() => {
          const v = new Uint32Array(bestRead.getMappedRange())[0];
          bestRead.unmap();
          bestReading = false;
          if (dragging && mode === 'pending') {
            const d = (v >>> 16) / 2048;
            if (d < 0.07) { mode = 'grab'; grabId = v & 0xffff; }
            else { mode = 'orbit'; }
          }
        }).catch(() => { bestReading = false; });
      }
    }
    if (mode !== 'grab') grabId = -1;

    /* 模拟 */
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    const disp = (pipe, group, n) => {
      cp.setPipeline(pipe); cp.setBindGroup(0, group); cp.dispatchWorkgroups(Math.ceil(n / 64));
    };
    disp(nrmP, BG.nrm, PN);
    if (mode3 === 2) {
      for (let s = 0; s < iters; s++) disp(sprP, BG.spr, PN);
    } else {
      disp(intP, BG.int, PN);
      disp(rstP, BG.rst, CN);
      for (let it = 0; it < iters; it++) {
        for (let g = 0; g < grpBufs.length; g++) disp(slvP, BG.slv[g], grpBufs[g].num);
      }
      disp(colP, BG.col, PN);
    }
    cp.end();

    /* 渲染 */
    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0.012, g: 0.014, b: 0.022, a: 1 }, storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthView, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store',
      },
    });
    if (scene.floor > -900) {
      rp.setPipeline(lineRP);
      rp.setBindGroup(0, BG.floorLine);
      rp.draw(floorN);
    }
    if (scene.net) {
      rp.setPipeline(lineRP);
      rp.setBindGroup(0, BG.netLine);
      rp.setIndexBuffer(netIdxBuf, 'uint32');
      rp.drawIndexed(netIdxN);
    } else {
      rp.setPipeline(clothRP);
      rp.setBindGroup(0, BG.draw);
      rp.setIndexBuffer(clothIdxBuf, 'uint32');
      rp.drawIndexed(clothIdxN);
    }
    if (scene.sphere) {
      rp.setPipeline(sphereRP);
      rp.setBindGroup(0, sphereBG);
      rp.setVertexBuffer(0, sphereVB);
      rp.setIndexBuffer(sphereIB, 'uint32');
      rp.drawIndexed(sphereIdxN);
    }
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
      const name = algo === 'xpbd' ? 'XPBD' : algo === 'pbd' ? 'PBD' : '质点弹簧';
      hud.textContent = N + '×' + N + ' 粒子 · ' + CN.toLocaleString() + ' 约束 · ' + name + ' · ' +
        (canTime ? 'sim ' + simMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prevT = ts; loop(ts); });
}

main();
