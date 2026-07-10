/* 庐山 · 自由漫游 — 裸 WebGPU
   真实 DEM（SRTM 30m，AWS 开放地形瓦片构建期烘焙）等比例渲染江西九江庐山：
   29.0 × 29.9 km，海拔 -14 ~ 1474m（大汉阳峰）。程序化大气天空 + 高度/坡度
   材质地形 + 鄱阳湖水面 + 三处真实位置瀑布（三叠泉/秀峰/石门涧）+ 十万级
   实例化树木 + 自由飞行/步行漫游 + 地标传送 + 昼夜 + 小地图。零外部资源。 */
import { mat4, vec3 } from 'wgpu-matrix';

const $ = (id) => document.getElementById(id);
const cvs = $('lab-cv');
const hud = $('lab-hud');

/* ---------- 地标（真实经纬度） ---------- */
const MARKS = [
  { id: 'dahanyang', name: '大汉阳峰 1474m', lon: 115.9800, lat: 29.5069, dy: 4 },
  { id: 'wulao',     name: '五老峰 1436m',   lon: 116.0333, lat: 29.5522, dy: 4 },
  { id: 'hanpokou',  name: '含鄱口',          lon: 116.0192, lat: 29.5486, dy: 4 },
  { id: 'guling',    name: '牯岭镇',          lon: 115.9861, lat: 29.5697, dy: 4 },
  { id: 'ruqin',     name: '如琴湖 · 花径',   lon: 115.9722, lat: 29.5647, dy: 4 },
  { id: 'xianren',   name: '仙人洞',          lon: 115.9639, lat: 29.5622, dy: 4 },
  { id: 'sandiequan',name: '三叠泉瀑布',      lon: 116.0439, lat: 29.5695, dy: 8 },
  { id: 'xiufeng',   name: '秀峰瀑布（李白）', lon: 115.9930, lat: 29.4715, dy: 8 },
  { id: 'shimen',    name: '石门涧',          lon: 115.9395, lat: 29.5600, dy: 8 },
  { id: 'bailu',     name: '白鹿洞书院',      lon: 116.0736, lat: 29.4936, dy: 4 },
  { id: 'donglin',   name: '东林寺',          lon: 115.9439, lat: 29.6106, dy: 4 },
  { id: 'poyang',    name: '鄱阳湖',          lon: 116.1600, lat: 29.4900, dy: 6 },
];
/* 瀑布：顶/底经纬度（沿真实溪谷走向，条带贴崖） */
const FALLS = [
  { top: [116.0415, 29.5665], bot: [116.0455, 29.5716], w: 16 },   /* 三叠泉，155m 三级 */
  { top: [115.9915, 29.4740], bot: [115.9945, 29.4693], w: 13 },   /* 秀峰（开先）瀑布 */
  { top: [115.9420, 29.5575], bot: [115.9372, 29.5612], w: 11 },   /* 石门涧 */
];

/* ---------- WGSL ---------- */
const COMMON = /* wgsl */`
struct U {
  vp: mat4x4f,
  invVP: mat4x4f,
  eye: vec4f,        // xyz, time
  sun: vec4f,        // xyz dir(指向太阳), 强度
  map: vec4f,        // mx, my, n, cell(米)
  fog: vec4f,        // 密度, 水面高度, 网格步长, 树摆动
  misc: vec4f,       // 太阳高度角sin, 曝光, 0, 0
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> H: array<f32>;

fn hAt(ix: i32, iz: i32) -> f32 {
  let n = i32(u.map.z);
  let x = clamp(ix, 0, n - 1);
  let z = clamp(iz, 0, n - 1);
  return H[z * n + x];
}
fn hBilinear(wx: f32, wz: f32) -> f32 {
  let n = u.map.z;
  let fx = clamp(wx / u.map.x, 0.0, 1.0) * (n - 1.0);
  let fz = clamp(wz / u.map.y, 0.0, 1.0) * (n - 1.0);
  let x0 = i32(fx); let z0 = i32(fz);
  let ax = fract(fx); let az = fract(fz);
  let h00 = hAt(x0, z0); let h10 = hAt(x0 + 1, z0);
  let h01 = hAt(x0, z0 + 1); let h11 = hAt(x0 + 1, z0 + 1);
  return mix(mix(h00, h10, ax), mix(h01, h11, ax), az);
}
fn waterMask(wx: f32, wz: f32) -> f32 {
  let fx = wx / u.map.x;
  let fz = wz / u.map.y;
  return select(0.0, 1.0, fx > 0.63 || (fz > 0.76 && fx > 0.44));
}
fn terrainNormal(wx: f32, wz: f32, e: f32) -> vec3f {
  let hl = hBilinear(wx - e, wz); let hr = hBilinear(wx + e, wz);
  let hd = hBilinear(wx, wz - e); let hu = hBilinear(wx, wz + e);
  return normalize(vec3f(hl - hr, 2.0 * e, hd - hu));
}
fn hash2(p: vec2f) -> f32 {
  let q = fract(p * vec2f(123.34, 345.45));
  let r = q + dot(q, q + 34.345);
  return fract(r.x * r.y);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1, 0)), s.x),
             mix(hash2(i + vec2f(0, 1)), hash2(i + vec2f(1, 1)), s.x), s.y);
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0; var a = 0.5; var q = p;
  for (var k = 0; k < 5; k++) { v += a * vnoise(q); q = q * 2.03 + vec2f(11.7, 5.3); a *= 0.5; }
  return v;
}
/* 大气：天空颜色（视线方向）与气溶胶远景 */
fn skyColor(dir: vec3f) -> vec3f {
  let sunE = u.misc.x;                       // sin(太阳高度角)
  let day = smoothstep(-0.08, 0.25, sunE);
  let dusk = 1.0 - smoothstep(0.12, 0.42, abs(sunE - 0.12));
  let upness = clamp(dir.y, 0.0, 1.0);
  let zen = mix(vec3f(0.06, 0.10, 0.22), vec3f(0.16, 0.34, 0.68), day);
  var hor = mix(vec3f(0.10, 0.09, 0.14), vec3f(0.62, 0.74, 0.90), day);
  hor = mix(hor, vec3f(0.98, 0.52, 0.24), dusk * 0.8);
  var col = mix(hor, zen, pow(upness, 0.55));
  let cosS = clamp(dot(dir, u.sun.xyz), 0.0, 1.0);
  col += vec3f(1.0, 0.85, 0.6) * pow(cosS, 350.0) * 12.0 * u.sun.w;      // 日轮
  col += vec3f(1.0, 0.72, 0.42) * pow(cosS, 8.0) * 0.28 * u.sun.w;      // Mie 晕
  col += vec3f(0.98, 0.55, 0.30) * pow(cosS, 2.0) * dusk * 0.35;
  /* 卷云 */
  if (dir.y > 0.02) {
    let cp = dir.xz / (dir.y + 0.12) * 5.0 + vec2f(u.eye.w * 0.004, 0.0);
    let c = smoothstep(0.55, 0.85, fbm(cp)) * smoothstep(0.02, 0.14, dir.y);
    col = mix(col, vec3f(1.0, 0.97, 0.94) * (0.55 + 0.45 * day), c * 0.55);
  }
  /* 夜幕星星 */
  let night = 1.0 - smoothstep(-0.16, 0.02, sunE);
  if (night > 0.01 && dir.y > 0.0) {
    let sp = floor(dir.xz / max(dir.y, 0.05) * 240.0);
    let st = step(0.9985, hash2(sp)) * night;
    col += vec3f(st) * 0.8;
  }
  return col;
}
fn aerial(col: vec3f, dist: f32, dir: vec3f) -> vec3f {
  let t = exp(-dist * u.fog.x);
  let horiz = skyColor(normalize(vec3f(dir.x, max(dir.y, 0.015) * 0.25, dir.z)));
  return mix(horiz, col, t);
}
fn tonemap(c: vec3f) -> vec3f {
  let x = c * u.misc.y;
  let m = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(m, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}
`;

const TERRAIN = COMMON + /* wgsl */`
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) water: f32,
};
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let step = u.fog.z;
  let cells = u32((u.map.z - 1.0) / step);
  let quad = vid / 6u;
  let corner = vid % 6u;
  let qx = quad % cells;
  let qz = quad / cells;
  var cx = f32(qx); var cz = f32(qz);
  if (corner == 1u || corner == 4u || corner == 5u) { cz += 1.0; }
  if (corner == 2u || corner == 3u || corner == 5u) { cx += 1.0; }
  let n1 = u.map.z - 1.0;
  let gx = min(cx * step, n1);
  let gz = min(cz * step, n1);
  let wx = gx / n1 * u.map.x;
  let wz = gz / n1 * u.map.y;
  let h = hAt(i32(gx), i32(gz));
  var o: VOut;
  let wl = u.fog.y;
  let inLake = waterMask(wx, wz);
  let isW = inLake > 0.5 && h < wl - 0.05;
  let y = select(h, wl, isW);
  o.water = select(0.0, 1.0, isW);
  o.wp = vec3f(wx, y, wz);
  o.pos = u.vp * vec4f(o.wp, 1.0);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let toEye = u.eye.xyz - v.wp;
  let dist = length(toEye);
  let vdir = toEye / max(dist, 0.001);
  var col: vec3f;
  var N: vec3f;
  if (v.water > 0.5) {
    /* 鄱阳湖：波纹 + 天空反射 + 日光耀斑 */
    let t = u.eye.w;
    let p = v.wp.xz * 0.05;
    let w1 = vnoise(p * 3.0 + vec2f(t * 0.35, t * 0.22));
    let w2 = vnoise(p * 7.0 - vec2f(t * 0.5, t * 0.31));
    N = normalize(vec3f((w1 - 0.5) * 0.22 + (w2 - 0.5) * 0.1, 1.0, (w2 - 0.5) * 0.22));
    let R = reflect(-vdir, N);
    let sky = skyColor(normalize(vec3f(R.x, abs(R.y), R.z)));
    let deep = vec3f(0.02, 0.07, 0.09);
    let fres = pow(1.0 - clamp(dot(vdir, N), 0.0, 1.0), 3.0);
    col = mix(deep, sky, 0.25 + 0.75 * fres);
    let glint = pow(clamp(dot(R, u.sun.xyz), 0.0, 1.0), 900.0) * 6.0 * u.sun.w;
    col += vec3f(1.0, 0.9, 0.7) * glint;
  } else {
    N = terrainNormal(v.wp.x, v.wp.z, max(u.map.w, dist * 0.004));
    let h = v.wp.y;
    let slope = 1.0 - N.y;
    let d1 = fbm(v.wp.xz * 0.0016);
    let d2 = fbm(v.wp.xz * 0.02);
    let d3 = vnoise(v.wp.xz * 0.35);
    /* 材质分层：田畴 → 阔叶林 → 针叶/灌丛 → 山顶草甸；陡坡花岗岩 */
    let farm  = vec3f(0.19, 0.25, 0.09) + (d2 - 0.5) * 0.07;
    let forest= mix(vec3f(0.035, 0.125, 0.04), vec3f(0.08, 0.21, 0.07), smoothstep(0.3, 0.7, d1)) + (d3 - 0.5) * 0.035;
    let shrub = vec3f(0.12, 0.17, 0.07) + (d2 - 0.5) * 0.05;
    let meadow= vec3f(0.25, 0.26, 0.12) + (d2 - 0.5) * 0.07;
    var base = mix(farm, forest, smoothstep(35.0, 120.0, h));
    base = mix(base, shrub, smoothstep(950.0, 1150.0, h));
    base = mix(base, meadow, smoothstep(1230.0, 1380.0, h));
    /* 花岗岩：坡度 + 高频节理条带 */
    let band = 0.86 + 0.14 * sin(h * 0.16 + d1 * 16.0 + d2 * 7.0);
    let rockC = (vec3f(0.33, 0.32, 0.31) + (d2 - 0.5) * 0.12) * band;
    let rockW = smoothstep(0.30, 0.52, slope + (d2 - 0.5) * 0.10);
    base = mix(base, rockC, rockW);
    base = base * (0.74 + 0.52 * d2);
    /* 湖岸沙线 */
    base = mix(vec3f(0.40, 0.36, 0.26), base, max(smoothstep(u.fog.y + 0.3, u.fog.y + 4.0, h), 1.0 - waterMask(v.wp.x, v.wp.z)));
    /* 光照 */
    let sunI = u.sun.w;
    let ndl = clamp(dot(N, u.sun.xyz), 0.0, 1.0);
    let ao = 0.55 + 0.45 * clamp(N.y, 0.0, 1.0);
    let skyA = ao * mix(0.10, 0.30, smoothstep(-0.1, 0.4, u.misc.x));
    let sunC = mix(vec3f(1.0, 0.5, 0.25), vec3f(1.0, 0.96, 0.88), smoothstep(0.0, 0.35, u.misc.x));
    col = base * (sunC * (ndl * ndl * 0.35 + ndl * 0.65) * 1.0 * sunI + skyColor(vec3f(0.0, 1.0, 0.0)) * skyA);
    if (u.misc.z > 0.5 && u.misc.z < 1.5) { return vec4f(base, 1.0); }
    if (u.misc.z > 2.5 && u.misc.z < 3.5) { return vec4f(N * 0.5 + 0.5, 1.0); }
  }
  if (u.misc.z > 1.5 && u.misc.z < 2.5) { return vec4f(vec3f(v.wp.y / 1500.0), 1.0); }
  if (u.misc.z > 3.5) { return vec4f(v.water, 0.0, 1.0 - v.water, 1.0); }
  col = aerial(col, dist, -vdir);
  return vec4f(tonemap(col), 1.0);
}
`;

const SKY = COMMON + /* wgsl */`
struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let xy = vec2f(f32((vid << 1u) & 2u), f32(vid & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(xy, 1.0, 1.0);
  o.ndc = xy;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let p0 = u.invVP * vec4f(v.ndc, 0.0, 1.0);
  let p1 = u.invVP * vec4f(v.ndc, 1.0, 1.0);
  let dir = normalize(p1.xyz / p1.w - p0.xyz / p0.w);
  return vec4f(tonemap(skyColor(dir)), 1.0);
}
`;

const TREES = COMMON + /* wgsl */`
struct Inst { p: vec4f, q: vec4f };  // p: xyz + scale, q: type, hue, phase, 0
@group(0) @binding(2) var<storage, read> inst: array<Inst>;
@group(0) @binding(3) var atlas: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) tint: vec3f,
  @location(2) wp: vec3f,
  @location(3) fade: f32,
};
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VOut {
  let it = inst[iid];
  let corner = vid % 6u;
  let quad = vid / 6u;              // 0/1 两块交叉面片
  var lx = 0.0; var ly = 0.0;
  if (corner == 1u || corner == 4u || corner == 5u) { lx = 1.0; }
  if (corner == 2u || corner == 3u || corner == 5u) { ly = 1.0; }
  let w = it.p.w * 3.4;
  let hgt = it.p.w * 6.0;
  let x = (lx - 0.5) * w;
  var dir = vec2f(1.0, 0.0);
  if (quad == 1u) { dir = vec2f(0.0, 1.0); }
  /* 风摆：顶部按相位摇 */
  let sway = sin(u.eye.w * 1.4 + it.q.z) * u.fog.w * ly * ly;
  var wp = it.p.xyz + vec3f(dir.x * x + sway, ly * hgt, dir.y * x + sway * 0.6);
  var o: VOut;
  let dist = length(u.eye.xyz - it.p.xyz);
  o.fade = 1.0 - smoothstep(6500.0, 9000.0, dist);
  if (o.fade <= 0.001) { wp = vec3f(0.0, -1000.0, 0.0); }
  o.wp = wp;
  o.pos = u.vp * vec4f(wp, 1.0);
  o.uv = vec2f((lx + it.q.x) * 0.5, 1.0 - ly);
  let hueShift = it.q.y;
  o.tint = mix(vec3f(0.95, 1.0, 0.85), vec3f(0.75, 1.0, 1.05), hueShift);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let tex = textureSample(atlas, samp, v.uv);
  if (tex.a < 0.38 || v.fade < 0.02) { discard; }
  let toEye = u.eye.xyz - v.wp;
  let dist = length(toEye);
  let sunC = mix(vec3f(1.0, 0.55, 0.3), vec3f(1.0, 0.97, 0.9), smoothstep(0.0, 0.35, u.misc.x));
  let li = sunC * (0.55 + 0.45 * clamp(u.sun.xyz.y + 0.4, 0.0, 1.0)) * u.sun.w * 1.15
         + vec3f(0.25, 0.32, 0.42) * mix(0.15, 0.5, smoothstep(-0.1, 0.4, u.misc.x));
  var col = tex.rgb * v.tint * li;
  col = aerial(col, dist, -normalize(toEye));
  return vec4f(tonemap(col), tex.a * v.fade);
}
`;

const FALLSW = COMMON + /* wgsl */`
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) wp: vec3f,
};
struct FV { p: vec4f, uv: vec4f };
@group(0) @binding(2) var<storage, read> fv: array<FV>;
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let v = fv[vid];
  var o: VOut;
  o.wp = v.p.xyz;
  o.pos = u.vp * vec4f(v.p.xyz, 1.0);
  o.uv = v.uv.xy;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let t = u.eye.w;
  /* 竖直拉丝白水 + 三级台阶亮带 */
  let streak = fbm(vec2f(v.uv.x * 6.0, v.uv.y * 2.2 - t * 1.1));
  let streak2 = vnoise(vec2f(v.uv.x * 18.0, v.uv.y * 7.0 - t * 2.3));
  var a = smoothstep(0.32, 0.78, streak * 0.72 + streak2 * 0.28);
  a *= smoothstep(0.0, 0.12, v.uv.x) * smoothstep(1.0, 0.88, v.uv.x);   // 侧缘羽化
  a = clamp(a * 1.15, 0.0, 1.0);
  let toEye = u.eye.xyz - v.wp;
  let dist = length(toEye);
  var col = vec3f(0.94, 0.97, 1.0) * (0.75 + 0.45 * u.sun.w * clamp(u.misc.x + 0.4, 0.2, 1.0));
  col += vec3f(0.2) * streak2;
  col = aerial(col, dist, -normalize(toEye));
  return vec4f(tonemap(col) * a, a);
}
`;

const MIST = COMMON + /* wgsl */`
struct Inst { p: vec4f, q: vec4f };  // p: base xyz + size, q: phase, speed, 0,0
@group(0) @binding(2) var<storage, read> inst: array<Inst>;
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) a: f32,
  @location(2) wp: vec3f,
};
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VOut {
  let it = inst[iid];
  let corner = vid % 6u;
  var lx = 0.0; var ly = 0.0;
  if (corner == 1u || corner == 4u || corner == 5u) { lx = 1.0; }
  if (corner == 2u || corner == 3u || corner == 5u) { ly = 1.0; }
  let cyc = fract(u.eye.w * it.q.y + it.q.x);
  let size = it.p.w * (0.6 + cyc * 1.2);
  /* 面向相机的公告板 */
  let fwd = normalize(u.eye.xyz - it.p.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let wp = it.p.xyz + right * (lx - 0.5) * size + up * ((ly - 0.3) * size * 0.7 + cyc * it.p.w * 1.4);
  var o: VOut;
  o.wp = wp;
  o.pos = u.vp * vec4f(wp, 1.0);
  o.uv = vec2f(lx, ly);
  o.a = (1.0 - cyc) * 0.35;
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let d = length(v.uv - vec2f(0.5));
  var a = smoothstep(0.5, 0.12, d) * v.a;
  let toEye = u.eye.xyz - v.wp;
  var col = vec3f(0.9, 0.94, 1.0) * (0.5 + 0.5 * clamp(u.misc.x + 0.3, 0.0, 1.0));
  col = aerial(col, length(toEye), -normalize(toEye));
  return vec4f(tonemap(col) * a, a);
}
`;

/* ---------- 初始化 ---------- */
let device, ctx, format, uni, uniBuf, hBuf, depthTex, depthW = 0, depthH = 0;
let pTerrain, pSky, pTrees, pFalls, pMist;
let bgTerrain, bgSky, bgTrees, bgFalls, bgMist;
let treeCount = 0, fallVerts = 0, mistCount = 0;
let meta, HGT;   // Float32Array 高程（米）
let qsSet = null, qsBuf = null, qsRead = null, gpuMs = 0;

const cam = { x: 0, y: 1400, z: 0, yaw: 0, pitch: -0.12, speed: 60, walk: false };
let timeOfDay = 8.2, autoTime = false, fogK = 0.000036, wind = 1.0, dbgMode = 0;
const keys = {};
let tPrev = performance.now() / 1000, simT = 0;
let fpsE = 60;

function lonlat2xz(lon, lat) {
  return [ (lon - meta.lon0) / (meta.lon1 - meta.lon0) * meta.mx,
           (meta.lat1 - lat) / (meta.lat1 - meta.lat0) * meta.my ];
}
function xz2lonlat(x, z) {
  return [ meta.lon0 + x / meta.mx * (meta.lon1 - meta.lon0),
           meta.lat1 - z / meta.my * (meta.lat1 - meta.lat0) ];
}
function groundAt(x, z) {
  const n = meta.n;
  const fx = Math.min(Math.max(x / meta.mx, 0), 1) * (n - 1);
  const fz = Math.min(Math.max(z / meta.my, 0), 1) * (n - 1);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, n - 1), z1 = Math.min(z0 + 1, n - 1);
  const ax = fx - x0, az = fz - z0;
  const h = (HGT[z0 * n + x0] * (1 - ax) + HGT[z0 * n + x1] * ax) * (1 - az)
          + (HGT[z1 * n + x0] * (1 - ax) + HGT[z1 * n + x1] * ax) * az;
  return h;
}

function fail(msg) {
  hud.textContent = msg;
  const ng = $('lab-nogpu');
  if (ng) { ng.hidden = false; ng.textContent = msg + ' —— 需要支持 WebGPU 的浏览器（Chrome/Edge 113+）。'; }
}

async function init() {
  if (!navigator.gpu) { fail('此浏览器不支持 WebGPU'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('拿不到 GPU adapter'); return; }
  const hasTS = adapter.features.has('timestamp-query');
  device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
  ctx = cvs.getContext('webgpu');
  format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  hud.textContent = '加载庐山 DEM…';
  const [mj, hb] = await Promise.all([
    fetch('/data/lushan/meta.json').then((r) => r.json()),
    fetch('/data/lushan/height.bin').then((r) => r.arrayBuffer()),
  ]);
  meta = mj;
  const raw = new Uint16Array(hb);
  HGT = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) HGT[i] = raw[i] * meta.scale + meta.offset;

  hBuf = device.createBuffer({ size: HGT.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(hBuf, 0, HGT);
  uniBuf = device.createBuffer({ size: 52 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  uni = new Float32Array(52);

  /* 树实例：按海拔/坡度/斑块噪声散布 */
  const inst = buildTrees();
  const treeBuf = device.createBuffer({ size: Math.max(inst.byteLength, 32), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(treeBuf, 0, inst);
  const atlas = buildAtlas();
  const atlasTex = device.createTexture({ size: [atlas.width, atlas.height, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  device.queue.copyExternalImageToTexture({ source: atlas }, { texture: atlasTex }, [atlas.width, atlas.height]);
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  /* 瀑布条带 + 雾气 */
  const fallsData = buildFalls();
  const fallBuf = device.createBuffer({ size: Math.max(fallsData.verts.byteLength, 32), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(fallBuf, 0, fallsData.verts);
  fallVerts = fallsData.count;
  const mist = fallsData.mist;
  const mistBuf = device.createBuffer({ size: Math.max(mist.byteLength, 32), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(mistBuf, 0, mist);
  mistCount = mist.length / 8;

  const mk = (code, opts) => {
    const mod = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [Object.assign({ format }, opts.blend ? { blend: opts.blend } : {})] },
      primitive: { topology: 'triangle-list', cullMode: opts.cull || 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: opts.depthWrite !== false, depthCompare: opts.depthCompare || 'less' },
    });
  };
  const alphaBlend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  pSky = mk(SKY, { depthWrite: false, depthCompare: 'less-equal' });
  pTerrain = mk(TERRAIN, { cull: 'back' });
  pTrees = mk(TREES, {});
  pFalls = mk(FALLSW, { blend: alphaBlend, depthWrite: false });
  pMist = mk(MIST, { blend: alphaBlend, depthWrite: false });

  /* 注意：layout:'auto' 会剥离 shader 里声明但未读取的绑定，各组只绑实际用到的 */
  bgSky = device.createBindGroup({ layout: pSky.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } } ] });
  bgTerrain = device.createBindGroup({ layout: pTerrain.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } }, { binding: 1, resource: { buffer: hBuf } } ] });
  bgTrees = device.createBindGroup({ layout: pTrees.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } },
    { binding: 2, resource: { buffer: treeBuf } }, { binding: 3, resource: atlasTex.createView() },
    { binding: 4, resource: samp } ] });
  bgFalls = device.createBindGroup({ layout: pFalls.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } },
    { binding: 2, resource: { buffer: fallBuf } } ] });
  bgMist = device.createBindGroup({ layout: pMist.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uniBuf } },
    { binding: 2, resource: { buffer: mistBuf } } ] });

  if (hasTS) {
    qsSet = device.createQuerySet({ type: 'timestamp', count: 2 });
    qsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    qsRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  setupUI();
  applyQuery();
  buildMinimap();
  requestAnimationFrame(frame);
}

/* ---------- 内容生成 ---------- */
function buildTrees() {
  const target = 130000;
  const out = new Float32Array(target * 8);
  let n = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const noise = (x, z) => {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  let guard = 0;
  while (n < target && guard++ < target * 12) {
    const x = rnd() * meta.mx;
    const z = rnd() * meta.my;
    const h = groundAt(x, z);
    if (h < 16 || h > 1240) continue;
    const fx = x / meta.mx, fz = z / meta.my;
    if (h < 14 && (fx > 0.63 || (fz > 0.76 && fx > 0.44))) continue;
    const e = 40;
    const sl = Math.abs(groundAt(x + e, z) - groundAt(x - e, z)) + Math.abs(groundAt(x, z + e) - groundAt(x, z - e));
    if (sl > 55) continue;                                  // 陡崖不长树
    const patch = noise(Math.floor(x / 900), Math.floor(z / 900));
    if (rnd() > 0.35 + patch * 0.6) continue;               // 林斑
    const o = n * 8;
    out[o] = x; out[o + 1] = h - 0.4; out[o + 2] = z;
    out[o + 3] = 2.2 + rnd() * 2.6 + (h > 900 ? -0.8 : 0);  // 尺寸（高山树小）
    out[o + 4] = (h > 750 || rnd() < 0.35) ? 0 : 1;         // 0 针叶 1 阔叶
    out[o + 5] = rnd();
    out[o + 6] = rnd() * 6.283;
    out[o + 7] = 0;
    n++;
  }
  treeCount = n;
  return out.subarray(0, n * 8);
}
function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  /* 针叶（左）：层叠三角 */
  g.save(); g.translate(128, 0);
  g.fillStyle = '#1d3a17';
  g.fillRect(-7, 170, 14, 80);
  for (let i = 0; i < 6; i++) {
    const y = 30 + i * 34, w = 30 + i * 17;
    g.beginPath(); g.moveTo(0, y - 26); g.lineTo(-w, y + 26); g.lineTo(w, y + 26); g.closePath();
    g.fillStyle = i % 2 ? '#224618' : '#1e4015';
    g.fill();
  }
  for (let i = 0; i < 260; i++) {
    const t = Math.random(), y = 20 + t * 200, w = 28 + t * 96;
    g.fillStyle = 'rgba(52,96,40,' + (0.25 + Math.random() * 0.4) + ')';
    g.fillRect((Math.random() * 2 - 1) * w, y, 3, 7);
  }
  g.restore();
  /* 阔叶（右）：团簇 */
  g.save(); g.translate(384, 0);
  g.fillStyle = '#4a3520';
  g.fillRect(-8, 150, 16, 100);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * 6.283, r = Math.random() * 78;
    const x = Math.cos(a) * r, y = 92 + Math.sin(a) * r * 0.78;
    const rad = 20 + Math.random() * 26;
    const gr = g.createRadialGradient(x - 6, y - 8, 2, x, y, rad);
    gr.addColorStop(0, 'rgba(70,116,44,0.95)');
    gr.addColorStop(1, 'rgba(26,62,24,0.88)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
  }
  g.restore();
  return c;
}
function buildFalls() {
  const segs = 26, verts = [], mist = [];
  for (const f of FALLS) {
    const [tx, tz] = lonlat2xz(f.top[0], f.top[1]);
    const [bx, bz] = lonlat2xz(f.bot[0], f.bot[1]);
    const ty = groundAt(tx, tz), by = groundAt(bx, bz);
    const dx = bx - tx, dz = bz - tz;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len, nz = dx / len;    // 横向
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const x = tx + dx * t, z = tz + dz * t;
      const yLine = ty + (by - ty) * (t * t * (3 - 2 * t));
      const y = Math.max(yLine, groundAt(x, z) + 0.4);
      pts.push([x, y + 1.5, z]);
    }
    for (let i = 0; i < segs; i++) {
      const w0 = f.w * (0.55 + 0.45 * (i / segs));
      const w1 = f.w * (0.55 + 0.45 * ((i + 1) / segs));
      const a = pts[i], b = pts[i + 1];
      const v0 = [a[0] - nx * w0 / 2, a[1], a[2] - nz * w0 / 2, 0, 0, i / segs, 0, 0];
      const v1 = [a[0] + nx * w0 / 2, a[1], a[2] + nz * w0 / 2, 0, 1, i / segs, 0, 0];
      const v2 = [b[0] - nx * w1 / 2, b[1], b[2] - nz * w1 / 2, 0, 0, (i + 1) / segs, 0, 0];
      const v3 = [b[0] + nx * w1 / 2, b[1], b[2] + nz * w1 / 2, 0, 1, (i + 1) / segs, 0, 0];
      verts.push(...v0, ...v1, ...v2, ...v2, ...v1, ...v3);
    }
    /* 底部雾气 */
    for (let m = 0; m < 26; m++) {
      mist.push(bx + (Math.random() - 0.5) * f.w * 2.2, by + 2, bz + (Math.random() - 0.5) * f.w * 2.2,
        10 + Math.random() * 16, Math.random(), 0.10 + Math.random() * 0.10, 0, 0);
    }
  }
  return { verts: new Float32Array(verts), count: verts.length / 8, mist: new Float32Array(mist) };
}

/* ---------- UI / 交互 ---------- */
let gridStep = 1;
function setupUI() {
  cvs.addEventListener('click', () => { if (!document.pointerLockElement) cvs.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => {});
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== cvs) return;
    cam.yaw -= e.movementX * 0.0022;
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch - e.movementY * 0.0022));
  });
  /* 触屏拖动看向 */
  let tX = 0, tY = 0, tOn = false;
  cvs.addEventListener('touchstart', (e) => { tOn = true; tX = e.touches[0].clientX; tY = e.touches[0].clientY; }, { passive: true });
  cvs.addEventListener('touchmove', (e) => {
    if (!tOn) return;
    cam.yaw -= (e.touches[0].clientX - tX) * 0.004;
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch - (e.touches[0].clientY - tY) * 0.004));
    tX = e.touches[0].clientX; tY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (e.code === 'KeyF') { cam.walk = !cam.walk; $('lu-mode').value = cam.walk ? 'walk' : 'fly'; }
    if (e.code === 'KeyT') autoTime = !autoTime;
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.speed = Math.max(2, Math.min(600, cam.speed * (e.deltaY > 0 ? 0.85 : 1.18)));
  }, { passive: false });

  $('lu-time').addEventListener('input', () => { timeOfDay = parseFloat($('lu-time').value); autoTime = false; });
  $('lu-fog').addEventListener('input', () => { fogK = parseFloat($('lu-fog').value) * 1e-6; });
  $('lu-quality').addEventListener('change', () => { gridStep = parseInt($('lu-quality').value, 10); });
  $('lu-mode').addEventListener('change', () => { cam.walk = $('lu-mode').value === 'walk'; });
  $('lu-auto').addEventListener('change', () => { autoTime = $('lu-auto').checked; });
  document.querySelectorAll('.lu-tp').forEach((b) => b.addEventListener('click', () =>

    teleport(b.getAttribute('data-m'))));
}
function teleport(id) {
  const m = MARKS.find((x) => x.id === id);
  if (!m) return;
  const [x, z] = lonlat2xz(m.lon, m.lat);
  const back = 520;
  cam.x = x; cam.z = z + back;
  const gy = groundAt(cam.x, cam.z);
  const ty = groundAt(x, z) + m.dy;
  cam.y = Math.max(gy + 3, ty + 140);
  cam.yaw = 0;                     // 朝北（-z）看向目标
  cam.pitch = Math.atan2(ty - cam.y, back) * 0.8;
  cam.walk = false;
  $('lu-mode').value = 'fly';
}
function applyQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('t')) { timeOfDay = parseFloat(q.get('t')) || timeOfDay; }
  if (q.get('q')) { gridStep = { high: 1, med: 2, low: 4 }[q.get('q')] || 1; $('lu-quality').value = String(gridStep); }
  teleport(q.get('view') || 'hanpokou');
  if (q.get('t')) $('lu-time').value = String(timeOfDay);
  if (q.get('fog')) { fogK = parseFloat(q.get('fog')) * 1e-6; $('lu-fog').value = q.get('fog'); }
  if (q.get('alt')) cam.y = parseFloat(q.get('alt'));
  if (q.get('pitch')) cam.pitch = parseFloat(q.get('pitch'));
  if (q.get('yaw')) cam.yaw = parseFloat(q.get('yaw'));
  if (q.get('dbg')) dbgMode = parseFloat(q.get('dbg'));
}

/* ---------- 小地图 ---------- */
let mmBase = null;
function buildMinimap() {
  const mm = $('lu-map');
  const n = 192;
  mm.width = n; mm.height = n;
  const g = mm.getContext('2d');
  const img = g.createImageData(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = j / (n - 1) * meta.mx, z = i / (n - 1) * meta.my;
      const h = groundAt(x, z);
      const e = 90;
      const dx = groundAt(x + e, z) - groundAt(x - e, z);
      const dz = groundAt(x, z + e) - groundAt(x, z - e);
      const shade = Math.max(0.25, Math.min(1.25, 0.85 - dx * 0.004 + dz * 0.003));
      let r, gg, b;
      const inLake = (j / (n - 1)) > 0.63 || ((i / (n - 1)) > 0.76 && (j / (n - 1)) > 0.44);
      if (h < 12.5 && inLake) { r = 34; gg = 60; b = 78; }
      else if (h < 120) { r = 74; gg = 96; b = 52; }
      else if (h < 700) { r = 44; gg = 84; b = 44; }
      else if (h < 1150) { r = 96; gg = 96; b = 70; }
      else { r = 150; gg = 142; b = 128; }
      const o = (i * n + j) * 4;
      img.data[o] = r * shade; img.data[o + 1] = gg * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mmBase = document.createElement('canvas');
  mmBase.width = n; mmBase.height = n;
  mmBase.getContext('2d').drawImage(mm, 0, 0);
  mm.addEventListener('click', (e) => {
    const r = mm.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * meta.mx;
    const z = (e.clientY - r.top) / r.height * meta.my;
    cam.x = x; cam.z = z;
    cam.y = groundAt(x, z) + 260;
    cam.walk = false;
  });
}
function drawMinimap() {
  const mm = $('lu-map');
  const g = mm.getContext('2d');
  g.drawImage(mmBase, 0, 0);
  const px = cam.x / meta.mx * mm.width, pz = cam.z / meta.my * mm.height;
  g.save();
  g.translate(px, pz);
  g.rotate(-cam.yaw);
  g.fillStyle = '#ff8a1e';
  g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
  g.restore();
}

/* ---------- 帧循环 ---------- */
function frame() {
  const tNow = performance.now() / 1000;
  let dt = Math.min(tNow - tPrev, 0.05);
  tPrev = tNow;
  simT += dt;
  fpsE = fpsE * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
  if (autoTime) {
    timeOfDay += dt * 0.35;
    if (timeOfDay > 19.4) timeOfDay = 5.2;
    $('lu-time').value = String(timeOfDay);
  }

  /* 移动 */
  const boost = (keys.ShiftLeft || keys.ShiftRight) ? 4 : 1;
  const sp = cam.walk ? 4.2 * boost : cam.speed * boost;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sP = Math.sin(cam.pitch);
  const fwd3 = cam.walk ? [-sy, 0, -cy] : [-sy * cp, sP, -cy * cp];
  const rt3 = [cy, 0, -sy];
  let f = 0, r = 0, upv = 0;
  if (keys.KeyW) f += 1;
  if (keys.KeyS) f -= 1;
  if (keys.KeyD) r += 1;
  if (keys.KeyA) r -= 1;
  if ($('lu-fwd') && $('lu-fwd').checked) f += 1;
  if (!cam.walk) {
    if (keys.Space) upv += 1;
    if (keys.KeyC) upv -= 1;
  }
  cam.x += (fwd3[0] * f + rt3[0] * r) * sp * dt;
  cam.y += (fwd3[1] * f + upv) * sp * dt;
  cam.z += (fwd3[2] * f + rt3[2] * r) * sp * dt;
  cam.x = Math.max(50, Math.min(meta.mx - 50, cam.x));
  cam.z = Math.max(50, Math.min(meta.my - 50, cam.z));
  const gy = groundAt(cam.x, cam.z);
  if (cam.walk) cam.y = Math.max(gy, 12.5) + 1.7;
  else cam.y = Math.max(cam.y, gy + 2);

  /* 相机矩阵 */
  const dw = cvs.clientWidth, dh = cvs.clientHeight;
  const pw = Math.max(1, Math.floor(dw * devicePixelRatio));
  const ph = Math.max(1, Math.floor(dh * devicePixelRatio));
  if (cvs.width !== pw || cvs.height !== ph) { cvs.width = pw; cvs.height = ph; }
  if (depthW !== pw || depthH !== ph) {
    if (depthTex) depthTex.destroy();
    depthTex = device.createTexture({ size: [pw, ph], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    depthW = pw; depthH = ph;
  }
  const fwd = [ -Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch) ];
  const eye = [cam.x, cam.y, cam.z];
  const view = mat4.lookAt(eye, vec3.add(eye, fwd), [0, 1, 0]);
  const proj = mat4.perspective(62 * Math.PI / 180, pw / ph, 1.5, 60000);
  const vp = mat4.multiply(proj, view);
  const ivp = mat4.invert(vp);

  /* 太阳 */
  const tt = Math.max(5.0, Math.min(19.5, timeOfDay));
  const dayF = (tt - 5.2) / (19.4 - 5.2);
  const elev = Math.sin(dayF * Math.PI) * (68 * Math.PI / 180);
  const az = (80 + dayF * 200) * Math.PI / 180;      // 东→西
  const sunDir = [Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)];
  const sunI = Math.max(0, Math.min(1, (Math.sin(elev) + 0.12) * 2.2));

  uni.set(vp, 0);
  uni.set(ivp, 16);
  uni.set([cam.x, cam.y, cam.z, simT], 32);
  uni.set([sunDir[0], sunDir[1], sunDir[2], sunI], 36);
  uni.set([meta.mx, meta.my, meta.n, meta.mx / meta.n], 40);
  uni.set([fogK, 12.5, gridStep, wind], 44);
  uni.set([Math.sin(elev), 1.05, dbgMode, 0], 48);
  device.queue.writeBuffer(uniBuf, 0, uni);

  render();
  updateHUD(sunI);
  drawMinimap();
  updateLabels(vp, dw, dh);
  requestAnimationFrame(frame);
}

function render() {
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    depthStencilAttachment: { view: depthTex.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
    timestampWrites: qsSet ? { querySet: qsSet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined,
  });
  pass.setPipeline(pSky); pass.setBindGroup(0, bgSky); pass.draw(3);
  const cells = Math.floor((meta.n - 1) / gridStep);
  pass.setPipeline(pTerrain); pass.setBindGroup(0, bgTerrain); pass.draw(cells * cells * 6);
  pass.setPipeline(pTrees); pass.setBindGroup(0, bgTrees); pass.draw(12, treeCount);
  pass.setPipeline(pFalls); pass.setBindGroup(0, bgFalls); pass.draw(fallVerts);
  pass.setPipeline(pMist); pass.setBindGroup(0, bgMist); pass.draw(6, mistCount);
  pass.end();
  if (qsSet) {
    enc.resolveQuerySet(qsSet, 0, 2, qsBuf, 0);
    if (qsRead.mapState === 'unmapped') enc.copyBufferToBuffer(qsBuf, 0, qsRead, 0, 16);
  }
  device.queue.submit([enc.finish()]);
  if (qsSet && qsRead.mapState === 'unmapped') {
    qsRead.mapAsync(GPUMapMode.READ).then(() => {
      const a = new BigInt64Array(qsRead.getMappedRange());
      gpuMs = Number(a[1] - a[0]) / 1e6;
      qsRead.unmap();
    }).catch(() => {});
  }
}

let hudT = 0;
function updateHUD() {
  if (performance.now() - hudT < 250) return;
  hudT = performance.now();
  const [lon, lat] = xz2lonlat(cam.x, cam.z);
  const cells = Math.floor((meta.n - 1) / gridStep);
  const tris = cells * cells * 2 + treeCount * 4;
  hud.textContent =
    lat.toFixed(4) + '°N ' + lon.toFixed(4) + '°E · 海拔 ' + Math.round(cam.y) + 'm · ' +
    (cam.walk ? '步行' : '飞行 ' + Math.round(cam.speed) + 'm/s') +
    ' · ' + (timeOfDay | 0) + ':' + String(Math.round(timeOfDay % 1 * 60)).padStart(2, '0') +
    ' · ' + Math.round(fpsE) + ' fps' + (gpuMs ? ' · GPU ' + gpuMs.toFixed(1) + 'ms' : '') +
    ' · ' + (tris / 1e6).toFixed(1) + 'M tris';
}

function updateLabels(vp, dw, dh) {
  const layer = $('lu-labels');
  for (const m of MARKS) {
    let el = m._el;
    if (!el) {
      el = document.createElement('div');
      el.className = 'lu-label mono';
      el.textContent = m.name;
      layer.appendChild(el);
      m._el = el;
      const [x, z] = lonlat2xz(m.lon, m.lat);
      m._x = x; m._z = z; m._y = groundAt(x, z) + m.dy + 26;
    }
    const p = [m._x, m._y, m._z, 1];
    const cx2 = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const cy2 = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const cw2 = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    const dx2 = m._x - cam.x, dz2 = m._z - cam.z;
    const dist = Math.hypot(dx2, dz2);
    if (cw2 <= 0 || dist > 26000) { el.style.display = 'none'; continue; }
    el.style.display = 'block';
    el.style.left = ((cx2 / cw2 * 0.5 + 0.5) * dw) + 'px';
    el.style.top = ((-cy2 / cw2 * 0.5 + 0.5) * dh) + 'px';
    el.style.opacity = String(Math.max(0.25, 1 - dist / 26000));
  }
}

init().catch((e) => fail('初始化失败：' + e.message));
