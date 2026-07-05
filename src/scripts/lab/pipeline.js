/* 现代渲染管线 = Nanite × MegaLights — 裸 WebGPU
   把实验室最硬的两块拼成一张完整的现代渲染图，正是 UE5 的组合方式：
   ① Nanite：实例化 + LOD 的 meshlet 场景，GPU 剔除 + 软件光栅 → 可见性缓冲
   ② G-buffer 提取：从可见性缓冲解码，射线-平面求交重建每像素精确 P/N/albedo
   ③ MegaLights：ReSTIR 时空蓄水池重采样，用上千盏动态灯照亮 Nanite 几何，
      阴影用屏幕空间步进（沿阴影线在位置缓冲里查遮挡）
   —— 几何阶段产出可见性/G-buffer，着色阶段做多光源直接光照，天然串联。 */
import { mat4 } from 'wgpu-matrix';

const MTRI = 128;
const MAXVIS = 16384;

/* ================= 共享 ================= */
const COMMON = /* wgsl */ `
struct U {
  vp: mat4x4f,
  prevVP: mat4x4f,
  eye: vec4f,     // xyz, tanHalfFov
  right: vec4f,   // xyz, aspect
  up: vec4f,      // xyz, W
  fwd: vec4f,     // xyz, H
  p0: vec4f,      // numLights, M, frame, view
  p1: vec4f,      // shadows, temporal, spatial, spatialRadius
  p2: vec4f,      // reset, time, _, _
  lodS: vec4f,    // 各 LOD meshlet 起始
};
struct Light { pa: vec4f, pb: vec4f };   // pos+radius, color+intensity
fn pcg(v: u32) -> u32 {
  var h = v * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn hue(h: f32) -> vec3f {
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
fn hash1(n: u32) -> f32 {
  var h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 1048576.0 % 1.0;
}
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn camRay(px: f32, py: f32) -> vec3f {
  let ndc = vec2f((px + 0.5) / u.up.w * 2.0 - 1.0, 1.0 - (py + 0.5) / u.fwd.w * 2.0);
  return normalize(u.fwd.xyz + u.right.xyz * ndc.x * u.eye.w * u.right.w + u.up.xyz * ndc.y * u.eye.w);
}
`;
const LIGHT_FN = /* wgsl */ `
fn shadeRGB(p: vec3f, n: vec3f, li: u32) -> vec3f {
  let L = lights[li];
  let d = L.pa.xyz - p;
  let dist2 = dot(d, d);
  let wi = d / sqrt(dist2);
  let ndl = max(dot(n, wi), 0.0);
  let atten = 1.0 / (1.0 + dist2 * 0.6);
  return L.pb.rgb * L.pb.w * ndl * atten;
}
fn targetLum(p: vec3f, n: vec3f, li: u32) -> f32 { return lum(shadeRGB(p, n, li)); }
`;

/* ================= Nanite：剔除 + 软件光栅（沿用 meshlet 实验） ================= */
const CULL_WGSL = /* wgsl */ `
struct CU {
  planes: array<vec4f, 6>,
  eye: vec4f, lodS: vec4f, lodC: vec4f, lodD: vec4f, misc: vec4f,
};
struct Meshlet { c: vec4f, cone: vec4f };
struct Inst { pr: vec4f };
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var<storage, read> ml: array<Meshlet>;
@group(0) @binding(2) var<storage, read> inst: array<Inst>;
@group(0) @binding(3) var<storage, read_write> vis: array<u32>;
@group(0) @binding(4) var<storage, read_write> cnt: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> args: array<atomic<u32>>;
fn rotY(p: vec3f, a: f32) -> vec3f { let s = sin(a); let c = cos(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn pickLOD(d: f32) -> u32 { if (d < cu.lodD.x) { return 0u; } if (d < cu.lodD.y) { return 1u; } if (d < cu.lodD.z) { return 2u; } return 3u; }
fn lodStart(l: u32) -> u32 { if (l == 0u) { return u32(cu.lodS.x); } if (l == 1u) { return u32(cu.lodS.y); } if (l == 2u) { return u32(cu.lodS.z); } return u32(cu.lodS.w); }
fn lodCount(l: u32) -> u32 { if (l == 0u) { return u32(cu.lodC.x); } if (l == 1u) { return u32(cu.lodC.y); } if (l == 2u) { return u32(cu.lodC.z); } return u32(cu.lodC.w); }
@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let maxLocal = u32(cu.lodD.w);
  let ni = u32(cu.eye.w);
  let instI = id.x / maxLocal;
  let local = id.x % maxLocal;
  if (instI >= ni) { return; }
  let it = inst[instI];
  let d = length(it.pr.xyz - cu.eye.xyz);
  let lod = pickLOD(d);
  if (local >= lodCount(lod)) { return; }
  let gmi = lodStart(lod) + local;
  let m = ml[gmi];
  let c = rotY(m.c.xyz, it.pr.w) + it.pr.xyz;
  let r = m.c.w;
  for (var p = 0u; p < 6u; p++) { if (dot(cu.planes[p].xyz, c) + cu.planes[p].w < -r) { atomicAdd(&cnt[1], 1u); return; } }
  if (m.cone.w < 0.99) {
    let ax = rotY(m.cone.xyz, it.pr.w);
    let dv = c - cu.eye.xyz;
    if (dot(dv, ax) >= m.cone.w * length(dv) + r) { atomicAdd(&cnt[2], 1u); return; }
  }
  let slot = atomicAdd(&cnt[0], 1u);
  if (slot < u32(cu.misc.x)) { vis[slot] = (gmi & 0xfffu) | (instI << 12u); atomicMax(&args[0], slot + 1u); }
}`;

const RASTER_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, size: vec4f };
struct Inst { pr: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> verts: array<vec4f>;
@group(0) @binding(2) var<storage, read> tris: array<u32>;
@group(0) @binding(3) var<storage, read> vis: array<u32>;
@group(0) @binding(4) var<storage, read> inst: array<Inst>;
@group(0) @binding(5) var<storage, read_write> fb: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> cnt: array<atomic<u32>>;
const MTRI = 128u;
fn rotY(p: vec3f, a: f32) -> vec3f { let s = sin(a); let c = cos(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
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
  let c0 = ru.vp * vec4f(v0, 1.0); let c1 = ru.vp * vec4f(v1, 1.0); let c2 = ru.vp * vec4f(v2, 1.0);
  if (c0.w < 0.02 || c1.w < 0.02 || c2.w < 0.02) { return; }
  let p0 = vec2f((c0.x / c0.w * 0.5 + 0.5) * W, (0.5 - c0.y / c0.w * 0.5) * H);
  let p1 = vec2f((c1.x / c1.w * 0.5 + 0.5) * W, (0.5 - c1.y / c1.w * 0.5) * H);
  let p2 = vec2f((c2.x / c2.w * 0.5 + 0.5) * W, (0.5 - c2.y / c2.w * 0.5) * H);
  let area = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
  if (area >= 0.0) { return; }
  let lo = vec2i(max(floor(min(min(p0, p1), p2)), vec2f(0.0)));
  let hi = vec2i(min(ceil(max(max(p0, p1), p2)), vec2f(W - 1.0, H - 1.0)));
  let bw = hi.x - lo.x + 1; let bh = hi.y - lo.y + 1;
  if (bw <= 0 || bh <= 0 || bw * bh > 4000) { return; }
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

/* ================= G-buffer 提取（可见性缓冲 → P/N/albedo/LOD） ================= */
const EXTRACT_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> verts: array<vec4f>;
@group(0) @binding(2) var<storage, read> tris: array<u32>;
@group(0) @binding(3) var<storage, read> vis: array<u32>;
@group(0) @binding(4) var<storage, read> inst: array<vec4f>;
@group(0) @binding(5) var<storage, read> fb: array<u32>;
@group(0) @binding(6) var<storage, read_write> gA: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> gB: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> gC: array<vec4f>;
fn rotY(p: vec3f, a: f32) -> vec3f { let s = sin(a); let c = cos(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn lodOf(gmi: u32) -> u32 {
  if (gmi >= u32(u.lodS.w)) { return 3u; }
  if (gmi >= u32(u.lodS.z)) { return 2u; }
  if (gmi >= u32(u.lodS.y)) { return 1u; }
  return 0u;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  if (id.x >= W || id.y >= H) { return; }
  let idx = id.y * W + id.x;
  let v = fb[idx];
  let pid = v & 0x1fffffu;
  if (pid == 0u) { gA[idx] = vec4f(0.0); gB[idx] = vec4f(0.0, 1.0, 0.0, 0.0); gC[idx] = vec4f(0.0); return; }
  let slot = (pid - 1u) / 128u;
  let tri = (pid - 1u) % 128u;
  let pack = vis[slot];
  let gmi = pack & 0xfffu;
  let instI = pack >> 12u;
  let it = inst[instI];
  let base = (gmi * 128u + tri) * 3u;
  let a0 = rotY(verts[tris[base]].xyz, it.w) + it.xyz;
  let a1 = rotY(verts[tris[base + 1u]].xyz, it.w) + it.xyz;
  let a2 = rotY(verts[tris[base + 2u]].xyz, it.w) + it.xyz;
  var n = normalize(cross(a1 - a0, a2 - a0));
  let dir = camRay(f32(id.x), f32(id.y));
  if (dot(dir, n) > 0.0) { n = -n; }
  /* 射线-平面：eye + dir*t 落在三角形所在平面 → 精确世界 P */
  let denom = dot(dir, n);
  let t = dot(a0 - u.eye.xyz, n) / select(denom, -1e-4, abs(denom) < 1e-4);
  let P = u.eye.xyz + dir * t;
  let lod = lodOf(gmi);
  let alb = hue(hash1(instI * 131u)) * 0.22 + 0.5;
  gA[idx] = vec4f(P, 1.0);
  gB[idx] = vec4f(n, f32(lod));
  gC[idx] = vec4f(alb, bitcast<f32>((instI << 12u) | gmi));
}`;

/* ================= ReSTIR：初始 RIS + 时域 ================= */
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
  let P = ga.xyz; let N = gB[idx].xyz;
  rng = pcg(idx * 2654435761u + u32(u.p0.z) * 40503u + 1u);
  let nL = u32(u.p0.x); let M = u32(u.p0.y);
  var y = 0u; var wsum = 0.0; var Mc = 0.0; var pHat = 0.0;
  for (var k = 0u; k < M; k++) {
    let li = min(u32(rnd() * f32(nL)), nL - 1u);
    let ph = targetLum(P, N, li);
    let w = ph * f32(nL);
    wsum += w; Mc += 1.0;
    if (rnd() * wsum < w) { y = li; pHat = ph; }
  }
  if (u.p1.y > 0.5 && u.p2.x < 0.5) {
    let clip = u.prevVP * vec4f(P, 1.0);
    if (clip.w > 0.0) {
      let ndc = clip.xy / clip.w;
      let pp = vec2f((ndc.x * 0.5 + 0.5) * u.up.w, (0.5 - ndc.y * 0.5) * u.fwd.w);
      if (all(pp >= vec2f(0.0)) && pp.x < u.up.w && pp.y < u.fwd.w) {
        let pidx = u32(pp.y) * W + u32(pp.x);
        let gp = gAprev[pidx];
        if (gp.w > 0.5 && distance(gp.xyz, P) < 0.15) {
          let pr = resPrev[pidx];
          let py = bitcast<u32>(pr.x);
          var pM = min(pr.z, 20.0 * Mc);
          if (py < nL && pr.y > 0.0 && pM > 0.0) {
            let ph2 = targetLum(P, N, py);
            let w = ph2 * pr.y * pM;
            wsum += w; Mc += pM;
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

/* ================= ReSTIR：空域 ================= */
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
  if (ga.w < 0.5 || u.p1.z < 0.5) { resOut[idx] = mine; return; }
  let P = ga.xyz; let N = gB[idx].xyz;
  let nL = u32(u.p0.x);
  rng = pcg(idx * 2246822519u + u32(u.p0.z) * 32452867u + 7u);
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
    if (sga.w < 0.5 || distance(sga.xyz, P) > 2.5 || dot(gB[sidx].xyz, N) < 0.35) { continue; }
    let nr = resIn[sidx];
    let ny = bitcast<u32>(nr.x);
    if (ny >= nL || nr.y <= 0.0 || nr.z <= 0.0) { continue; }
    let ph = targetLum(P, N, ny);
    let w = ph * nr.y * nr.z;
    wsum += w; Mc += nr.z;
    if (rnd() * wsum < w) { y = ny; pHat = ph; }
  }
  var Wout = 0.0;
  if (pHat > 1e-6 && Mc > 0.0) { Wout = wsum / (Mc * pHat); }
  resOut[idx] = vec4f(bitcast<f32>(y), Wout, Mc, pHat);
}`;

/* ================= 着色 + 屏幕空间阴影 + 时域降噪（全屏片元） ================= */
const SHADE_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> lights: array<Light>;
@group(0) @binding(2) var<storage, read> gA: array<vec4f>;
@group(0) @binding(3) var<storage, read> gB: array<vec4f>;
@group(0) @binding(4) var<storage, read> gC: array<vec4f>;
@group(0) @binding(5) var<storage, read> res: array<vec4f>;
@group(0) @binding(6) var<storage, read> gAprev: array<vec4f>;
@group(0) @binding(7) var<storage, read> colPrev: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> colCur: array<vec4f>;
` + LIGHT_FN + /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
/* 屏幕空间阴影：沿 P→L 步进，在位置缓冲里查是否被更近的表面遮挡 */
fn shadowSS(P: vec3f, N: vec3f, lp: vec3f) -> f32 {
  let W = u.up.w; let H = u.fwd.w;
  let origin = P + N * 0.03;
  let STEPS = 24;
  for (var k = 1; k <= STEPS; k++) {
    let s = f32(k) / f32(STEPS);
    let Sp = mix(origin, lp, s);
    let clip = u.vp * vec4f(Sp, 1.0);
    if (clip.w <= 0.0) { break; }
    let ndc = clip.xy / clip.w;
    if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) { continue; }
    let pix = vec2f((ndc.x * 0.5 + 0.5) * W, (0.5 - ndc.y * 0.5) * H);
    let g = gA[u32(pix.y) * u32(W) + u32(pix.x)];
    if (g.w < 0.5) { continue; }
    let dSurf = dot(g.xyz - u.eye.xyz, u.fwd.xyz);
    let dRay = dot(Sp - u.eye.xyz, u.fwd.xyz);
    let diff = dRay - dSurf;
    if (diff > 0.05 && diff < 2.5) { return 0.0; }   // 被有限厚度表面遮挡
  }
  return 1.0;
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let W = u32(u.up.w); let H = u32(u.fwd.w);
  let idx = u32(fp.y) * W + u32(fp.x);
  let ga = gA[idx];
  let view = u32(u.p0.w);
  if (ga.w < 0.5) {
    colCur[idx] = vec4f(0.0);
    let rd = camRay(fp.x, fp.y);
    let sky = mix(vec3f(0.015, 0.02, 0.032), vec3f(0.04, 0.05, 0.08), clamp(rd.y + 0.3, 0.0, 1.0));
    return vec4f(pow(aces(sky), vec3f(1.0 / 2.2)), 1.0);
  }
  let P = ga.xyz; let N = gB[idx].xyz; let alb = gC[idx].xyz;
  let doShadow = u.p1.x > 0.5;
  let r = res[idx];
  let selId = bitcast<u32>(r.x);
  var vis = 1.0;
  if (doShadow && view != 1u) { vis = shadowSS(P, N, lights[selId].pa.xyz); }
  var col = alb * shadeRGB(P, N, selId) * r.y * vis;

  /* 时域降噪 */
  if (view == 0u && u.p2.x < 0.5) {
    let clip = u.prevVP * vec4f(P, 1.0);
    if (clip.w > 0.0) {
      let ndc = clip.xy / clip.w;
      let pp = vec2f((ndc.x * 0.5 + 0.5) * f32(W), (0.5 - ndc.y * 0.5) * f32(H));
      if (all(pp >= vec2f(0.0)) && pp.x < f32(W) && pp.y < f32(H)) {
        let pidx = u32(pp.y) * W + u32(pp.x);
        let gp = gAprev[pidx];
        if (gp.w > 0.5 && distance(gp.xyz, P) < 0.2) { col = mix(colPrev[pidx].rgb, col, 0.07); }
      }
    }
  }
  colCur[idx] = vec4f(col, 1.0);

  if (view == 2u) {                       // Meshlet 彩色
    return vec4f(hue(hash1(bitcast<u32>(gC[idx].w) * 2654435761u)) * 0.85 + 0.06, 1.0);
  } else if (view == 3u) {                // LOD 层级
    let lod = u32(gB[idx].w);
    let cols = array<vec3f, 4>(vec3f(0.3, 0.85, 0.4), vec3f(0.95, 0.85, 0.3), vec3f(0.95, 0.55, 0.25), vec3f(0.9, 0.3, 0.35));
    return vec4f(cols[lod], 1.0);
  } else if (view == 4u) {                // 光源 ID
    return vec4f(hue(fract(f32(selId) * 0.61803)) * 0.9, 1.0);
  } else if (view == 5u) {                // 法线
    return vec4f(N * 0.5 + 0.5, 1.0);
  }
  return vec4f(pow(aces(col), vec3f(1.0 / 2.2)), 1.0);
}`;

const LINE_WGSL = /* wgsl */ `
struct RU { vp: mat4x4f, size: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var<storage, read> pts: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f { return ru.vp * vec4f(pts[vi].xyz, 1.0); }
@fragment
fn fs() -> @location(0) vec4f { return vec4f(1.0, 0.62, 0.18, 1.0); }`;

/* ---------- 环面纽结 LOD ---------- */
function knotVerts(SEGU, SEGV, R1, R2) {
  const verts = [];
  for (let i = 0; i <= SEGU; i++) {
    const t = (i / SEGU) * Math.PI * 2, p = 2, q = 3;
    const r = R1 * (2 + Math.cos(q * t)) * 0.5;
    const cx = r * Math.cos(p * t), cy = R1 * Math.sin(q * t) * 0.35, cz = r * Math.sin(p * t);
    const t2 = t + 0.01, r2 = R1 * (2 + Math.cos(q * t2)) * 0.5;
    const dx = r2 * Math.cos(p * t2) - cx, dy = R1 * Math.sin(q * t2) * 0.35 - cy, dz = r2 * Math.sin(p * t2) - cz;
    const tl = Math.hypot(dx, dy, dz) || 1;
    const tx = dx / tl, ty = dy / tl, tz = dz / tl;
    let nx = cx, ny = 0, nz = cz;
    const nd = tx * nx + ty * ny + tz * nz;
    nx -= tx * nd; ny -= ty * nd; nz -= tz * nd;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    for (let j = 0; j <= SEGV; j++) {
      const a = (j / SEGV) * Math.PI * 2, ca = Math.cos(a) * R2, sa = Math.sin(a) * R2;
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
  if (wgslEl) wgslEl.textContent =
    '// ==== G-buffer 提取（可见性缓冲 → 射线-平面重建精确 P/N） ====\n' +
    EXTRACT_WGSL.slice(EXTRACT_WGSL.indexOf('@compute')) +
    '\n\n// ==== 屏幕空间阴影（沿阴影线在位置缓冲里查遮挡） ====\n' +
    SHADE_WGSL.slice(SHADE_WGSL.indexOf('fn shadowSS'), SHADE_WGSL.indexOf('@fragment'));
  function fail(msg) { if (hud) hud.textContent = ''; if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; } cvs.style.display = 'none'; }
  if (!navigator.gpu) { fail('当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge / Firefox 打开这个实验。'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('WebGPU adapter 请求失败。'); return; }
  const canTime = adapter.features.has('timestamp-query');
  const maxSB = adapter.limits.maxStorageBuffersPerShaderStage;
  if (maxSB < 9) { fail('此设备每着色阶段 storage buffer 上限为 ' + maxSB + '，不足以运行本实验（需要 9）。'); return; }
  const device = await adapter.requestDevice({
    requiredFeatures: canTime ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(16, maxSB) },
  });

  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, Hc = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const PW = Math.round(W * dpr), PH = Math.round(Hc * dpr);
  cvs.width = PW; cvs.height = PH;
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });
  const NP = PW * PH;

  /* ---- 几何：4 级 LOD ---- */
  const PATCH = 8;
  const LODS = [[512, 64], [256, 32], [128, 16], [64, 8]];
  const allVerts = [], meshlets = [], triList = [], lodStart = [], lodCount = [];
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
            const a = vIdx(mu * PATCH + i, mv * PATCH + j), b = vIdx(mu * PATCH + i + 1, mv * PATCH + j);
            const c = vIdx(mu * PATCH + i, mv * PATCH + j + 1), d = vIdx(mu * PATCH + i + 1, mv * PATCH + j + 1);
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
          for (let j = 0; j <= PATCH; j++) { const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j); cx += allVerts[vi2 * 4]; cy += allVerts[vi2 * 4 + 1]; cz += allVerts[vi2 * 4 + 2]; n++; }
        cx /= n; cy /= n; cz /= n;
        let rad = 0;
        for (let i = 0; i <= PATCH; i++)
          for (let j = 0; j <= PATCH; j++) { const vi2 = vIdx(mu * PATCH + i, mv * PATCH + j); rad = Math.max(rad, Math.hypot(allVerts[vi2 * 4] - cx, allVerts[vi2 * 4 + 1] - cy, allVerts[vi2 * 4 + 2] - cz)); }
        const al = Math.hypot(anx, any2, anz) || 1;
        const ax = anx / al, ay = any2 / al, az = anz / al;
        let mindp = 1;
        norms.forEach(([nx, ny, nz]) => { mindp = Math.min(mindp, nx * ax + ny * ay + nz * az); });
        const cutoff = mindp <= 0.1 ? 1 : Math.sqrt(1 - mindp * mindp);
        meshlets.push([cx, cy, cz, rad, ax, ay, az, cutoff]);
      }
    lodCount.push(meshlets.length - lodStart[lodStart.length - 1]);
  }
  const maxLocal = lodCount[0];

  /* ---- 实例网格 ---- */
  const GRID = 18, SPACING = 3.4;
  const insts = [];
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++) {
      const x = (i - (GRID - 1) / 2) * SPACING + (Math.random() - 0.5) * 0.5;
      const z = (j - (GRID - 1) / 2) * SPACING + (Math.random() - 0.5) * 0.5;
      insts.push([x, 0.6, z, Math.random() * Math.PI * 2]);
    }
  const NI = insts.length;
  const SRC_TRIS = NI * lodCount[0] * MTRI;
  const FIELD = (GRID * SPACING) / 2;

  const mkS = (arr, ctor, usage) => { const b = device.createBuffer({ size: arr.length * ctor.BYTES_PER_ELEMENT, usage: (usage || GPUBufferUsage.STORAGE) | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, new ctor(arr)); return b; };
  const vertBuf = mkS(allVerts, Float32Array);
  const triBuf = mkS(triList, Uint32Array);
  const mlBuf = mkS(meshlets.flat(), Float32Array);
  const instBuf = mkS(insts.flat(), Float32Array);
  const visBuf = device.createBuffer({ size: MAXVIS * 4, usage: GPUBufferUsage.STORAGE });
  const fbBuf = device.createBuffer({ size: NP * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cntBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const argsBuf = device.createBuffer({ size: 12, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
  const cuBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uBuf = device.createBuffer({ size: 288, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const frusBuf = device.createBuffer({ size: 24 * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const MAXL = 4096;
  const lightBuf = device.createBuffer({ size: MAXL * 32, usage: GPUBufferUsage.STORAGE });
  const mkStore = () => device.createBuffer({ size: NP * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const gA = [mkStore(), mkStore()], gB = mkStore(), gC = mkStore();
  const resTemp = mkStore(), resFinal = mkStore(), resPrev = mkStore();
  const color = [mkStore(), mkStore()];

  /* 光源动画（JS 端，写进 lightBuf） */
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
  let t = u.p2.y;
  let fld = u.p2.z;
  let bx = (r1 - 0.5) * 2.0 * fld;
  let bz = (r2 - 0.5) * 2.0 * fld;
  let by = 1.4 + r3 * 3.6;
  let ph = r3 * 6.2831853;
  let pos = vec3f(bx + sin(t * 0.4 + ph) * 0.8, by + sin(t * 0.6 + ph * 1.7) * 0.4, bz + cos(t * 0.5 + ph) * 0.8);
  lights[i].pa = vec4f(pos, 0.03);
  lights[i].pb = vec4f(hue(fract(r1 * 0.7 + r2 * 0.5 + 0.05)) * 0.6 + 0.25, 3.2);
}`;

  const mkCP = (code) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' } });
  const animP = mkCP(ANIM_WGSL);
  const cullP = mkCP(CULL_WGSL);
  const rastP = mkCP(RASTER_WGSL);
  const extP = mkCP(EXTRACT_WGSL);
  const initP = mkCP(INIT_WGSL);
  const spatP = mkCP(SPATIAL_WGSL);
  const shadeMod = device.createShaderModule({ code: SHADE_WGSL });
  const shadeP = device.createRenderPipeline({ layout: 'auto', vertex: { module: shadeMod, entryPoint: 'vs' }, fragment: { module: shadeMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const lineMod = device.createShaderModule({ code: LINE_WGSL });
  const lineP = device.createRenderPipeline({ layout: 'auto', vertex: { module: lineMod, entryPoint: 'vs' }, fragment: { module: lineMod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'line-list' } });

  const bg = (pipe, arr) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: arr.map((r, i) => ({ binding: i, resource: { buffer: r } })) });
  const animBG = bg(animP, [uBuf, lightBuf]);
  const cullBG = bg(cullP, [cuBuf, mlBuf, instBuf, visBuf, cntBuf, argsBuf]);
  const rastBG = bg(rastP, [ruBuf, vertBuf, triBuf, visBuf, instBuf, fbBuf, cntBuf]);
  const extBG = [
    bg(extP, [uBuf, vertBuf, triBuf, visBuf, instBuf, fbBuf, gA[0], gB, gC]),
    bg(extP, [uBuf, vertBuf, triBuf, visBuf, instBuf, fbBuf, gA[1], gB, gC]),
  ];
  const initBG = [
    bg(initP, [uBuf, lightBuf, gA[0], gB, gA[1], resPrev, resTemp]),
    bg(initP, [uBuf, lightBuf, gA[1], gB, gA[0], resPrev, resTemp]),
  ];
  const spatBG = [
    bg(spatP, [uBuf, lightBuf, gA[0], gB, resTemp, resFinal]),
    bg(spatP, [uBuf, lightBuf, gA[1], gB, resTemp, resFinal]),
  ];
  const shadeBG = [
    bg(shadeP, [uBuf, lightBuf, gA[0], gB, gC, resFinal, gA[1], color[1], color[0]]),
    bg(shadeP, [uBuf, lightBuf, gA[1], gB, gC, resFinal, gA[0], color[0], color[1]]),
  ];
  const lineBG = bg(lineP, [ruBuf, frusBuf]);

  let qs = null, qBuf = null, readPool = [], gpuMs = 0;
  if (canTime) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 });
    qBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) readPool.push({ buf: device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false });
  }
  const statRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let statBusy = false, stats = [0, 0, 0, 0];

  const $ = (id) => document.getElementById(id);
  const ui = { lights: $('pl-lights'), cand: $('pl-cand'), shadow: $('pl-shadow'), view: $('pl-view'), freeze: $('pl-freeze') };
  try { const q = new URLSearchParams(location.search); if (q.has('view') && ui.view) ui.view.value = q.get('view'); if (q.has('lights') && ui.lights) ui.lights.value = q.get('lights'); } catch (e) {}
  let yaw = 0.6, pitch = 0.5, radius = 22;
  let dragging = false, px0 = 0, py0 = 0, resetT = 2;
  cvs.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => { if (!dragging) return; yaw += (e.clientX - px0) * 0.005; pitch = Math.max(0.08, Math.min(1.3, pitch + (e.clientY - py0) * 0.004)); px0 = e.clientX; py0 = e.clientY; resetT = 1; });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => { e.preventDefault(); radius = Math.max(6, Math.min(50, radius + e.deltaY * 0.02)); resetT = 1; }, { passive: false });
  let frozen = null;
  if (ui.freeze) ui.freeze.addEventListener('change', () => { frozen = null; });

  const proj = mat4.perspective(0.9, PW / PH, 0.2, 200);
  const cuArr = new Float32Array(40);
  const ruArr = new Float32Array(20);
  const uArr = new Float32Array(72);
  let prevVP = mat4.identity();
  let cur = 0, frame = 0, prev = 0, fps = 60;

  function planesOf(vp) {
    const r = (i) => [vp[i], vp[4 + i], vp[8 + i], vp[12 + i]];
    const r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3);
    const mk = (a, s) => { const p = [r3[0] + s * a[0], r3[1] + s * a[1], r3[2] + s * a[2], r3[3] + s * a[3]]; const l = Math.hypot(p[0], p[1], p[2]) || 1; return [p[0] / l, p[1] / l, p[2] / l, p[3] / l]; };
    return [mk(r0, 1), mk(r0, -1), mk(r1, 1), mk(r1, -1), mk(r2, 1), mk(r2, -1)];
  }
  function frustumCorners(vpInv) {
    const cs = [];
    for (const z of [0.02, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) {
      const cx = vpInv[0] * x + vpInv[4] * y + vpInv[8] * z + vpInv[12], cy = vpInv[1] * x + vpInv[5] * y + vpInv[9] * z + vpInv[13];
      const cz = vpInv[2] * x + vpInv[6] * y + vpInv[10] * z + vpInv[14], cw = vpInv[3] * x + vpInv[7] * y + vpInv[11] * z + vpInv[15];
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
    const t = ts / 1000;

    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, 5 + Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const view = mat4.lookAt(eye, [0, 0.5, 0], [0, 1, 0]);
    const vp = mat4.multiply(proj, view);
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = nrm([-eye[0], 0.5 - eye[1], -eye[2]]);
    const right = nrm(crs(fwd, [0, 1, 0]));
    const up = crs(right, fwd);

    const nL = parseInt((ui.lights && ui.lights.value) || '1024', 10);
    const M = parseInt((ui.cand && ui.cand.value) || '16', 10);
    const shadows = (!ui.shadow || ui.shadow.checked) ? 1 : 0;
    const viewMode = parseInt((ui.view && ui.view.value) || '0', 10);

    /* U */
    uArr.set(vp, 0); uArr.set(prevVP, 16);
    uArr[32] = eye[0]; uArr[33] = eye[1]; uArr[34] = eye[2]; uArr[35] = Math.tan(0.45);
    uArr[36] = right[0]; uArr[37] = right[1]; uArr[38] = right[2]; uArr[39] = PW / PH;
    uArr[40] = up[0]; uArr[41] = up[1]; uArr[42] = up[2]; uArr[43] = PW;
    uArr[44] = fwd[0]; uArr[45] = fwd[1]; uArr[46] = fwd[2]; uArr[47] = PH;
    uArr[48] = nL; uArr[49] = M; uArr[50] = frame; uArr[51] = viewMode;
    uArr[52] = shadows; uArr[53] = 1; uArr[54] = 1; uArr[55] = 18;   // shadows, temporal, spatial, spatialRadius
    uArr[56] = resetT > 0 ? 1 : 0; uArr[57] = t; uArr[58] = FIELD; uArr[59] = 0;
    uArr[60] = lodStart[0]; uArr[61] = lodStart[1]; uArr[62] = lodStart[2]; uArr[63] = lodStart[3];
    device.queue.writeBuffer(uBuf, 0, uArr);

    /* Nanite 相机（可冻结剔除） */
    const freezeOn = ui.freeze && ui.freeze.checked;
    if (freezeOn && !frozen) { frozen = { vp: vp.slice(), eye: eye.slice() }; device.queue.writeBuffer(frusBuf, 0, frustumCorners(mat4.inverse(vp))); }
    if (!freezeOn) frozen = null;
    const cullVp = frozen ? frozen.vp : vp, cullEye = frozen ? frozen.eye : eye;
    const pl = planesOf(cullVp);
    for (let p = 0; p < 6; p++) cuArr.set(pl[p], p * 4);
    cuArr[24] = cullEye[0]; cuArr[25] = cullEye[1]; cuArr[26] = cullEye[2]; cuArr[27] = NI;
    cuArr[28] = lodStart[0]; cuArr[29] = lodStart[1]; cuArr[30] = lodStart[2]; cuArr[31] = lodStart[3];
    cuArr[32] = lodCount[0]; cuArr[33] = lodCount[1]; cuArr[34] = lodCount[2]; cuArr[35] = lodCount[3];
    cuArr[36] = 10; cuArr[37] = 20; cuArr[38] = 40; cuArr[39] = maxLocal;
    device.queue.writeBuffer(cuBuf, 0, cuArr);
    device.queue.writeBuffer(cuBuf, 160, new Float32Array([MAXVIS, 0, 0, 0]));
    ruArr.set(vp, 0); ruArr[16] = PW; ruArr[17] = PH;
    device.queue.writeBuffer(ruBuf, 0, ruArr);
    device.queue.writeBuffer(cntBuf, 0, new Uint32Array([0, 0, 0, 0]));
    device.queue.writeBuffer(argsBuf, 0, new Uint32Array([0, 1, 1]));

    const gx = Math.ceil(PW / 8), gy = Math.ceil(PH / 8);
    const enc = device.createCommandEncoder();
    enc.clearBuffer(fbBuf);
    const cp = enc.beginComputePass(canTime ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
    cp.setPipeline(animP); cp.setBindGroup(0, animBG); cp.dispatchWorkgroups(Math.ceil(nL / 64));
    cp.setPipeline(cullP); cp.setBindGroup(0, cullBG); cp.dispatchWorkgroups(Math.ceil(NI * maxLocal / 64));
    cp.end();
    const cp2 = enc.beginComputePass();
    cp2.setPipeline(rastP); cp2.setBindGroup(0, rastBG); cp2.dispatchWorkgroupsIndirect(argsBuf, 0);
    cp2.setPipeline(extP); cp2.setBindGroup(0, extBG[cur]); cp2.dispatchWorkgroups(gx, gy);
    cp2.setPipeline(initP); cp2.setBindGroup(0, initBG[cur]); cp2.dispatchWorkgroups(gx, gy);
    cp2.setPipeline(spatP); cp2.setBindGroup(0, spatBG[cur]); cp2.dispatchWorkgroups(gx, gy);
    cp2.end();

    const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }] });
    rp.setPipeline(shadeP); rp.setBindGroup(0, shadeBG[cur]); rp.draw(3);
    if (frozen) { rp.setPipeline(lineP); rp.setBindGroup(0, lineBG); rp.draw(24); }
    rp.end();

    enc.copyBufferToBuffer(resFinal, 0, resPrev, 0, NP * 16);
    let slot = null;
    if (canTime) { slot = readPool.find((s) => !s.busy); if (slot) { enc.resolveQuerySet(qs, 0, 2, qBuf, 0); enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 16); } }
    if (!statBusy) enc.copyBufferToBuffer(cntBuf, 0, statRead, 0, 16);
    const doStat = !statBusy;
    device.queue.submit([enc.finish()]);

    if (slot) { slot.busy = true; slot.buf.mapAsync(GPUMapMode.READ).then(() => { const q = new BigInt64Array(slot.buf.getMappedRange()); gpuMs += (Number(q[1] - q[0]) / 1e6 - gpuMs) * 0.1; slot.buf.unmap(); slot.busy = false; }).catch(() => { slot.busy = false; }); }
    if (doStat) { statBusy = true; statRead.mapAsync(GPUMapMode.READ).then(() => { stats = Array.from(new Uint32Array(statRead.getMappedRange())); statRead.unmap(); statBusy = false; }).catch(() => { statBusy = false; }); }

    prevVP = vp.slice();
    cur = 1 - cur; frame++;
    if (resetT > 0) resetT--;

    if (hud) {
      const srcM = (SRC_TRIS / 1e6).toFixed(1);
      const rastM = (stats[3] / 1e6).toFixed(2);
      hud.textContent = 'Nanite ' + srcM + 'M源→光栅 ' + rastM + 'M · MegaLights ' + nL.toLocaleString() + ' 灯' +
        (shadows ? ' + 屏幕空间阴影' : '') + ' · ' + (canTime ? gpuMs.toFixed(2) + 'ms · ' : '') + Math.round(fps) + ' fps' +
        (frozen ? ' · 剔除已冻结' : '');
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
