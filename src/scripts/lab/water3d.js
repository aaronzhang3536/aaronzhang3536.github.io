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


/* ============ 渲染：屏幕空间流体（SSF） ============
   粒子 → 视空间深度图（球面 impostor + frag_depth）
   → 双边滤波抹平颗粒 → 厚度累积图
   → 合成：深度重建法线，折射(Beer-Lambert 吸收) + 菲涅尔反射 + 高光 */

/* 渲染共享 uniform：
   view: 视矩阵
   proj4: p00 p11 p22 p32（zero-to-one 深度投影常数）
   a: x 粒子半径, y 目标宽 px, z 目标高 px, w 厚度系数
   b: xyz 视空间世界上方向, w 双边滤波深度 sigma
   c: xyz 视空间光方向, w 未用 */
const CAMX_DECL = /* wgsl */ `
struct CAMX { view: mat4x4f, proj4: vec4f, a: vec4f, b: vec4f, c: vec4f };
`;

const BILLBOARD_VS = /* wgsl */ `
struct VSOut {
  @builtin(position) p: vec4f,
  @location(0) uv: vec2f,
  @location(1) vz: f32,
  @location(2) spd: f32,
};
fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return c[vi];
}
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  let pt = pos[vi / 6u];
  let c = corner(vi % 6u);
  var pv = (cam.view * vec4f(pt.xyz, 1.0)).xyz;
  pv += vec3f(c * cam.a.x, 0.0);
  var o: VSOut;
  o.p = vec4f(pv.x * cam.proj4.x, pv.y * cam.proj4.y, pv.z * cam.proj4.z + cam.proj4.w, -pv.z);
  o.uv = c;
  o.vz = pv.z;
  o.spd = pt.w;
  return o;
}`;

const DEPTH_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
` + BILLBOARD_VS + /* wgsl */ `
struct FSOut { @location(0) d: f32, @builtin(frag_depth) fd: f32 };
@fragment
fn fs(in: VSOut) -> FSOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let zs = in.vz + sqrt(1.0 - r2) * cam.a.x;   /* 球面朝相机的视空间 z */
  var o: FSOut;
  o.d = -zs;
  o.fd = (zs * cam.proj4.z + cam.proj4.w) / (-zs);
  return o;
}`;

const THICK_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
` + BILLBOARD_VS + /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) f32 {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  /* 穿过球体的弦长 = 2R√(1-r²) */
  return 2.0 * cam.a.x * sqrt(1.0 - r2) * cam.a.w;
}`;

const BLUR_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<uniform> dir: vec4f;   /* xy 步长（像素） */
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) f32 {
  let d0 = textureLoad(src, vec2i(fp.xy), 0).x;
  if (d0 > 1.0e8) { return d0; }
  let sigR = cam.b.w;
  var sum = 0.0;
  var wsum = 0.0;
  for (var i = -8; i <= 8; i++) {
    let q = clamp(vec2i(fp.xy + dir.xy * f32(i)), vec2i(0), vec2i(i32(cam.a.y) - 1, i32(cam.a.z) - 1));
    let di = textureLoad(src, q, 0).x;
    if (di > 1.0e8) { continue; }
    let dd = (di - d0) / sigR;
    let w = exp(-f32(i * i) * 0.028 - dd * dd);
    sum += di * w;
    wsum += w;
  }
  return sum / max(wsum, 1e-6);
}`;

const BG_WGSL = /* wgsl */ `
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let g = clamp(fp.y / 900.0, 0.0, 1.0);
  return vec4f(mix(vec3f(0.05, 0.06, 0.095), vec3f(0.012, 0.014, 0.022), g), 1.0);
}`;

const COMP_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var depthT: texture_2d<f32>;
@group(0) @binding(2) var thickT: texture_2d<f32>;
@group(0) @binding(3) var bgT: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn viewPos(px: vec2f, d: f32) -> vec3f {
  let ndc = vec2f(px.x / cam.a.y * 2.0 - 1.0, 1.0 - px.y / cam.a.z * 2.0);
  return vec3f(ndc.x * d / cam.proj4.x, ndc.y * d / cam.proj4.y, -d);
}
fn dAt(p: vec2i) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(i32(cam.a.y) - 1, i32(cam.a.z) - 1));
  return textureLoad(depthT, q, 0).x;
}
@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let uv = fp.xy / vec2f(cam.a.y, cam.a.z);
  let bg = textureSampleLevel(bgT, samp, uv, 0.0).rgb;
  let d = dAt(vec2i(fp.xy));
  if (d > 1.0e8) { return vec4f(pow(bg, vec3f(1.0 / 2.2)), 1.0); }

  /* 深度重建视空间法线（取差值较小的一侧避免轮廓伪影） */
  let pc = vec2i(fp.xy);
  let dR = dAt(pc + vec2i(1, 0)) - d;
  let dL = d - dAt(pc - vec2i(1, 0));
  let dB = dAt(pc + vec2i(0, 1)) - d;
  let dT = d - dAt(pc - vec2i(0, 1));
  let ddx = select(dL, dR, abs(dR) < abs(dL));
  let ddy = select(dT, dB, abs(dB) < abs(dT));
  let p0 = viewPos(fp.xy, d);
  let tx = viewPos(fp.xy + vec2f(1.0, 0.0), d + ddx) - p0;
  let ty = viewPos(fp.xy + vec2f(0.0, 1.0), d + ddy) - p0;
  var n = normalize(cross(tx, ty));
  if (n.z < 0.0) { n = -n; }

  let thick = textureLoad(thickT, pc, 0).x;

  /* 折射：按法线扰动采样背景，Beer-Lambert 吸收出水色 */
  let ruv = clamp(uv - n.xy * clamp(thick, 0.0, 0.5) * 0.30, vec2f(0.001), vec2f(0.999));
  let bgR = textureSampleLevel(bgT, samp, ruv, 0.0).rgb;
  let transmit = exp(-vec3f(5.5, 1.7, 0.9) * thick);
  var refr = bgR * transmit + vec3f(0.05, 0.24, 0.42) * (1.0 - transmit) * 0.4;

  let V = -normalize(p0);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let r = reflect(-V, n);
  let skyF = clamp(dot(r, cam.b.xyz) * 0.65 + 0.35, 0.0, 1.0);
  let skyC = mix(vec3f(0.035, 0.05, 0.085), vec3f(0.42, 0.56, 0.75), skyF * skyF);
  let spec = pow(max(dot(r, cam.c.xyz), 0.0), 90.0) * 0.9;

  var col = mix(refr, skyC, fres) + vec3f(spec);
  return vec4f(pow(clamp(col, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}`;

const LINE_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var<storage, read> pts: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let pv = (cam.view * vec4f(pts[vi].xyz, 1.0)).xyz;
  return vec4f(pv.x * cam.proj4.x, pv.y * cam.proj4.y, pv.z * cam.proj4.z + cam.proj4.w, -pv.z);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.30, 0.37, 0.50, 0.55); }`;

/* 粒子模式（对比用）：老式球面 impostor 直接着色 */
const PART_WGSL = CAMX_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> cam: CAMX;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
` + BILLBOARD_VS + /* wgsl */ `
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let n = vec3f(in.uv, sqrt(1.0 - r2));
  let dif = max(dot(n, normalize(vec3f(0.4, 0.8, 0.5))), 0.0);
  let foam = clamp(in.spd * 0.55 - 0.25, 0.0, 1.0);
  var col = mix(vec3f(0.05, 0.22, 0.55), vec3f(0.25, 0.55, 0.9), dif);
  col = mix(col, vec3f(0.85, 0.95, 1.0), foam * 0.75);
  col += vec3f(0.5, 0.7, 0.9) * pow(1.0 - n.z, 2.0) * 0.35;
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}`;

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
      '\n\n// ---- 压力/粘性/积分 ----' + FORCE_WGSL +
      '\n\n// ---- 屏幕空间流体合成 ----' + COMP_WGSL;
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
  const PW = Math.round(W * dpr), PH = Math.round(Hc * dpr);
  cvs.width = PW; cvs.height = PH;
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  /* 屏幕空间纹理 */
  const mk2D = (fmt) => device.createTexture({
    size: [PW, PH], format: fmt,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const bgTex = mk2D('rgba8unorm').createView();
  const depA = mk2D('r32float').createView();
  const depB = mk2D('r32float').createView();
  const thickTex = mk2D('r16float').createView();
  const zView = device.createTexture({
    size: [PW, PH], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
  }).createView();
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

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

  const mkRP = (code, opts) => {
    const m = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: m, entryPoint: 'vs' },
      fragment: { module: m, entryPoint: 'fs', targets: [opts.target] },
      primitive: { topology: opts.topo || 'triangle-list' },
      ...(opts.depth ? { depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } } : {}),
    });
  };
  const depthP = mkRP(DEPTH_WGSL, { target: { format: 'r32float' }, depth: true });
  const thickP = mkRP(THICK_WGSL, {
    target: {
      format: 'r16float',
      blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
    },
  });
  const blurP = mkRP(BLUR_WGSL, { target: { format: 'r32float' } });
  const bgP = mkRP(BG_WGSL, { target: { format: 'rgba8unorm' } });
  const bgLineP = mkRP(LINE_WGSL, { target: { format: 'rgba8unorm' }, topo: 'line-list' });
  const compP = mkRP(COMP_WGSL, { target: { format } });
  const ovLineP = mkRP(LINE_WGSL, {
    target: {
      format,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    },
    topo: 'line-list',
  });
  const partP = mkRP(PART_WGSL, { target: { format }, depth: true });
  const partLineP = mkRP(LINE_WGSL, { target: { format }, topo: 'line-list', depth: true });

  const suBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const camBuf = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dirH = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dirV = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(dirH, 0, new Float32Array([2 * (dpr > 1.4 ? 1.6 : 1), 0, 0, 0]));
  device.queue.writeBuffer(dirV, 0, new Float32Array([0, 2 * (dpr > 1.4 ? 1.6 : 1), 0, 0]));
  const cntBuf = device.createBuffer({ size: CELL_TOTAL * 4, usage: GPUBufferUsage.STORAGE });
  const tblBuf = device.createBuffer({ size: CELL_TOTAL * CAP * 4, usage: GPUBufferUsage.STORAGE });

  /* 容器线框 */
  const hi = [BOX[0], BOX[1] * 2.2, BOX[2]], lo = [-BOX[0], -BOX[1], -BOX[2]];
  const cor = [];
  for (let i = 0; i < 8; i++) cor.push([i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]);
  const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const lineArr = new Float32Array(edges.length * 2 * 4);
  edges.flat().forEach((ci, k) => lineArr.set([...cor[ci], 1], k * 4));
  const lineBuf = device.createBuffer({ size: lineArr.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lineBuf, 0, lineArr);
  const lineBG = (pipe) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camBuf } },
      { binding: 1, resource: { buffer: lineBuf } },
    ],
  });
  const bgLineBG = lineBG(bgLineP);
  const ovLineBG = lineBG(ovLineP);
  const partLineBG = lineBG(partLineP);

  const blurHBG = device.createBindGroup({
    layout: blurP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camBuf } },
      { binding: 1, resource: depA },
      { binding: 2, resource: { buffer: dirH } },
    ],
  });
  const blurVBG = device.createBindGroup({
    layout: blurP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camBuf } },
      { binding: 1, resource: depB },
      { binding: 2, resource: { buffer: dirV } },
    ],
  });
  const compBG = device.createBindGroup({
    layout: compP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: camBuf } },
      { binding: 1, resource: depA },
      { binding: 2, resource: thickTex },
      { binding: 3, resource: bgTex },
      { binding: 4, resource: samp },
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
    const bg = (pipe, bufs) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: bufs.map((b, k) => ({ binding: k, resource: { buffer: b } })),
    });
    BGs = {
      clear: bg(clearP, [suBuf, cntBuf]),
      bin: bg(binP, [suBuf, posBuf, cntBuf, tblBuf]),
      den: bg(denP, [suBuf, posBuf, cntBuf, tblBuf, rhoBuf]),
      frc: bg(frcP, [suBuf, posBuf, velBuf, cntBuf, tblBuf, rhoBuf]),
      depth: bg(depthP, [camBuf, posBuf]),
      thick: bg(thickP, [camBuf, posBuf]),
      part: bg(partP, [camBuf, posBuf]),
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

  /* 交互 */
  const $ = (id) => document.getElementById(id);
  const ui = { n: $('wt-n'), visc: $('wt-visc'), stiff: $('wt-stiff'), grav: $('wt-grav'), mode: $('wt-mode') };
  let radius = 2.1, yaw = 0.6;
  let pusher = null, lastPt = null, dragging = false;
  let camBasis = null;
  function rayPoint(e) {
    const r = cvs.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const th = Math.tan(0.38), aspect = PW / PH;
    const b = camBasis;
    return [
      b.eye[0] + (b.fwd[0] + b.right[0] * nx * th * aspect + b.up[0] * ny * th) * radius,
      b.eye[1] + (b.fwd[1] + b.right[1] * nx * th * aspect + b.up[1] * ny * th) * radius,
      b.eye[2] + (b.fwd[2] + b.right[2] * nx * th * aspect + b.up[2] * ny * th) * radius,
    ];
  }
  cvs.addEventListener('pointerdown', (e) => { dragging = true; lastPt = null; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging || !camBasis) return;
    const p = rayPoint(e);
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

  const proj = mat4.perspective(0.76, PW / PH, 0.05, 30);
  const p4 = [proj[0], proj[5], proj[10], proj[14]];
  const suArr = new Float32Array(20);
  const camArr = new Float32Array(32);
  const SUBSTEPS = 3;
  let prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.033) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;
    yaw += dtF * 0.05;

    const pitch = 0.42;
    const eye = [Math.sin(yaw) * Math.cos(pitch) * radius, Math.sin(pitch) * radius, Math.cos(yaw) * Math.cos(pitch) * radius];
    const tgt = [0, 0.1, 0];
    const view = mat4.lookAt(eye, tgt, [0, 1, 0]);
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = nrm([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
    const right = nrm(crs(fwd, [0, 1, 0]));
    const up = crs(right, fwd);
    camBasis = { eye, right, up, fwd };

    /* 世界方向 → 视空间（view 的 3x3） */
    const toView = (d) => [
      view[0] * d[0] + view[4] * d[1] + view[8] * d[2],
      view[1] * d[0] + view[5] * d[1] + view[9] * d[2],
      view[2] * d[0] + view[6] * d[1] + view[10] * d[2],
    ];
    const vsUp = toView([0, 1, 0]);
    const vsL = nrm(toView(nrm([0.4, 0.8, 0.5])));
    const R = SPACING * 0.85;

    camArr.set(view, 0);
    camArr[16] = p4[0]; camArr[17] = p4[1]; camArr[18] = p4[2]; camArr[19] = p4[3];
    camArr[20] = R; camArr[21] = PW; camArr[22] = PH; camArr[23] = 1.0;
    camArr[24] = vsUp[0]; camArr[25] = vsUp[1]; camArr[26] = vsUp[2]; camArr[27] = R * 3.2;
    camArr[28] = vsL[0]; camArr[29] = vsL[1]; camArr[30] = vsL[2]; camArr[31] = 0;
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

    const isWater = !ui.mode || ui.mode.value === 'water';
    if (isWater) {
      /* 1. 背景 + 容器线 */
      let rp = enc.beginRenderPass({
        colorAttachments: [{ view: bgTex, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }],
      });
      rp.setPipeline(bgP); rp.draw(3);
      rp.setPipeline(bgLineP); rp.setBindGroup(0, bgLineBG); rp.draw(24);
      rp.end();
      /* 2. 粒子深度 */
      rp = enc.beginRenderPass({
        colorAttachments: [{ view: depA, loadOp: 'clear', clearValue: { r: 1e9, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
        depthStencilAttachment: { view: zView, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' },
      });
      rp.setPipeline(depthP); rp.setBindGroup(0, BGs.depth); rp.draw(N * 6);
      rp.end();
      /* 3. 双边滤波 ×2 轮（H → V） */
      for (let it = 0; it < 2; it++) {
        rp = enc.beginRenderPass({
          colorAttachments: [{ view: depB, loadOp: 'clear', clearValue: { r: 1e9, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
        });
        rp.setPipeline(blurP); rp.setBindGroup(0, blurHBG); rp.draw(3);
        rp.end();
        rp = enc.beginRenderPass({
          colorAttachments: [{ view: depA, loadOp: 'clear', clearValue: { r: 1e9, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
        });
        rp.setPipeline(blurP); rp.setBindGroup(0, blurVBG); rp.draw(3);
        rp.end();
      }
      /* 4. 厚度累积 */
      rp = enc.beginRenderPass({
        colorAttachments: [{ view: thickTex, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
      });
      rp.setPipeline(thickP); rp.setBindGroup(0, BGs.thick); rp.draw(N * 6);
      rp.end();
      /* 5. 合成 + 玻璃缸前缘 */
      rp = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
        }],
      });
      rp.setPipeline(compP); rp.setBindGroup(0, compBG); rp.draw(3);
      rp.setPipeline(ovLineP); rp.setBindGroup(0, ovLineBG); rp.draw(24);
      rp.end();
    } else {
      const rp = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          loadOp: 'clear', clearValue: { r: 0.012, g: 0.014, b: 0.022, a: 1 }, storeOp: 'store',
        }],
        depthStencilAttachment: { view: zView, depthLoadOp: 'clear', depthClearValue: 1, depthStoreOp: 'store' },
      });
      rp.setPipeline(partLineP); rp.setBindGroup(0, partLineBG); rp.draw(24);
      rp.setPipeline(partP); rp.setBindGroup(0, BGs.part); rp.draw(N * 6);
      rp.end();
    }

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
      hud.textContent = N.toLocaleString() + ' 粒子 · ' + (isWater ? 'SSF 水面' : '粒子') + ' · ' +
        (canTime ? 'sim ' + simMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
