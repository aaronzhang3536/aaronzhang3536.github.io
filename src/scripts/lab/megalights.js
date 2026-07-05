/* MegaLights — 裸 WebGPU：数千盏动态带阴影光源的实时直接光照
   技术内核 = ReSTIR DI（时空蓄水池重要性重采样）+ 追踪阴影，正是 UE5.5
   MegaLights 的学术基础（Bitterli et al. 2020）。每像素每帧只做 M 个候选的
   RIS 选出 1 盏灯、追 1 条阴影线，靠时域（重投影历史）+ 空域（邻域蓄水池）
   复用把噪声压下去。对照「暴力」模式：每像素遍历所有灯各追一条阴影线——
   正确但帧率随灯数崩塌，而 ReSTIR 几乎恒定开销。
   这里是有偏（biased）时空 ReSTIR，阴影用解析 ray-box 追踪（非硬件 RT）。 */
import { mat4 } from 'wgpu-matrix';

/* ---------- 共享 WGSL：结构、随机、场景求交、光照 ---------- */
const COMMON = /* wgsl */ `
struct U {
  vp: mat4x4f,
  prevVP: mat4x4f,
  eye: vec4f,     // xyz, tanHalfFov
  right: vec4f,   // xyz, aspect
  up: vec4f,      // xyz, W
  fwd: vec4f,     // xyz, H
  p0: vec4f,      // numLights, M候选, frame, mode
  p1: vec4f,      // shadows, temporal, spatial, spatialRadius
  p2: vec4f,      // numBoxes, reset, view, time
};
struct Box { lo: vec4f, hi: vec4f };
struct Light { pa: vec4f, pb: vec4f };   // pa: pos.xyz+radius, pb: color.rgb+intensity

fn pcg(v: u32) -> u32 {
  var h = v * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn hue(h: f32) -> vec3f {
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
`;

/* 几何函数：只依赖 boxes / u（camRay、ray-box、主可见性、阴影线） */
const SCENE_GEO = /* wgsl */ `
fn camRay(px: f32, py: f32) -> vec3f {
  let W = u.up.w; let H = u.fwd.w;
  let ndc = vec2f((px + 0.5) / W * 2.0 - 1.0, 1.0 - (py + 0.5) / H * 2.0);
  return normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.eye.w * u.right.w + u.up.xyz * ndc.y * u.eye.w);
}
fn boxT(ro: vec3f, rd: vec3f, lo: vec3f, hi: vec3f) -> f32 {
  let inv = 1.0 / rd;
  let t0 = (lo - ro) * inv;
  let t1 = (hi - ro) * inv;
  let tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  if (tf < max(tn, 0.0)) { return -1.0; }
  return select(tn, tf, tn < 0.0);
}
fn boxNormal(p: vec3f, lo: vec3f, hi: vec3f) -> vec3f {
  let c = (lo + hi) * 0.5;
  let d = (hi - lo) * 0.5;
  let q = (p - c) / d;
  let a = abs(q);
  if (a.x > a.y && a.x > a.z) { return vec3f(sign(q.x), 0.0, 0.0); }
  if (a.y > a.z) { return vec3f(0.0, sign(q.y), 0.0); }
  return vec3f(0.0, 0.0, sign(q.z));
}
struct Hit { t: f32, p: vec3f, n: vec3f, alb: vec3f, hit: u32 };
fn sceneHit(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.t = 1e9; h.hit = 0u;
  if (rd.y < -1e-4) {
    let t = -ro.y / rd.y;
    if (t > 0.001 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 4.0 && abs(p.z) < 4.0) {
        h.t = t; h.p = p; h.n = vec3f(0.0, 1.0, 0.0); h.hit = 1u;
        let ck = (floor(p.x * 2.0) + floor(p.z * 2.0));
        h.alb = select(vec3f(0.24), vec3f(0.32), (i32(ck) & 1) == 0);
      }
    }
  }
  let nb = u32(u.p2.x);
  for (var i = 0u; i < nb; i++) {
    let b = boxes[i];
    let t = boxT(ro, rd, b.lo.xyz, b.hi.xyz);
    if (t > 0.001 && t < h.t) {
      h.t = t; h.p = ro + rd * t; h.n = boxNormal(h.p, b.lo.xyz, b.hi.xyz);
      h.alb = b.lo.w * hue(b.hi.w) * 0.4 + 0.42; h.hit = 1u;
    }
  }
  return h;
}
fn traceShadow(p: vec3f, lp: vec3f) -> f32 {
  let d = lp - p;
  let dist = length(d);
  let rd = d / dist;
  let ro = p + rd * 0.004;
  let nb = u32(u.p2.x);
  for (var i = 0u; i < nb; i++) {
    let b = boxes[i];
    let t = boxT(ro, rd, b.lo.xyz, b.hi.xyz);
    if (t > 0.001 && t < dist - 0.01) { return 0.0; }
  }
  return 1.0;
}
`;
/* 光照函数：只依赖 lights（单盏灯贡献、目标函数） */
const LIGHT_FN = /* wgsl */ `
fn shadeRGB(p: vec3f, n: vec3f, li: u32) -> vec3f {
  let L = lights[li];
  let d = L.pa.xyz - p;
  let dist2 = dot(d, d);
  let wi = d / sqrt(dist2);
  let ndl = max(dot(n, wi), 0.0);
  let atten = 1.0 / (1.0 + dist2 * 4.0);
  return L.pb.rgb * L.pb.w * ndl * atten;
}
fn targetLum(p: vec3f, n: vec3f, li: u32) -> f32 { return lum(shadeRGB(p, n, li)); }
`;

/* ---------- 光源动画 ---------- */
const ANIM_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> lights: array<Light>;
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let n = u32(u.p0.x);
  if (id.x >= n) { return; }
  let i = id.x;
  let r1 = f32(pcg(i * 3u + 0u)) / 4294967296.0;
  let r2 = f32(pcg(i * 3u + 1u)) / 4294967296.0;
  let r3 = f32(pcg(i * 3u + 2u)) / 4294967296.0;
  let t = u.p2.w;
  let bx = (r1 - 0.5) * 7.0;
  let bz = (r2 - 0.5) * 7.0;
  let by = 0.35 + r3 * 1.5;
  let ph = r3 * 6.2831853;
  let pos = vec3f(
    bx + sin(t * 0.5 + ph) * 0.5,
    by + sin(t * 0.7 + ph * 1.7) * 0.25,
    bz + cos(t * 0.6 + ph) * 0.5);
  lights[i].pa = vec4f(pos, 0.02);
  lights[i].pb = vec4f(hue(fract(r1 * 0.7 + r2 * 0.5 + 0.05)) * 0.6 + 0.25, 2.2);
}`;

/* ---------- G-buffer ---------- */
const GBUF_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> boxes: array<Box>;
@group(0) @binding(2) var<storage, read_write> gA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> gB: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> gC: array<vec4f>;
` + SCENE_GEO + /* wgsl */ `
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  if (id.x >= W || id.y >= H) { return; }
  let idx = id.y * W + id.x;
  let rd = camRay(f32(id.x), f32(id.y));
  let h = sceneHit(u.eye.xyz, rd);
  gA[idx] = vec4f(h.p, f32(h.hit));
  gB[idx] = vec4f(h.n, 0.0);
  gC[idx] = vec4f(h.alb, 0.0);
}`;

/* ---------- ReSTIR：初始 RIS + 时域复用 ---------- */
const INIT_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read> gA: array<vec4f>;
@group(0) @binding(3) var<storage, read> gB: array<vec4f>;
@group(0) @binding(4) var<storage, read> gAprev: array<vec4f>;
@group(0) @binding(5) var<storage, read> resPrev: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> resOut: array<vec4f>;
` + LIGHT_FN + /* wgsl */ `
var<private> rng: u32;
fn rnd() -> f32 { rng = pcg(rng); return f32(rng) / 4294967296.0; }

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  if (id.x >= W || id.y >= H) { return; }
  let idx = id.y * W + id.x;
  let ga = gA[idx];
  if (ga.w < 0.5) { resOut[idx] = vec4f(0.0); return; }
  let P = ga.xyz;
  let N = gB[idx].xyz;
  rng = pcg(idx * 2654435761u + u32(u.p0.z) * 40503u + 1u);

  let nL = u32(u.p0.x);
  let M = u32(u.p0.y);
  // 蓄水池：y, wsum, Mcount, pHat
  var y: u32 = 0u;
  var wsum = 0.0;
  var Mc = 0.0;
  var pHat = 0.0;
  for (var k = 0u; k < M; k++) {
    let li = min(u32(rnd() * f32(nL)), nL - 1u);
    let ph = targetLum(P, N, li);
    let w = ph * f32(nL);   // ph / (1/nL)
    wsum += w;
    Mc += 1.0;
    if (rnd() * wsum < w) { y = li; pHat = ph; }
  }

  // 时域复用：重投影到上一帧
  if (u.p1.y > 0.5 && u.p2.y < 0.5) {
    let clip = u.prevVP * vec4f(P, 1.0);
    if (clip.w > 0.0) {
      let ndc = clip.xy / clip.w;
      let pp = vec2f((ndc.x * 0.5 + 0.5) * u.up.w, (0.5 - ndc.y * 0.5) * u.fwd.w);
      if (all(pp >= vec2f(0.0)) && pp.x < u.up.w && pp.y < u.fwd.w) {
        let pidx = u32(pp.y) * W + u32(pp.x);
        let gp = gAprev[pidx];
        if (gp.w > 0.5 && distance(gp.xyz, P) < 0.06) {
          let pr = resPrev[pidx];
          let py = bitcast<u32>(pr.x);
          let pW = pr.y;
          var pM = pr.z;
          pM = min(pM, 20.0 * Mc);           // 限制时域偏差
          if (py < nL && pW > 0.0 && pM > 0.0) {
            let ph2 = targetLum(P, N, py);
            let w = ph2 * pW * pM;
            wsum += w;
            Mc += pM;
            if (rnd() * wsum < w) { y = py; pHat = ph2; }
          }
        }
      }
    }
  }

  var Wout = 0.0;
  if (pHat > 1e-6 && Mc > 0.0) { Wout = wsum / (Mc * pHat); }
  resOut[idx] = vec4f(bitcast<f32>(y), Wout, Mc, pHat);
}`;

/* ---------- ReSTIR：空域复用 ---------- */
const SPATIAL_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read> gA: array<vec4f>;
@group(0) @binding(3) var<storage, read> gB: array<vec4f>;
@group(0) @binding(4) var<storage, read> resIn: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> resOut: array<vec4f>;
` + LIGHT_FN + /* wgsl */ `
var<private> rng: u32;
fn rnd() -> f32 { rng = pcg(rng); return f32(rng) / 4294967296.0; }

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  if (id.x >= W || id.y >= H) { return; }
  let idx = id.y * W + id.x;
  let ga = gA[idx];
  let mine = resIn[idx];
  if (ga.w < 0.5) { resOut[idx] = mine; return; }
  if (u.p1.z < 0.5) { resOut[idx] = mine; return; }   // 空域关

  let P = ga.xyz;
  let N = gB[idx].xyz;
  let nL = u32(u.p0.x);
  rng = pcg(idx * 2246822519u + u32(u.p0.z) * 32452867u + 7u);

  // 以自身为流的第一个蓄水池
  var y = bitcast<u32>(mine.x);
  var pHat = targetLum(P, N, y);
  var wsum = pHat * mine.y * mine.z;
  var Mc = mine.z;

  let R = u.p1.w;
  for (var k = 0u; k < 4u; k++) {
    let ang = rnd() * 6.2831853;
    let rr = sqrt(rnd()) * R;
    let sx = i32(f32(id.x) + cos(ang) * rr);
    let sy = i32(f32(id.y) + sin(ang) * rr);
    if (sx < 0 || sy < 0 || sx >= i32(W) || sy >= i32(H)) { continue; }
    let sidx = u32(sy) * W + u32(sx);
    let sga = gA[sidx];
    if (sga.w < 0.5) { continue; }
    if (distance(sga.xyz, P) > 0.4) { continue; }          // 几何近邻
    if (dot(gB[sidx].xyz, N) < 0.7) { continue; }          // 法线相近
    let nr = resIn[sidx];
    let ny = bitcast<u32>(nr.x);
    if (ny >= nL || nr.y <= 0.0 || nr.z <= 0.0) { continue; }
    let ph = targetLum(P, N, ny);                          // 在「我」的点上重估
    let w = ph * nr.y * nr.z;
    wsum += w;
    Mc += nr.z;
    if (rnd() * wsum < w) { y = ny; pHat = ph; }
  }

  var Wout = 0.0;
  if (pHat > 1e-6 && Mc > 0.0) { Wout = wsum / (Mc * pHat); }
  resOut[idx] = vec4f(bitcast<f32>(y), Wout, Mc, pHat);
}`;

/* ---------- 着色 / 参考 / 视图（全屏片元） ---------- */
const SHADE_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> boxes: array<Box>;
@group(0) @binding(2) var<storage, read> lights: array<Light>;
@group(0) @binding(3) var<storage, read> gA: array<vec4f>;
@group(0) @binding(4) var<storage, read> gB: array<vec4f>;
@group(0) @binding(5) var<storage, read> gC: array<vec4f>;
@group(0) @binding(6) var<storage, read> res: array<vec4f>;
@group(0) @binding(7) var<storage, read> gAprev: array<vec4f>;
@group(0) @binding(8) var<storage, read> colPrev: array<vec4f>;
@group(0) @binding(9) var<storage, read_write> colCur: array<vec4f>;
` + SCENE_GEO + LIGHT_FN + /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  let idx = u32(fp.y) * W + u32(fp.x);
  let ga = gA[idx];
  let mode = u32(u.p0.w);
  let view = u32(u.p2.z);
  let doShadow = u.p1.x > 0.5;

  if (ga.w < 0.5) {
    colCur[idx] = vec4f(0.0);
    let rd = camRay(fp.x, fp.y);
    var sky = mix(vec3f(0.02, 0.025, 0.04), vec3f(0.05, 0.06, 0.09), clamp(rd.y + 0.3, 0.0, 1.0));
    return vec4f(pow(aces(sky), vec3f(1.0 / 2.2)), 1.0);
  }
  let P = ga.xyz;
  let N = gB[idx].xyz;
  let alb = gC[idx].xyz;

  var col = vec3f(0.0);
  var selId = 0u;
  if (mode == 0u) {
    let nL = u32(u.p0.x);
    for (var i = 0u; i < nL; i++) {
      var v = 1.0;
      if (doShadow) { v = traceShadow(P, lights[i].pa.xyz); }
      col += shadeRGB(P, N, i) * v;
    }
    col *= alb;
  } else {
    let r = res[idx];
    selId = bitcast<u32>(r.x);
    let Wt = r.y;
    var v = 1.0;
    if (doShadow) { v = traceShadow(P, lights[selId].pa.xyz); }
    col = alb * shadeRGB(P, N, selId) * Wt * v;
  }

  // 时域降噪：模式 >=2 时对最终辐射做重投影指数滑动平均（MegaLights 同样带降噪器）
  if (mode >= 2u && view == 0u && u.p2.y < 0.5) {
    let clip = u.prevVP * vec4f(P, 1.0);
    if (clip.w > 0.0) {
      let ndc = clip.xy / clip.w;
      let pp = vec2f((ndc.x * 0.5 + 0.5) * f32(W), (0.5 - ndc.y * 0.5) * f32(H));
      if (all(pp >= vec2f(0.0)) && pp.x < f32(W) && pp.y < f32(H)) {
        let pidx = u32(pp.y) * W + u32(pp.x);
        let gp = gAprev[pidx];
        if (gp.w > 0.5 && distance(gp.xyz, P) < 0.06) {
          col = mix(colPrev[pidx].rgb, col, 0.1);
        }
      }
    }
  }
  colCur[idx] = vec4f(col, 1.0);

  if (view == 1u) {
    if (mode == 0u) { return vec4f(pow(aces(col), vec3f(1.0/2.2)), 1.0); }
    return vec4f(hue(fract(f32(selId) * 0.61803)) * 0.9, 1.0);
  } else if (view == 2u) {
    let li = select(selId, 0u, mode == 0u);
    let v = traceShadow(P, lights[li].pa.xyz);
    return vec4f(vec3f(v * 0.5 + 0.1), 1.0);
  } else if (view == 3u) {
    return vec4f(N * 0.5 + 0.5, 1.0);
  }
  return vec4f(pow(aces(col), vec3f(1.0 / 2.2)), 1.0);
}`;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) wgslEl.textContent = '// ==== 光照 / 目标函数 ====\n' + LIGHT_FN + '\n// ==== 初始 RIS + 时域复用 ====' + INIT_WGSL.split(LIGHT_FN)[1] + '\n\n// ==== 空域复用 ====' + SPATIAL_WGSL.split(LIGHT_FN)[1];
  function fail(msg) {
    if (hud) hud.textContent = '';
    if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; }
    cvs.style.display = 'none';
  }
  if (!navigator.gpu) { fail('当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge / Firefox 打开这个实验。'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('WebGPU adapter 请求失败。'); return; }
  const canTime = adapter.features.has('timestamp-query');
  const maxSB = adapter.limits.maxStorageBuffersPerShaderStage;
  if (maxSB < 10) { fail('此设备每着色阶段的 storage buffer 上限为 ' + maxSB + '，不足以运行本实验（需要 10）。'); return; }
  const device = await adapter.requestDevice({
    requiredFeatures: canTime ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(16, maxSB) },
  });

  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, Hc = Math.round(wrapW * 9 / 16);
  const scale = 1.0;
  const IW = Math.round(W * scale), IH = Math.round(Hc * scale);
  cvs.width = IW; cvs.height = IH;
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const NP = IW * IH;

  /* 场景：地面 + 一片高低不一的柱子 */
  const boxes = [];
  const GN = 5;
  for (let i = 0; i < GN; i++)
    for (let j = 0; j < GN; j++) {
      if (i === 2 && j === 2) continue;
      const cx = (i - (GN - 1) / 2) * 1.4 + (Math.random() - 0.5) * 0.2;
      const cz = (j - (GN - 1) / 2) * 1.4 + (Math.random() - 0.5) * 0.2;
      const hw = 0.28 + Math.random() * 0.12;
      const hgt = 0.4 + Math.random() * 1.3;
      boxes.push([cx - hw, 0, cz - hw, 0.9, cx + hw, hgt, cz + hw, Math.random()]);
    }
  const NB = boxes.length;
  const boxArr = new Float32Array(NB * 8);
  boxes.forEach((b, i) => boxArr.set(b, i * 8));

  const uBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const boxBuf = device.createBuffer({ size: boxArr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(boxBuf, 0, boxArr);

  const MAXL = 4096;
  const lightBuf = device.createBuffer({ size: MAXL * 32, usage: GPUBufferUsage.STORAGE });
  const mkStore = () => device.createBuffer({ size: NP * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const gA = [mkStore(), mkStore()];
  const gB = mkStore(), gC = mkStore();
  const resTemp = mkStore(), resFinal = mkStore(), resPrev = mkStore();
  const color = [mkStore(), mkStore()];

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const animP = mkCP(ANIM_WGSL);
  const gbufP = mkCP(GBUF_WGSL);
  const initP = mkCP(INIT_WGSL);
  const spatP = mkCP(SPATIAL_WGSL);
  const shadeMod = device.createShaderModule({ code: SHADE_WGSL });
  const shadeP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shadeMod, entryPoint: 'vs' },
    fragment: { module: shadeMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const bg = (pipe, arr) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: arr.map((r, i) => ({ binding: i, resource: { buffer: r } })),
  });
  const animBG = bg(animP, [uBuf, lightBuf]);
  const gbufBG = [
    bg(gbufP, [uBuf, boxBuf, gA[0], gB, gC]),
    bg(gbufP, [uBuf, boxBuf, gA[1], gB, gC]),
  ];
  /* init 读 gA[cur], gAprev=gA[1-cur], resPrev → resTemp */
  const initBG = [
    bg(initP, [uBuf, lightBuf, gA[0], gB, gA[1], resPrev, resTemp]),
    bg(initP, [uBuf, lightBuf, gA[1], gB, gA[0], resPrev, resTemp]),
  ];
  const spatBG = [
    bg(spatP, [uBuf, lightBuf, gA[0], gB, resTemp, resFinal]),
    bg(spatP, [uBuf, lightBuf, gA[1], gB, resTemp, resFinal]),
  ];
  const shadeBG = [
    bg(shadeP, [uBuf, boxBuf, lightBuf, gA[0], gB, gC, resFinal, gA[1], color[1], color[0]]),
    bg(shadeP, [uBuf, boxBuf, lightBuf, gA[1], gB, gC, resFinal, gA[0], color[0], color[1]]),
  ];

  /* GPU 计时 */
  let qs = null, qBuf = null, readPool = [], gpuMs = 0;
  if (canTime) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 });
    qBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) readPool.push({
      buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false,
    });
  }

  const $ = (id) => document.getElementById(id);
  const ui = {
    mode: $('ml-mode'), lights: $('ml-lights'), cand: $('ml-cand'),
    shadow: $('ml-shadow'), view: $('ml-view'), spatR: $('ml-spatr'),
  };
  /* URL 参数覆盖（便于对比同一视角下的各模式） */
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('mode') && ui.mode) ui.mode.value = q.get('mode');
    if (q.has('lights') && ui.lights) ui.lights.value = q.get('lights');
    if (q.has('view') && ui.view) ui.view.value = q.get('view');
  } catch (e) {}
  let yaw = 0.7, pitch = 0.62, radius = 8.5;
  let dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.005;
    pitch = Math.max(0.15, Math.min(1.3, pitch + (e.clientY - py0) * 0.004));
    px0 = e.clientX; py0 = e.clientY;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => { e.preventDefault(); radius = Math.max(4, Math.min(16, radius + e.deltaY * 0.006)); }, { passive: false });

  const proj = mat4.perspective(0.85, IW / IH, 0.1, 60);
  const uArr = new Float32Array(64);
  let prevVP = mat4.identity();
  let cur = 0, frame = 0, prev = 0, fps = 60, resetT = 2;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.05) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;
    const t = ts / 1000;

    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const view = mat4.lookAt(eye, [0, 0.3, 0], [0, 1, 0]);
    const vp = mat4.multiply(proj, view);
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = nrm([-eye[0], 0.3 - eye[1], -eye[2]]);
    const right = nrm(crs(fwd, [0, 1, 0]));
    const up = crs(right, fwd);

    const nL = parseInt((ui.lights && ui.lights.value) || '1024', 10);
    const M = parseInt((ui.cand && ui.cand.value) || '16', 10);
    const mode = parseInt((ui.mode && ui.mode.value) || '3', 10);
    const shadows = (!ui.shadow || ui.shadow.checked) ? 1 : 0;
    const spatOn = mode >= 3 ? 1 : 0;
    const tempOn = mode >= 2 ? 1 : 0;
    const spatR = parseFloat((ui.spatr && ui.spatr.value) || '20');
    const viewMode = parseInt((ui.view && ui.view.value) || '0', 10);

    uArr.set(vp, 0);
    uArr.set(prevVP, 16);
    uArr[32] = eye[0]; uArr[33] = eye[1]; uArr[34] = eye[2]; uArr[35] = Math.tan(0.425);
    uArr[36] = right[0]; uArr[37] = right[1]; uArr[38] = right[2]; uArr[39] = IW / IH;
    uArr[40] = up[0]; uArr[41] = up[1]; uArr[42] = up[2]; uArr[43] = IW;
    uArr[44] = fwd[0]; uArr[45] = fwd[1]; uArr[46] = fwd[2]; uArr[47] = IH;
    uArr[48] = nL; uArr[49] = M; uArr[50] = frame; uArr[51] = mode;
    uArr[52] = shadows; uArr[53] = tempOn; uArr[54] = spatOn; uArr[55] = spatR;
    uArr[56] = NB; uArr[57] = resetT > 0 ? 1 : 0; uArr[58] = viewMode; uArr[59] = t;
    device.queue.writeBuffer(uBuf, 0, uArr);

    const gx = Math.ceil(IW / 8), gy = Math.ceil(IH / 8);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    cp.setPipeline(animP); cp.setBindGroup(0, animBG); cp.dispatchWorkgroups(Math.ceil(nL / 64));
    cp.setPipeline(gbufP); cp.setBindGroup(0, gbufBG[cur]); cp.dispatchWorkgroups(gx, gy);
    if (mode >= 1) {
      cp.setPipeline(initP); cp.setBindGroup(0, initBG[cur]); cp.dispatchWorkgroups(gx, gy);
      cp.setPipeline(spatP); cp.setBindGroup(0, spatBG[cur]); cp.dispatchWorkgroups(gx, gy);
    }
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
    });
    rp.setPipeline(shadeP); rp.setBindGroup(0, shadeBG[cur]); rp.draw(3);
    rp.end();

    if (mode >= 1) enc.copyBufferToBuffer(resFinal, 0, resPrev, 0, NP * 16);
    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) { enc.resolveQuerySet(qs, 0, 2, qBuf, 0); enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 16); }
    }
    device.queue.submit([enc.finish()]);
    if (slot) {
      slot.busy = true;
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigInt64Array(slot.buf.getMappedRange());
        gpuMs += (Number(q[1] - q[0]) / 1e6 - gpuMs) * 0.1;
        slot.buf.unmap(); slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }

    prevVP = vp.slice();
    cur = 1 - cur;
    frame++;
    if (resetT > 0) resetT--;
    if (dragging) resetT = 1;

    if (hud) {
      const modeName = ['参考·暴力', '单样本 RIS', '+时域复用', '完整 ReSTIR'][mode];
      const rays = mode === 0 ? nL : 1;
      hud.textContent = nL.toLocaleString() + ' 盏灯 · ' + modeName + ' · ' +
        (shadows ? rays + ' 阴影线/像素' : '无阴影') + ' · ' +
        (canTime ? gpuMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
