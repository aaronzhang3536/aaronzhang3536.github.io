/* Nanite-like Meshlet 管线（LOD 版）— 裸 WebGPU
   场景 = 数百个环面纽结实例，每个有 4 级 LOD；「场景三角形」按全分辨率等效
   计数达数千万，但每帧靠「视锥/背面剔除 + 按屏幕距离选 LOD」只光栅化其中
   一小部分——这正是 Nanite 的核心：几何存一份、实例化 + LOD 复用。
   ① compute 剔除：每（实例×meshlet）线程按实例距离选 LOD，再做视锥球 +
      meshopt 式背面锥测试，幸存者 atomic 压实进可见表并写 indirect 参数
   ② compute 软件光栅：每 workgroup 一个可见 meshlet、每线程一个三角形，
      用 atomicMax((深度«21)|压缩槽位ID) 写可见性缓冲。ID 用「压缩后的可见
      槽位」而非全局索引 —— 上限只取决于每帧可见 meshlet 数（≤16384），
      于是场景总三角形可远超 32 位打包的裸上限。
   ③ 全屏 resolve：解码重建法线着色；可看 meshlet / LOD 层级 / 深度 视图。
   勾选「冻结剔除相机」再转视角，能看到视锥外与远处降级的世界。 */
import { mat4 } from 'wgpu-matrix';

const MTRI = 128;
const MAXVIS = 16384;   // 每帧可见 meshlet 预算（ID 用 21 位，深度 11 位）

const CULL_WGSL = /* wgsl */ `
struct CU {
  planes: array<vec4f, 6>,
  eye: vec4f,     // xyz, numInstances
  lodS: vec4f,    // 各 LOD 的 meshlet 起始
  lodC: vec4f,    // 各 LOD 的 meshlet 数量
  lodD: vec4f,    // LOD 距离阈值 t0 t1 t2, w=maxLocal
  misc: vec4f,    // x maxVis, y frozen(未用)
};
struct Meshlet { c: vec4f, cone: vec4f };
struct Inst { pr: vec4f };   // xyz 位置, w yaw
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read> ml: array<Meshlet>;
@group(0) @binding(2) var<storage, read> inst: array<Inst>;
@group(0) @binding(3) var<storage, read_write> vis: array<u32>;
@group(0) @binding(4) var<storage, read_write> cnt: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> args: array<atomic<u32>>;

fn rotY(p: vec3f, a: f32) -> vec3f {
  let s = sin(a); let c = cos(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn pickLOD(d: f32) -> u32 {
  if (d < cu.lodD.x) { return 0u; }
  if (d < cu.lodD.y) { return 1u; }
  if (d < cu.lodD.z) { return 2u; }
  return 3u;
}
fn lodStart(l: u32) -> u32 {
  if (l == 0u) { return u32(cu.lodS.x); }
  if (l == 1u) { return u32(cu.lodS.y); }
  if (l == 2u) { return u32(cu.lodS.z); }
  return u32(cu.lodS.w);
}
fn lodCount(l: u32) -> u32 {
  if (l == 0u) { return u32(cu.lodC.x); }
  if (l == 1u) { return u32(cu.lodC.y); }
  if (l == 2u) { return u32(cu.lodC.z); }
  return u32(cu.lodC.w);
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let maxLocal = u32(cu.lodD.w);
  let ni = u32(cu.eye.w);
  let instI = id.x / maxLocal;
  let local = id.x % maxLocal;
  if (instI >= ni) { return; }
  let it = inst[instI];
  let pos = it.pr.xyz;
  let yaw = it.pr.w;
  let d = length(pos - cu.eye.xyz);
  let lod = pickLOD(d);
  if (local >= lodCount(lod)) { return; }
  let gmi = lodStart(lod) + local;
  let m = ml[gmi];
  let c = rotY(m.c.xyz, yaw) + pos;
  let r = m.c.w;
  for (var p = 0u; p < 6u; p++) {
    if (dot(cu.planes[p].xyz, c) + cu.planes[p].w < -r) { atomicAdd(&cnt[1], 1u); return; }
  }
  if (m.cone.w < 0.99) {
    let ax = rotY(m.cone.xyz, yaw);
    let dv = c - cu.eye.xyz;
    if (dot(dv, ax) >= m.cone.w * length(dv) + r) { atomicAdd(&cnt[2], 1u); return; }
  }
  let slot = atomicAdd(&cnt[0], 1u);
  if (slot < u32(cu.misc.x)) {
    vis[slot] = (gmi & 0xfffu) | (instI << 12u);
    atomicMax(&args[0], slot + 1u);
  }
}`;

const RASTER_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, size: vec4f };
struct Meshlet { c: vec4f, cone: vec4f };
struct Inst { pr: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> verts: array<vec4f>;
@group(0) @binding(2) var<storage, read> tris: array<u32>;
@group(0) @binding(3) var<storage, read> vis: array<u32>;
@group(0) @binding(4) var<storage, read> inst: array<Inst>;
@group(0) @binding(5) var<storage, read_write> fb: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> cnt: array<atomic<u32>>;

const MTRI = 128u;
fn rotY(p: vec3f, a: f32) -> vec3f {
  let s = sin(a); let c = cos(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
@compute @workgroup_size(128)
fn cs(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let slot = wg.x;
  let pack = vis[slot];
  let gmi = pack & 0xfffu;
  let instI = pack >> 12u;
  let it = inst[instI];
  let t = li.x;
  let base = (gmi * MTRI + t) * 3u;
  let i0 = tris[base]; let i1 = tris[base + 1u]; let i2 = tris[base + 2u];
  let W = ru.size.x; let H = ru.size.y;
  let v0 = rotY(verts[i0].xyz, it.pr.w) + it.pr.xyz;
  let v1 = rotY(verts[i1].xyz, it.pr.w) + it.pr.xyz;
  let v2 = rotY(verts[i2].xyz, it.pr.w) + it.pr.xyz;
  let c0 = ru.vp * vec4f(v0, 1.0);
  let c1 = ru.vp * vec4f(v1, 1.0);
  let c2 = ru.vp * vec4f(v2, 1.0);
  if (c0.w < 0.02 || c1.w < 0.02 || c2.w < 0.02) { return; }
  let p0 = vec2f((c0.x / c0.w * 0.5 + 0.5) * W, (0.5 - c0.y / c0.w * 0.5) * H);
  let p1 = vec2f((c1.x / c1.w * 0.5 + 0.5) * W, (0.5 - c1.y / c1.w * 0.5) * H);
  let p2 = vec2f((c2.x / c2.w * 0.5 + 0.5) * W, (0.5 - c2.y / c2.w * 0.5) * H);
  let area = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  if (area >= 0.0) { return; }
  let lo = vec2i(max(floor(min(min(p0, p1), p2)), vec2f(0.0)));
  let hi = vec2i(min(ceil(max(max(p0, p1), p2)), vec2f(W - 1.0, H - 1.0)));
  let bw = hi.x - lo.x + 1; let bh = hi.y - lo.y + 1;
  if (bw <= 0 || bh <= 0) { return; }
  if (bw * bh > 4000) { return; }
  atomicAdd(&cnt[3], 1u);
  let z0 = c0.z / c0.w; let z1 = c1.z / c1.w; let z2 = c2.z / c2.w;
  let inv = 1.0 / area;
  let idPack = slot * MTRI + t + 1u;
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      let px = vec2f(f32(x) + 0.5, f32(y) + 0.5);
      let w0 = ((p1.x - px.x) * (p2.y - px.y) - (p1.y - px.y) * (p2.x - px.x)) * inv;
      let w1 = ((p2.x - px.x) * (p0.y - px.y) - (p2.y - px.y) * (p0.x - px.x)) * inv;
      let w2 = 1.0 - w0 - w1;
      if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) { continue; }
      let z = w0 * z0 + w1 * z1 + w2 * z2;
      let zq = u32(clamp(1.0 - z, 0.0, 1.0) * 2047.0);
      atomicMax(&fb[u32(y) * u32(W) + u32(x)], (zq << 21u) | idPack);
    }
  }
}`;

const RESOLVE_WGSL = /* wgsl */ `
struct VU { m: vec4f, lodS: vec4f };   /* m: x 视图, y W */
struct Meshlet { c: vec4f, cone: vec4f };
struct Inst { pr: vec4f };
@group(0) @binding(0) var<uniform> vu: VU;
@group(0) @binding(1) var<storage, read> fb: array<u32>;
@group(0) @binding(2) var<storage, read> verts: array<vec4f>;
@group(0) @binding(3) var<storage, read> tris: array<u32>;
@group(0) @binding(4) var<storage, read> vis: array<u32>;
@group(0) @binding(5) var<storage, read> inst: array<Inst>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn hue(h: f32) -> vec3f {
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
fn hash1(n: u32) -> f32 {
  var h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 1048576.0 % 1.0;
}
fn rotY(p: vec3f, a: f32) -> vec3f {
  let s = sin(a); let c = cos(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn lodOf(gmi: u32) -> u32 {
  if (gmi >= u32(vu.lodS.w)) { return 3u; }
  if (gmi >= u32(vu.lodS.z)) { return 2u; }
  if (gmi >= u32(vu.lodS.y)) { return 1u; }
  return 0u;
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let W = u32(vu.m.y);
  let v = fb[u32(fp.y) * W + u32(fp.x)];
  let id = v & 0x1fffffu;
  var c = vec3f(0.015, 0.018, 0.028);
  if (id != 0u) {
    let slot = (id - 1u) / 128u;
    let tri = (id - 1u) % 128u;
    let pack = vis[slot];
    let gmi = pack & 0xfffu;
    let instI = pack >> 12u;
    let it = inst[instI];
    let mode = u32(vu.m.x);
    if (mode == 1u) {
      c = hue(hash1(gmi * 97u + instI * 131u)) * 0.75 + 0.08;
    } else if (mode == 2u) {
      let lod = lodOf(gmi);
      let cols = array<vec3f, 4>(vec3f(0.3, 0.85, 0.4), vec3f(0.95, 0.85, 0.3), vec3f(0.95, 0.55, 0.25), vec3f(0.9, 0.3, 0.35));
      c = cols[lod];
    } else if (mode == 3u) {
      let zq = f32(v >> 21u) / 2047.0;
      c = vec3f(pow(zq, 2.2));
    } else {
      let base = (gmi * 128u + tri) * 3u;
      let p0 = rotY(verts[tris[base]].xyz, it.pr.w);
      let p1 = rotY(verts[tris[base + 1u]].xyz, it.pr.w);
      let p2 = rotY(verts[tris[base + 2u]].xyz, it.pr.w);
      let n = normalize(cross(p1 - p0, p2 - p0));
      let L = normalize(vec3f(0.5, 0.8, 0.35));
      let dif = max(dot(n, L), 0.0) * 0.8 + max(dot(n, -L), 0.0) * 0.15 + 0.12;
      c = (hue(hash1(instI * 131u)) * 0.18 + vec3f(0.52, 0.55, 0.6)) * dif;
    }
  }
  return vec4f(pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}`;

const LINE_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, size: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> pts: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return ru.vp * vec4f(pts[vi].xyz, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(1.0, 0.62, 0.18, 1.0); }`;

/* ---------- 环面纽结 (p=2,q=3) 的一级 LOD ---------- */
function knotVerts(SEGU, SEGV, R1, R2) {
  const verts = [];
  for (let i = 0; i <= SEGU; i++) {
    const t = (i / SEGU) * Math.PI * 2;
    const p = 2, q = 3;
    const r = R1 * (2 + Math.cos(q * t)) * 0.5;
    const cx = r * Math.cos(p * t), cy = R1 * Math.sin(q * t) * 0.35, cz = r * Math.sin(p * t);
    const t2 = t + 0.01;
    const r2 = R1 * (2 + Math.cos(q * t2)) * 0.5;
    const dx = r2 * Math.cos(p * t2) - cx, dy = R1 * Math.sin(q * t2) * 0.35 - cy, dz = r2 * Math.sin(p * t2) - cz;
    const tl = Math.hypot(dx, dy, dz) || 1;
    const tx = dx / tl, ty = dy / tl, tz = dz / tl;
    let nx = cx, ny = 0, nz = cz;
    const nd = tx * nx + ty * ny + tz * nz;
    nx -= tx * nd; ny -= ty * nd; nz -= tz * nd;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    for (let j = 0; j <= SEGV; j++) {
      const a = (j / SEGV) * Math.PI * 2;
      const ca = Math.cos(a) * R2, sa = Math.sin(a) * R2;
      verts.push(cx + nx * ca + bx * sa, cy + ny * ca + by * sa, cz + nz * ca + bz * sa, 1);
    }
  }
  return verts;
}

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
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
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const PW = Math.round(W * dpr), PH = Math.round(Hc * dpr);
  cvs.width = PW; cvs.height = PH;
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  /* ---------- 建 4 级 LOD（共享一份几何），拼接进全局缓冲 ---------- */
  const PATCH = 8;
  const LODS = [[512, 64], [256, 32], [128, 16], [64, 8]];   // (SEGU, SEGV)
  const allVerts = [];
  const meshlets = [];   // {cx,cy,cz,r, ax,ay,az,cut}
  const triList = [];    // 每 meshlet 连续 128 三角形
  const lodStart = [], lodCount = [];
  for (const [SEGU, SEGV] of LODS) {
    const vbase = allVerts.length / 4;
    const vs = knotVerts(SEGU, SEGV, 0.9, 0.22);
    for (let k = 0; k < vs.length; k++) allVerts.push(vs[k]);
    const vIdx = (i, j) => vbase + i * (SEGV + 1) + j;
    const MU = SEGU / PATCH, MV = SEGV / PATCH;
    lodStart.push(meshlets.length);
    for (let mu = 0; mu < MU; mu++)
      for (let mv = 0; mv < MV; mv++) {
        let cx = 0, cy = 0, cz = 0, n = 0, anx = 0, any2 = 0, anz = 0;
        const norms = [];
        for (let i = 0; i < PATCH; i++)
          for (let j = 0; j < PATCH; j++) {
            const a = vIdx(mu * PATCH + i, mv * PATCH + j);
            const b = vIdx(mu * PATCH + i + 1, mv * PATCH + j);
            const c = vIdx(mu * PATCH + i, mv * PATCH + j + 1);
            const d = vIdx(mu * PATCH + i + 1, mv * PATCH + j + 1);
            triList.push(a, b, c, b, d, c);
            [[a, b, c], [b, d, c]].forEach(([p, q, r2]) => {
              const e1 = [allVerts[q * 4] - allVerts[p * 4], allVerts[q * 4 + 1] - allVerts[p * 4 + 1], allVerts[q * 4 + 2] - allVerts[p * 4 + 2]];
              const e2 = [allVerts[r2 * 4] - allVerts[p * 4], allVerts[r2 * 4 + 1] - allVerts[p * 4 + 1], allVerts[r2 * 4 + 2] - allVerts[p * 4 + 2]];
              let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
              const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
              norms.push([nx, ny, nz]); anx += nx; any2 += ny; anz += nz;
            });
          }
        for (let i = 0; i <= PATCH; i++)
          for (let j = 0; j <= PATCH; j++) {
            const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j);
            cx += allVerts[vi2 * 4]; cy += allVerts[vi2 * 4 + 1]; cz += allVerts[vi2 * 4 + 2]; n++;
          }
        cx /= n; cy /= n; cz /= n;
        let rad = 0;
        for (let i = 0; i <= PATCH; i++)
          for (let j = 0; j <= PATCH; j++) {
            const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j);
            rad = Math.max(rad, Math.hypot(allVerts[vi2 * 4] - cx, allVerts[vi2 * 4 + 1] - cy, allVerts[vi2 * 4 + 2] - cz));
          }
        const al = Math.hypot(anx, any2, anz) || 1;
        const ax = anx / al, ay = any2 / al, az = anz / al;
        let mindp = 1;
        norms.forEach(([nx, ny, nz]) => { mindp = Math.min(mindp, nx * ax + ny * ay + nz * az); });
        const cutoff = mindp <= 0.1 ? 1 : Math.sqrt(1 - mindp * mindp);
        meshlets.push([cx, cy, cz, rad, ax, ay, az, cutoff]);
      }
    lodCount.push(meshlets.length - lodStart[lodStart.length - 1]);
  }
  const TOPO = meshlets.length;
  const maxLocal = lodCount[0];

  /* ---------- 实例 ---------- */
  const GRID = 20, SPACING = 3.6;
  const insts = [];
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) {
      const x = (i - (GRID - 1) / 2) * SPACING + (Math.random() - 0.5) * 0.6;
      const z = (j - (GRID - 1) / 2) * SPACING + (Math.random() - 0.5) * 0.6;
      insts.push([x, 0, z, Math.random() * Math.PI * 2]);
    }
  const NI = insts.length;
  const SRC_TRIS = NI * lodCount[0] * MTRI;   // 全分辨率等效三角形数

  const mkS = (arr, ctor, usage) => {
    const b = device.createBuffer({ size: arr.length * ctor.BYTES_PER_ELEMENT, usage: (usage || GPUBufferUsage.STORAGE) | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new ctor(arr));
    return b;
  };
  const vertBuf = mkS(allVerts, Float32Array);
  const triBuf = mkS(triList, Uint32Array);
  const mlBuf = mkS(meshlets.flat(), Float32Array);
  const instBuf = mkS(insts.flat(), Float32Array);
  const visBuf = device.createBuffer({ size: MAXVIS * 4, usage: GPUBufferUsage.STORAGE });
  const fbBuf = device.createBuffer({ size: PW * PH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cntBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const argsBuf = device.createBuffer({ size: 12, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  const cuBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const vuBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frusBuf = device.createBuffer({ size: 24 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const mkCP = (code) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' } });
  const cullP = mkCP(CULL_WGSL);
  const rastP = mkCP(RASTER_WGSL);
  const resMod = device.createShaderModule({ code: RESOLVE_WGSL });
  const resP = device.createRenderPipeline({
    layout: 'auto', vertex: { module: resMod, entryPoint: 'vs' },
    fragment: { module: resMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' },
  });
  const lineMod = device.createShaderModule({ code: LINE_WGSL });
  const lineP = device.createRenderPipeline({
    layout: 'auto', vertex: { module: lineMod, entryPoint: 'vs' },
    fragment: { module: lineMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'line-list' },
  });
  if (wgslEl) wgslEl.textContent = '// ---- 剔除 + LOD 选择 ----' + CULL_WGSL + '\n\n// ---- 软件光栅 ----' + RASTER_WGSL;

  const bg = (pipe, arr) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: arr.map((r, i) => ({ binding: i, resource: { buffer: r } })) });
  const cullBG = bg(cullP, [cuBuf, mlBuf, instBuf, visBuf, cntBuf, argsBuf]);
  const rastBG = bg(rastP, [ruBuf, vertBuf, triBuf, visBuf, instBuf, fbBuf, cntBuf]);
  const resBG = bg(resP, [vuBuf, fbBuf, vertBuf, triBuf, visBuf, instBuf]);
  const lineBG = bg(lineP, [ruBuf, frusBuf]);

  let qs = null, qBuf = null, readPool = [], cullMs = 0, rastMs = 0;
  if (canTime) {
    qs = device.createQuerySet({ type: 'timestamp', count: 4 });
    qBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) readPool.push({ buf: device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false });
  }
  const statRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let statBusy = false, stats = [0, 0, 0, 0];

  const $ = (id) => document.getElementById(id);
  const ui = { view: $('me-view'), freeze: $('me-freeze') };
  try { const q = new URLSearchParams(location.search); if (q.has('view') && ui.view) ui.view.value = q.get('view'); } catch (e) {}
  let yaw = 0.5, pitch = 0.5, radius = 26;
  let dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.005;
    pitch = Math.max(0.05, Math.min(1.3, pitch + (e.clientY - py0) * 0.004));
    px0 = e.clientX; py0 = e.clientY;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => { e.preventDefault(); radius = Math.max(5, Math.min(60, radius + e.deltaY * 0.02)); }, { passive: false });
  let frozen = null;
  if (ui.freeze) ui.freeze.addEventListener('change', () => { frozen = null; });

  const proj = mat4.perspective(0.9, PW / PH, 0.2, 200);
  const cuArr = new Float32Array(40);
  const ruArr = new Float32Array(20);
  const vuArr = new Float32Array(8);
  let prev = 0, fps = 60;

  function planesOf(vp) {
    const r = (i) => [vp[i], vp[4 + i], vp[8 + i], vp[12 + i]];
    const r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3);
    const mk = (a, s) => {
      const p = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]];
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] / l, p[1] / l, p[2] / l, p[3] / l];
    };
    return [mk(r0, 1), mk(r0, -1), mk(r1, 1), mk(r1, -1), mk(r2, 1), mk(r2, -1)];
  }
  function frustumCorners(vpInv) {
    const cs = [];
    for (const z of [0.02, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) {
      const cx = vpInv[0] * x + vpInv[4] * y + vpInv[8] * z + vpInv[12];
      const cy = vpInv[1] * x + vpInv[5] * y + vpInv[9] * z + vpInv[13];
      const cz = vpInv[2] * x + vpInv[6] * y + vpInv[10] * z + vpInv[14];
      const cw = vpInv[3] * x + vpInv[7] * y + vpInv[11] * z + vpInv[15];
      cs.push([cx / cw, cy / cw, cz / cw]);
    }
    const E = [[0,1],[2,3],[0,2],[1,3],[4,5],[6,7],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    const arr = new Float32Array(24 * 4);
    E.flat().forEach((ci, k) => arr.set([...cs[ci], 1], k * 4));
    return arr;
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.05) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;

    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, 4 + Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const vp = mat4.multiply(proj, view);

    const freezeOn = ui.freeze && ui.freeze.checked;
    if (freezeOn && !frozen) { frozen = { vp: vp.slice(), eye: eye.slice() }; device.queue.writeBuffer(frusBuf, 0, frustumCorners(mat4.inverse(vp))); }
    if (!freezeOn) frozen = null;
    const cullVp = frozen ? frozen.vp : vp;
    const cullEye = frozen ? frozen.eye : eye;

    const pl = planesOf(cullVp);
    for (let p = 0; p < 6; p++) cuArr.set(pl[p], p * 4);
    cuArr[24] = cullEye[0]; cuArr[25] = cullEye[1]; cuArr[26] = cullEye[2]; cuArr[27] = NI;
    cuArr[28] = lodStart[0]; cuArr[29] = lodStart[1]; cuArr[30] = lodStart[2]; cuArr[31] = lodStart[3];
    cuArr[32] = lodCount[0]; cuArr[33] = lodCount[1]; cuArr[34] = lodCount[2]; cuArr[35] = lodCount[3];
    cuArr[36] = 11; cuArr[37] = 22; cuArr[38] = 44; cuArr[39] = maxLocal;   // LOD 距离阈值 + maxLocal
    device.queue.writeBuffer(cuBuf, 0, cuArr);
    // misc（含 maxVis）在 CU 结构偏移 160，超出 cuArr 的 160B → 单独写
    device.queue.writeBuffer(cuBuf, 160, new Float32Array([MAXVIS, 0, 0, 0]));

    ruArr.set(vp, 0);
    ruArr[16] = PW; ruArr[17] = PH; ruArr[18] = 0; ruArr[19] = 0;
    device.queue.writeBuffer(ruBuf, 0, ruArr);
    vuArr[0] = parseInt((ui.view && ui.view.value) || '0', 10); vuArr[1] = PW;
    vuArr[4] = lodStart[0]; vuArr[5] = lodStart[1]; vuArr[6] = lodStart[2]; vuArr[7] = lodStart[3];
    device.queue.writeBuffer(vuBuf, 0, vuArr);
    device.queue.writeBuffer(cntBuf, 0, new Uint32Array([0, 0, 0, 0]));
    device.queue.writeBuffer(argsBuf, 0, new Uint32Array([0, 1, 1]));

    const enc = device.createCommandEncoder();
    enc.clearBuffer(fbBuf);
    const cp1 = enc.beginComputePass(canTime ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    cp1.setPipeline(cullP); cp1.setBindGroup(0, cullBG); cp1.dispatchWorkgroups(Math.ceil(NI * maxLocal / 64));
    cp1.end();
    const cp2 = enc.beginComputePass(canTime ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {});
    cp2.setPipeline(rastP); cp2.setBindGroup(0, rastBG); cp2.dispatchWorkgroupsIndirect(argsBuf, 0);
    cp2.end();

    const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }] });
    rp.setPipeline(resP); rp.setBindGroup(0, resBG); rp.draw(3);
    if (frozen) { rp.setPipeline(lineP); rp.setBindGroup(0, lineBG); rp.draw(24); }
    rp.end();

    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) { enc.resolveQuerySet(qs, 0, 4, qBuf, 0); enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 32); }
    }
    if (!statBusy) enc.copyBufferToBuffer(cntBuf, 0, statRead, 0, 16);
    const doStat = !statBusy;
    device.queue.submit([enc.finish()]);

    if (slot) {
      slot.busy = true;
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigInt64Array(slot.buf.getMappedRange());
        cullMs += (Number(q[1] - q[0]) / 1e6 - cullMs) * 0.1;
        rastMs += (Number(q[3] - q[2]) / 1e6 - rastMs) * 0.1;
        slot.buf.unmap(); slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (doStat) {
      statBusy = true;
      statRead.mapAsync(GPUMapMode.READ).then(() => { stats = Array.from(new Uint32Array(statRead.getMappedRange())); statRead.unmap(); statBusy = false; }).catch(() => { statBusy = false; });
    }
    if (hud) {
      const vis = Math.min(stats[0], MAXVIS);
      const srcM = (SRC_TRIS / 1e6).toFixed(1);
      const rastM = (stats[3] / 1e6).toFixed(2);
      hud.textContent = '场景 ' + srcM + 'M 三角形（' + NI + ' 实例×LOD）· 本帧光栅 ' + rastM + 'M · 可见 meshlet ' +
        vis + (stats[0] > MAXVIS ? '(超预算截断)' : '') + ' · ' +
        (canTime ? 'cull ' + cullMs.toFixed(2) + '+raster ' + rastMs.toFixed(2) + 'ms · ' : '') +
        Math.round(fps) + ' fps' + (frozen ? ' · 剔除已冻结' : '');
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
