/* Nanite-like Meshlet 管线 — 裸 WebGPU
   ① 网格切成 128 三角形的 meshlet（束球 + 法线锥，meshopt 式安全锥测试）
   ② compute 剔除：视锥 + 背面锥 → atomic 压实可见表 → 写 indirect 参数
   ③ compute 软件光栅：每 workgroup 一个可见 meshlet、每线程一个三角形，
      atomicMax 按「深度<<19 | ID」打包写可见性缓冲 —— CPU 全程不知道画了什么
   ④ 全屏 resolve：解码 ID 重建着色 / meshlet 彩色 / 深度 / 过绘制视图
   冻结剔除相机后转动观察视角，能亲眼看到视锥外的 meshlet 消失 */
import { mat4 } from 'wgpu-matrix';

const CULL_WGSL = /* wgsl */ `
struct CU {
  planes: array<vec4f, 6>,
  eye: vec4f,
};
struct Meshlet { c: vec4f, cone: vec4f, off: vec4f };   /* 束球 xyz+r · 锥 xyz+cutoff · 实例偏移 */
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read> ml: array<Meshlet>;
@group(0) @binding(2) var<storage, read_write> vis: array<u32>;
@group(0) @binding(3) var<storage, read_write> cnt: array<atomic<u32>>;   /* 0可见 1视锥剔 2锥剔 3三角形 */
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>; /* indirect dispatch */
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&ml)) { return; }
  let m = ml[id.x];
  let c = m.c.xyz + m.off.xyz;
  let r = m.c.w;
  for (var p = 0u; p < 6u; p++) {
    if (dot(cu.planes[p].xyz, c) + cu.planes[p].w < -r) {
      atomicAdd(&cnt[1], 1u);
      return;
    }
  }
  /* meshopt 式锥剔除：dot(c-eye, axis) >= cutoff·|c-eye| + r → 整簇背面 */
  if (m.cone.w < 0.99) {
    let d = c - cu.eye.xyz;
    if (dot(d, m.cone.xyz) >= m.cone.w * length(d) + r) {
      atomicAdd(&cnt[2], 1u);
      return;
    }
  }
  let slot = atomicAdd(&cnt[0], 1u);
  vis[slot] = id.x;
  atomicMax(&args[0], slot + 1u);
}`;

const RASTER_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, size: vec4f };   /* size: xy 分辨率 */
struct Meshlet { c: vec4f, cone: vec4f, off: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> ml: array<Meshlet>;
@group(0) @binding(2) var<storage, read> verts: array<vec4f>;
@group(0) @binding(3) var<storage, read> tris: array<u32>;      /* 拓扑 meshlet × 128 × 3 */
@group(0) @binding(4) var<storage, read> vis: array<u32>;
@group(0) @binding(5) var<storage, read_write> fb: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> cnt: array<atomic<u32>>;

const MTRI = 128u;

@compute @workgroup_size(128)
fn cs(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let mid = vis[wg.x];
  let m = ml[mid];
  let topo = mid % ${'{TOPO}'}u;          /* 实例共享拓扑 */
  let t = li.x;
  let base = (topo * MTRI + t) * 3u;
  let i0 = tris[base];
  let i1 = tris[base + 1u];
  let i2 = tris[base + 2u];
  if (i0 == 0xffffffffu) { return; }
  let W = ru.size.x;
  let H = ru.size.y;
  var c0 = ru.vp * vec4f(verts[i0].xyz + m.off.xyz, 1.0);
  var c1 = ru.vp * vec4f(verts[i1].xyz + m.off.xyz, 1.0);
  var c2 = ru.vp * vec4f(verts[i2].xyz + m.off.xyz, 1.0);
  if (c0.w < 0.02 || c1.w < 0.02 || c2.w < 0.02) { return; }   /* 近平面裁剪：整三角形丢弃（demo 从简） */
  let p0 = vec2f((c0.x / c0.w * 0.5 + 0.5) * W, (0.5 - c0.y / c0.w * 0.5) * H);
  let p1 = vec2f((c1.x / c1.w * 0.5 + 0.5) * W, (0.5 - c1.y / c1.w * 0.5) * H);
  let p2 = vec2f((c2.x / c2.w * 0.5 + 0.5) * W, (0.5 - c2.y / c2.w * 0.5) * H);
  let area = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  if (area >= 0.0) { return; }            /* 背面 */
  let lo = vec2i(max(floor(min(min(p0, p1), p2)), vec2f(0.0)));
  let hi = vec2i(min(ceil(max(max(p0, p1), p2)), vec2f(W - 1.0, H - 1.0)));
  let bw = hi.x - lo.x + 1;
  let bh = hi.y - lo.y + 1;
  if (bw <= 0 || bh <= 0) { return; }
  if (bw * bh > 6000) { return; }         /* 特写大三角形放弃（软光栅只为小三角形而生） */
  atomicAdd(&cnt[3], 1u);
  let z0 = c0.z / c0.w;
  let z1 = c1.z / c1.w;
  let z2 = c2.z / c2.w;
  let inv = 1.0 / area;
  let idPack = mid * MTRI + t + 1u;       /* +1 保留 0 作背景 */
  for (var y = lo.y; y <= hi.y; y++) {
    for (var x = lo.x; x <= hi.x; x++) {
      let px = vec2f(f32(x) + 0.5, f32(y) + 0.5);
      let w0 = ((p1.x - px.x) * (p2.y - px.y) - (p1.y - px.y) * (p2.x - px.x)) * inv;
      let w1 = ((p2.x - px.x) * (p0.y - px.y) - (p2.y - px.y) * (p0.x - px.x)) * inv;
      let w2 = 1.0 - w0 - w1;
      if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) { continue; }
      let z = w0 * z0 + w1 * z1 + w2 * z2;
      let zq = u32(clamp(1.0 - z, 0.0, 1.0) * 8191.0);
      atomicMax(&fb[u32(y) * u32(W) + u32(x)], (zq << 19u) | idPack);
    }
  }
}`;

const RESOLVE_WGSL = /* wgsl */ `
struct VU { m: vec4f };   /* x 视图, y W, z 拓扑数 */
struct Meshlet { c: vec4f, cone: vec4f, off: vec4f };
@group(0) @binding(0) var<uniform> vu: VU;
@group(0) @binding(1) var<storage, read> fb: array<u32>;
@group(0) @binding(2) var<storage, read> ml: array<Meshlet>;
@group(0) @binding(3) var<storage, read> verts: array<vec4f>;
@group(0) @binding(4) var<storage, read> tris: array<u32>;
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
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let W = u32(vu.m.y);
  let v = fb[u32(fp.y) * W + u32(fp.x)];
  let id = v & 0x7ffffu;
  var c = vec3f(0.016, 0.02, 0.03);
  if (id != 0u) {
    let tri = (id - 1u) % 128u;
    let mid = (id - 1u) / 128u;
    let m2 = u32(vu.m.x);
    if (m2 == 1u) {
      c = hue(hash1(mid)) * 0.75 + 0.08;
    } else if (m2 == 2u) {
      c = hue(hash1(id)) * 0.75 + 0.08;
    } else if (m2 == 3u) {
      let zq = f32(v >> 19u) / 8191.0;
      c = vec3f(pow(zq, 2.2));
    } else {
      /* 着色：从 ID 反查三角形重建法线 */
      let topo = mid % ${'{TOPO}'}u;
      let base = (topo * 128u + tri) * 3u;
      let m = ml[mid];
      let p0 = verts[tris[base]].xyz;
      let p1 = verts[tris[base + 1u]].xyz;
      let p2 = verts[tris[base + 2u]].xyz;
      let n = normalize(cross(p1 - p0, p2 - p0));
      let L = normalize(vec3f(0.5, 0.8, 0.35));
      let dif = max(dot(n, L), 0.0) * 0.8 + max(dot(n, -L), 0.0) * 0.15 + 0.12;
      c = (hue(hash1(mid)) * 0.2 + vec3f(0.5, 0.53, 0.58)) * dif;
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

/* ---------- 几何：环面纽结 (p=2, q=3) ---------- */
function buildKnot(SEGU, SEGV, R1, R2) {
  const verts = [];
  for (let i = 0; i <= SEGU; i++) {
    const t = (i / SEGU) * Math.PI * 2;
    const p = 2, q = 3;
    const r = R1 * (2 + Math.cos(q * t)) * 0.5;
    const cx = r * Math.cos(p * t), cy = R1 * Math.sin(q * t) * 0.35, cz = r * Math.sin(p * t);
    /* frame */
    const t2 = t + 0.01;
    const r2 = R1 * (2 + Math.cos(q * t2)) * 0.5;
    const dx = r2 * Math.cos(p * t2) - cx, dy = R1 * Math.sin(q * t2) * 0.35 - cy, dz = r2 * Math.sin(p * t2) - cz;
    const tl = Math.hypot(dx, dy, dz);
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
  return new Float32Array(verts);
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

  /* ---------- 建网格与 meshlet ---------- */
  const SEGU = 256, SEGV = 64, PATCH = 8;
  const vertsArr = buildKnot(SEGU, SEGV, 0.9, 0.24);
  const vIdx = (i, j) => i * (SEGV + 1) + j;
  const MU = SEGU / PATCH, MV = SEGV / PATCH;   /* 32 × 8 拓扑 meshlet */
  const TOPO = MU * MV;
  const MTRI = PATCH * PATCH * 2;               /* 128 */
  const trisArr = new Uint32Array(TOPO * MTRI * 3).fill(0xffffffff);
  const mlData = [];
  const INST = [];
  for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) INST.push([gx * 3.4, 0, gz * 3.4]);
  const NML = TOPO * INST.length;

  for (let mu = 0; mu < MU; mu++)
    for (let mv = 0; mv < MV; mv++) {
      const topoId = mu * MV + mv;
      let t = 0;
      let cx = 0, cy = 0, cz = 0, n = 0;
      let anx = 0, any2 = 0, anz = 0;
      const norms = [];
      for (let i = 0; i < PATCH; i++)
        for (let j = 0; j < PATCH; j++) {
          const a = vIdx(mu * PATCH + i, mv * PATCH + j);
          const b = vIdx(mu * PATCH + i + 1, mv * PATCH + j);
          const c = vIdx(mu * PATCH + i, mv * PATCH + j + 1);
          const d = vIdx(mu * PATCH + i + 1, mv * PATCH + j + 1);
          trisArr.set([a, b, c], (topoId * MTRI + t) * 3); t++;
          trisArr.set([b, d, c], (topoId * MTRI + t) * 3); t++;
          [[a, b, c], [b, d, c]].forEach(([p, q, r2]) => {
            const e1 = [vertsArr[q * 4] - vertsArr[p * 4], vertsArr[q * 4 + 1] - vertsArr[p * 4 + 1], vertsArr[q * 4 + 2] - vertsArr[p * 4 + 2]];
            const e2 = [vertsArr[r2 * 4] - vertsArr[p * 4], vertsArr[r2 * 4 + 1] - vertsArr[p * 4 + 1], vertsArr[r2 * 4 + 2] - vertsArr[p * 4 + 2]];
            let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
            const nl = Math.hypot(nx, ny, nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            norms.push([nx, ny, nz]);
            anx += nx; any2 += ny; anz += nz;
          });
        }
      for (let i = 0; i <= PATCH; i++)
        for (let j = 0; j <= PATCH; j++) {
          const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j);
          cx += vertsArr[vi2 * 4]; cy += vertsArr[vi2 * 4 + 1]; cz += vertsArr[vi2 * 4 + 2];
          n++;
        }
      cx /= n; cy /= n; cz /= n;
      let rad = 0;
      for (let i = 0; i <= PATCH; i++)
        for (let j = 0; j <= PATCH; j++) {
          const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j);
          rad = Math.max(rad, Math.hypot(vertsArr[vi2 * 4] - cx, vertsArr[vi2 * 4 + 1] - cy, vertsArr[vi2 * 4 + 2] - cz));
        }
      const al = Math.hypot(anx, any2, anz) || 1;
      const ax = anx / al, ay = any2 / al, az = anz / al;
      let mindp = 1;
      norms.forEach(([nx, ny, nz]) => { mindp = Math.min(mindp, nx * ax + ny * ay + nz * az); });
      const cutoff = mindp <= 0.1 ? 1 : Math.sqrt(1 - mindp * mindp);
      mlData.push({ c: [cx, cy, cz, rad], cone: [ax, ay, az, cutoff] });
    }

  const mlArr = new Float32Array(NML * 12);
  for (let inst = 0; inst < INST.length; inst++)
    for (let t = 0; t < TOPO; t++) {
      const i = inst * TOPO + t;
      const m = mlData[t];
      mlArr.set(m.c, i * 12);
      mlArr.set(m.cone, i * 12 + 4);
      mlArr.set([...INST[inst], 0], i * 12 + 8);
    }

  const mkS = (arr, extra) => {
    const b = device.createBuffer({ size: arr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | (extra || 0) });
    device.queue.writeBuffer(b, 0, arr);
    return b;
  };
  const vertBuf = mkS(vertsArr);
  const triBuf = mkS(trisArr);
  const mlBuf = mkS(mlArr);
  const visBuf = device.createBuffer({ size: NML * 4, usage: GPUBufferUsage.STORAGE });
  const fbBuf = device.createBuffer({ size: PW * PH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cntBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const argsBuf = device.createBuffer({ size: 12, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  const cuBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const vuBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frusBuf = device.createBuffer({ size: 24 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const sub = (code) => code.replaceAll('{TOPO}', String(TOPO));
  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const cullP = mkCP(CULL_WGSL);
  const rastP = mkCP(sub(RASTER_WGSL));
  const resMod = device.createShaderModule({ code: sub(RESOLVE_WGSL) });
  const resP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: resMod, entryPoint: 'vs' },
    fragment: { module: resMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const lineMod = device.createShaderModule({ code: LINE_WGSL });
  const lineP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: lineMod, entryPoint: 'vs' },
    fragment: { module: lineMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'line-list' },
  });
  if (wgslEl) wgslEl.textContent = '// ---- 剔除 ----' + CULL_WGSL + '\n\n// ---- 软件光栅 ----' + sub(RASTER_WGSL);

  const bg = (pipe, entries) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: entries.map((r, i) => ({ binding: i, resource: { buffer: r } })),
  });
  const cullBG = bg(cullP, [cuBuf, mlBuf, visBuf, cntBuf, argsBuf]);
  const rastBG = bg(rastP, [ruBuf, mlBuf, vertBuf, triBuf, visBuf, fbBuf, cntBuf]);
  const resBG = bg(resP, [vuBuf, fbBuf, mlBuf, vertBuf, triBuf]);
  const lineBG = bg(lineP, [ruBuf, frusBuf]);

  /* 计时 + 统计回读 */
  let qs = null, qBuf = null, readPool = [], cullMs = 0, rastMs = 0;
  if (canTime) {
    qs = device.createQuerySet({ type: 'timestamp', count: 4 });
    qBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) {
      readPool.push({
        buf: device.createBuffer({ size: 32, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        busy: false,
      });
    }
  }
  const statRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let statBusy = false, stats = [0, 0, 0, 0];

  /* 交互 */
  const $ = (id) => document.getElementById(id);
  const ui = { view: $('me-view'), freeze: $('me-freeze') };
  let yaw = 0.6, pitch = 0.35, radius = 6.5;
  let dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - py0) * 0.004));
    px0 = e.clientX; py0 = e.clientY;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(2.5, Math.min(16, radius + e.deltaY * 0.006));
  }, { passive: false });
  let frozen = null;
  if (ui.freeze) ui.freeze.addEventListener('change', () => { frozen = null; });

  const proj = mat4.perspective(0.8, PW / PH, 0.1, 60);
  const cuArr = new Float32Array(28);
  const ruArr = new Float32Array(20);
  const vuArr = new Float32Array(4);
  let prev = 0, fps = 60;

  function planesOf(vp) {
    /* Gribb-Hartmann：从列主序 VP 提取 6 平面（行组合） */
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

    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const vp = mat4.multiply(proj, view);

    const freezeOn = ui.freeze && ui.freeze.checked;
    if (freezeOn && !frozen) {
      frozen = { vp: vp.slice(), eye: eye.slice() };
      device.queue.writeBuffer(frusBuf, 0, frustumCorners(mat4.inverse(vp)));
    }
    if (!freezeOn) frozen = null;
    const cullVp = frozen ? frozen.vp : vp;
    const cullEye = frozen ? frozen.eye : eye;
    const pl = planesOf(cullVp);
    for (let p = 0; p < 6; p++) cuArr.set(pl[p], p * 4);
    cuArr[24] = cullEye[0]; cuArr[25] = cullEye[1]; cuArr[26] = cullEye[2]; cuArr[27] = 0;
    device.queue.writeBuffer(cuBuf, 0, cuArr);
    ruArr.set(vp, 0);
    ruArr[16] = PW; ruArr[17] = PH; ruArr[18] = 0; ruArr[19] = 0;
    device.queue.writeBuffer(ruBuf, 0, ruArr);
    vuArr[0] = parseInt((ui.view && ui.view.value) || '0', 10);
    vuArr[1] = PW;
    device.queue.writeBuffer(vuBuf, 0, vuArr);
    device.queue.writeBuffer(cntBuf, 0, new Uint32Array([0, 0, 0, 0]));
    device.queue.writeBuffer(argsBuf, 0, new Uint32Array([0, 1, 1]));

    const enc = device.createCommandEncoder();
    enc.clearBuffer(fbBuf);
    const cp1 = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    cp1.setPipeline(cullP);
    cp1.setBindGroup(0, cullBG);
    cp1.dispatchWorkgroups(Math.ceil(NML / 64));
    cp1.end();
    const cp2 = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 },
    } : {});
    cp2.setPipeline(rastP);
    cp2.setBindGroup(0, rastBG);
    cp2.dispatchWorkgroupsIndirect(argsBuf, 0);
    cp2.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    rp.setPipeline(resP);
    rp.setBindGroup(0, resBG);
    rp.draw(3);
    if (frozen) {
      rp.setPipeline(lineP);
      rp.setBindGroup(0, lineBG);
      rp.draw(24);
    }
    rp.end();

    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) {
        enc.resolveQuerySet(qs, 0, 4, qBuf, 0);
        enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 32);
      }
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
        slot.buf.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (doStat) {
      statBusy = true;
      statRead.mapAsync(GPUMapMode.READ).then(() => {
        stats = Array.from(new Uint32Array(statRead.getMappedRange()));
        statRead.unmap();
        statBusy = false;
      }).catch(() => { statBusy = false; });
    }
    if (hud) {
      hud.textContent = 'meshlet ' + stats[0] + '/' + NML + ' 可见 · 视锥剔 ' + stats[1] +
        ' · 锥剔 ' + stats[2] + ' · 光栅 ' + stats[3].toLocaleString() + ' 三角形 · ' +
        (canTime ? 'cull ' + cullMs.toFixed(2) + ' + raster ' + rastMs.toFixed(2) + ' ms · ' : '') +
        Math.round(fps) + ' fps' + (frozen ? ' · 剔除已冻结' : '');
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
