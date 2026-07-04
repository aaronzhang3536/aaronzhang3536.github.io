/* 3D 流体（烟雾）— 裸 WebGPU：三维欧拉网格（平流/浮力/涡量约束/压力投影）
   + 体积光线步进渲染（吸收 + 朝光源的二次步进阴影） */

/* 模拟 uniform：
   a: x dt, y 速度耗散, z 密度耗散, w 涡量强度
   b: xyz 源1位置(uvw), w 注入量
   c: xyz 源2位置(uvw), w 浮力
   d: xyz 源1颜色, w 时间
   e: xyz 源2颜色, w 未用 */
const FU_DECL = /* wgsl */ `
struct FU { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f };
`;

const ADVECT_VEL_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var src: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (any(id >= dim)) { return; }
  let uvw = (vec3f(id) + 0.5) / vec3f(dim);
  let v = textureSampleLevel(src, samp, uvw, 0.0).xyz;
  let q = uvw - fu.a.x * v;
  let nv = textureSampleLevel(src, samp, q, 0.0).xyz * fu.a.y;
  textureStore(dst, id, vec4f(nv, 0.0));
}`;

const INJECT_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var velIn: texture_3d<f32>;
@group(0) @binding(2) var denIn: texture_3d<f32>;
@group(0) @binding(3) var velOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(4) var denOut: texture_storage_3d<rgba16float, write>;

fn plume(uvw: vec3f, srcP: vec3f, aspect: vec3f) -> f32 {
  var off = (uvw - srcP) * aspect;
  return exp(-dot(off, off) / (0.055 * 0.055));
}

@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (any(id >= dim)) { return; }
  let uvw = (vec3f(id) + 0.5) / vec3f(dim);
  let aspect = vec3f(dim) / f32(dim.x);
  var v = textureLoad(velIn, id, 0).xyz;
  var d = textureLoad(denIn, id, 0);

  let g1 = plume(uvw, fu.b.xyz, aspect);
  let g2 = plume(uvw, fu.c.xyz, aspect);
  let inj = fu.b.w * fu.a.x;
  d += vec4f(fu.d.xyz, 1.0) * g1 * inj * 14.0;
  d += vec4f(fu.e.xyz, 1.0) * g2 * inj * 14.0;

  /* 注入初速：向上 + 绕源心轻微切向旋 */
  let sw1 = cross(vec3f(0.0, 1.0, 0.0), (uvw - fu.b.xyz) * aspect);
  let sw2 = cross(vec3f(0.0, -1.0, 0.0), (uvw - fu.c.xyz) * aspect);
  v += (vec3f(0.0, 0.55, 0.0) + sw1 * 2.2) * g1 * fu.a.x * 8.0;
  v += (vec3f(0.0, 0.55, 0.0) + sw2 * 2.2) * g2 * fu.a.x * 8.0;

  /* 浮力：密度越浓升得越快（同时受轻微冷却下沉项平衡） */
  v.y += (fu.c.w * d.a - 0.06) * fu.a.x;

  textureStore(velOut, id, vec4f(v, 0.0));
  textureStore(denOut, id, d);
}`;

const CURL_WGSL = /* wgsl */ `
@group(0) @binding(0) var vel: texture_3d<f32>;
@group(0) @binding(1) var dst: texture_storage_3d<rgba16float, write>;
fn V(p: vec3i, dim: vec3u) -> vec3f {
  let q = clamp(p, vec3i(0), vec3i(dim) - 1);
  return textureLoad(vel, q, 0).xyz;
}
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (any(id >= dim)) { return; }
  let p = vec3i(id);
  let dx = vec3i(1, 0, 0); let dy = vec3i(0, 1, 0); let dz = vec3i(0, 0, 1);
  let c = 0.5 * vec3f(
    V(p + dy, dim).z - V(p - dy, dim).z - V(p + dz, dim).y + V(p - dz, dim).y,
    V(p + dz, dim).x - V(p - dz, dim).x - V(p + dx, dim).z + V(p - dx, dim).z,
    V(p + dx, dim).y - V(p - dx, dim).y - V(p + dy, dim).x + V(p - dy, dim).x);
  textureStore(dst, id, vec4f(c, length(c)));
}`;

const VORT_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var velIn: texture_3d<f32>;
@group(0) @binding(2) var curlT: texture_3d<f32>;
@group(0) @binding(3) var velOut: texture_storage_3d<rgba16float, write>;
fn CW(p: vec3i, dim: vec3u) -> f32 {
  let q = clamp(p, vec3i(0), vec3i(dim) - 1);
  return textureLoad(curlT, q, 0).w;
}
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (any(id >= dim)) { return; }
  let p = vec3i(id);
  let dx = vec3i(1, 0, 0); let dy = vec3i(0, 1, 0); let dz = vec3i(0, 0, 1);
  var grad = 0.5 * vec3f(
    CW(p + dx, dim) - CW(p - dx, dim),
    CW(p + dy, dim) - CW(p - dy, dim),
    CW(p + dz, dim) - CW(p - dz, dim));
  grad = grad / (length(grad) + 1e-5);
  let w = textureLoad(curlT, id, 0).xyz;
  var v = textureLoad(velIn, id, 0).xyz;
  v += fu.a.w * cross(grad, w) * fu.a.x;
  textureStore(velOut, id, vec4f(v, 0.0));
}`;

const DIV_WGSL = /* wgsl */ `
@group(0) @binding(0) var vel: texture_3d<f32>;
@group(0) @binding(1) var dst: texture_storage_3d<r32float, write>;
fn V(p: vec3i, dim: vec3u) -> vec3f {
  let q = clamp(p, vec3i(0), vec3i(dim) - 1);
  return textureLoad(vel, q, 0).xyz;
}
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (any(id >= dim)) { return; }
  let p = vec3i(id);
  let d = 0.5 * (V(p + vec3i(1, 0, 0), dim).x - V(p - vec3i(1, 0, 0), dim).x
               + V(p + vec3i(0, 1, 0), dim).y - V(p - vec3i(0, 1, 0), dim).y
               + V(p + vec3i(0, 0, 1), dim).z - V(p - vec3i(0, 0, 1), dim).z);
  textureStore(dst, id, vec4f(d, 0.0, 0.0, 0.0));
}`;

const JACOBI_WGSL = /* wgsl */ `
@group(0) @binding(0) var prIn: texture_3d<f32>;
@group(0) @binding(1) var divT: texture_3d<f32>;
@group(0) @binding(2) var prOut: texture_storage_3d<r32float, write>;
fn P(p: vec3i, dim: vec3u) -> f32 {
  let q = clamp(p, vec3i(0), vec3i(dim) - 1);
  return textureLoad(prIn, q, 0).x;
}
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(prOut);
  if (any(id >= dim)) { return; }
  let p = vec3i(id);
  let np = (P(p + vec3i(1, 0, 0), dim) + P(p - vec3i(1, 0, 0), dim)
          + P(p + vec3i(0, 1, 0), dim) + P(p - vec3i(0, 1, 0), dim)
          + P(p + vec3i(0, 0, 1), dim) + P(p - vec3i(0, 0, 1), dim)
          - textureLoad(divT, id, 0).x) / 6.0;
  textureStore(prOut, id, vec4f(np, 0.0, 0.0, 0.0));
}`;

const SUBGRAD_WGSL = /* wgsl */ `
@group(0) @binding(0) var velIn: texture_3d<f32>;
@group(0) @binding(1) var prT: texture_3d<f32>;
@group(0) @binding(2) var velOut: texture_storage_3d<rgba16float, write>;
fn P(p: vec3i, dim: vec3u) -> f32 {
  let q = clamp(p, vec3i(0), vec3i(dim) - 1);
  return textureLoad(prT, q, 0).x;
}
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (any(id >= dim)) { return; }
  let p = vec3i(id);
  var v = textureLoad(velIn, id, 0).xyz;
  v -= 0.5 * vec3f(
    P(p + vec3i(1, 0, 0), dim) - P(p - vec3i(1, 0, 0), dim),
    P(p + vec3i(0, 1, 0), dim) - P(p - vec3i(0, 1, 0), dim),
    P(p + vec3i(0, 0, 1), dim) - P(p - vec3i(0, 0, 1), dim));
  /* 六面封闭盒：边界一格速度清零 */
  if (any(id == vec3u(0u)) || any(id == dim - 1u)) { v = vec3f(0.0); }
  textureStore(velOut, id, vec4f(v, 0.0));
}`;

const ADVECT_DEN_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var den: texture_3d<f32>;
@group(0) @binding(2) var vel: texture_3d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dst: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(4, 4, 4)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (any(id >= dim)) { return; }
  let uvw = (vec3f(id) + 0.5) / vec3f(dim);
  let v = textureSampleLevel(vel, samp, uvw, 0.0).xyz;
  let q = uvw - fu.a.x * v;
  let d = textureSampleLevel(den, samp, q, 0.0) * fu.a.z;
  textureStore(dst, id, d);
}`;

/* 渲染 uniform：
   eye: xyz 相机, w tan(fov/2) · right: xyz, w aspect · up: xyz, w 步数
   fwd: xyz, w 密度倍率 · box: xyz 半长, w 时间 */
const SHOW_WGSL = /* wgsl */ `
struct RU { eye: vec4f, right: vec4f, up: vec4f, fwd: vec4f, box: vec4f };
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var den: texture_3d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VSOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

const LIGHT = vec3f(0.37, 0.84, 0.40);   // 已归一化的方向光

fn boxHit(ro: vec3f, rd: vec3f, half: vec3f) -> vec2f {
  let inv = 1.0 / rd;
  let t1 = (-half - ro) * inv;
  let t2 = (half - ro) * inv;
  let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));
  let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));
  return vec2f(tn, tf);
}
fn sampDen(p: vec3f, half: vec3f) -> vec4f {
  let uvw = p / (half * 2.0) + 0.5;
  return textureSampleLevel(den, samp, uvw, 0.0);
}
fn hash2(v: vec2f) -> f32 {
  return fract(sin(dot(v, vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let ro = ru.eye.xyz;
  let rd = normalize(ru.fwd.xyz
    + ru.right.xyz * in.ndc.x * ru.eye.w * ru.right.w
    + ru.up.xyz * in.ndc.y * ru.eye.w);

  /* 背景：暗色纵向渐变 */
  var bg = mix(vec3f(0.012, 0.014, 0.022), vec3f(0.035, 0.045, 0.07), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));

  let half = ru.box.xyz;
  let hit = boxHit(ro, rd, half);
  let tn = max(hit.x, 0.0);
  if (hit.y <= tn) { return vec4f(pow(bg, vec3f(1.0 / 2.2)), 1.0); }

  let steps = ru.up.w;
  let stepLen = (hit.y - tn) / steps;
  let jitter = hash2(in.ndc * 913.7 + ru.box.w) * stepLen;
  let shadowStep = length(half) * 0.14;

  var T = 1.0;
  var col = vec3f(0.0);
  for (var i = 0.0; i < steps; i += 1.0) {
    let p = ro + rd * (tn + jitter + stepLen * (i + 0.5));
    let s = sampDen(p, half);
    let a = s.a * ru.fwd.w * stepLen;
    if (a > 1e-4) {
      /* 朝光源的短步进求透过率（自阴影） */
      var Tl = 1.0;
      for (var j = 1.0; j <= 5.0; j += 1.0) {
        let q = p + LIGHT * shadowStep * j;
        Tl *= exp(-sampDen(q, half).a * ru.fwd.w * shadowStep * 0.9);
        if (Tl < 0.05) { break; }
      }
      let albedo = s.rgb / max(s.a, 1e-4);
      let li = vec3f(0.16, 0.18, 0.24) + vec3f(1.0, 0.96, 0.9) * 2.4 * Tl;
      let absorb = 1.0 - exp(-a);
      col += T * albedo * li * absorb;
      T *= exp(-a);
      if (T < 0.012) { break; }
    }
  }
  var c = col + bg * T;
  c = c / (1.0 + c) * 1.3;
  c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  return vec4f(c, 1.0);
}`;

const GRIDS = { 64: [64, 96, 64], 96: [96, 128, 96], 128: [128, 160, 128] };
const JACOBI = 16;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) {
    wgslEl.textContent =
      '// ---- 注入 + 浮力 ----' + INJECT_WGSL +
      '\n\n// ---- 3D 涡量约束 ----' + VORT_WGSL +
      '\n\n// ---- 体积渲染（吸收 + 自阴影） ----' + SHOW_WGSL;
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
  const W = wrapW, H = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const samp = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
  });
  const fuBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const advVelP = mkCP(ADVECT_VEL_WGSL);
  const injP = mkCP(INJECT_WGSL);
  const curlP = mkCP(CURL_WGSL);
  const vortP = mkCP(VORT_WGSL);
  const divP = mkCP(DIV_WGSL);
  const jacP = mkCP(JACOBI_WGSL);
  const subP = mkCP(SUBGRAD_WGSL);
  const advDenP = mkCP(ADVECT_DEN_WGSL);
  const showMod = device.createShaderModule({ code: SHOW_WGSL });
  const showP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: showMod, entryPoint: 'vs' },
    fragment: { module: showMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  /* 网格纹理与 bind group，可按分辨率重建。
     每帧固定乒乓：advVel v0→v1 · inject(v1,d0)→(v0,d1) · curl v0 · vort v0→v1
     · div v1 · jacobi p0↔p1 ×16（终回 p0） · subGrad(v1,p0)→v0 · advDen(d1,v0)→d0 */
  let GW = 0, GH = 0, GD = 0, texs = [], BGs = null;
  function rebuild(preset) {
    texs.forEach((t) => t.destroy());
    texs = [];
    const g = GRIDS[preset] || GRIDS[96];
    GW = g[0]; GH = g[1]; GD = g[2];
    const mkTex = (fmt) => {
      const t = device.createTexture({
        size: [GW, GH, GD], dimension: '3d', format: fmt,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      });
      texs.push(t);
      return t;
    };
    const vV = [mkTex('rgba16float').createView(), mkTex('rgba16float').createView()];
    const dV = [mkTex('rgba16float').createView(), mkTex('rgba16float').createView()];
    const pV = [mkTex('r32float').createView(), mkTex('r32float').createView()];
    const curlV = mkTex('rgba16float').createView();
    const divV = mkTex('r32float').createView();
    const bg = (pipe, entries) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: entries.map((r, i) => ({ binding: i, resource: r })),
    });
    const fuR = { buffer: fuBuf };
    BGs = {
      advVel: bg(advVelP, [fuR, vV[0], samp, vV[1]]),
      inj: bg(injP, [fuR, vV[1], dV[0], vV[0], dV[1]]),
      curl: bg(curlP, [vV[0], curlV]),
      vort: bg(vortP, [fuR, vV[0], curlV, vV[1]]),
      div: bg(divP, [vV[1], divV]),
      jac: [bg(jacP, [pV[0], divV, pV[1]]), bg(jacP, [pV[1], divV, pV[0]])],
      sub: bg(subP, [vV[1], pV[0], vV[0]]),
      advDen: bg(advDenP, [fuR, dV[1], vV[0], samp, dV[0]]),
      show: bg(showP, [{ buffer: ruBuf }, dV[0], samp]),
    };
  }

  /* GPU 计时：0-1 模拟 pass，2-3 渲染 pass */
  let qs = null, qBuf = null, readPool = [], simMs = 0, drawMs = 0;
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

  /* 交互：拖拽环绕 + 滚轮推拉 */
  const $ = (id) => document.getElementById(id);
  const ui = { buoy: $('f3-buoy'), vort: $('f3-vort'), inj: $('f3-inj'), grid: $('f3-grid') };
  let yaw = 0.5, pitch = 0.12, radius = 2.7;
  let dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => {
    dragging = true; px0 = e.clientX; py0 = e.clientY;
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.006;
    pitch = Math.max(-0.5, Math.min(1.1, pitch + (e.clientY - py0) * 0.004));
    px0 = e.clientX; py0 = e.clientY;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(1.7, Math.min(4.6, radius + e.deltaY * 0.0018));
  }, { passive: false });
  if (ui.grid) ui.grid.addEventListener('change', () => rebuild(parseInt(ui.grid.value, 10)));

  rebuild(parseInt((ui.grid && ui.grid.value) || '96', 10));

  const HALF = [0.5, 0.66, 0.5];
  const fuArr = new Float32Array(20);
  const ruArr = new Float32Array(20);
  let prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dt = Math.min((ts - prev) / 1000, 0.033) || 0.016;
    prev = ts;
    const t = ts / 1000;
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.05;

    const buoy = parseFloat((ui.buoy && ui.buoy.value) || '1.8');
    const vort = parseFloat((ui.vort && ui.vort.value) || '12');
    const inj = parseFloat((ui.inj && ui.inj.value) || '1.5');

    /* 两个彩色烟源在底部缓慢绕圈 */
    const a1 = t * 0.4, a2 = a1 + Math.PI;
    fuArr[0] = dt; fuArr[1] = 0.998; fuArr[2] = 0.992; fuArr[3] = vort;
    fuArr[4] = 0.5 + 0.2 * Math.cos(a1); fuArr[5] = 0.1; fuArr[6] = 0.5 + 0.2 * Math.sin(a1); fuArr[7] = inj;
    fuArr[8] = 0.5 + 0.2 * Math.cos(a2); fuArr[9] = 0.1; fuArr[10] = 0.5 + 0.2 * Math.sin(a2); fuArr[11] = buoy;
    fuArr[12] = 0.95; fuArr[13] = 0.38; fuArr[14] = 0.10; fuArr[15] = t;   // 暖橙
    fuArr[16] = 0.16; fuArr[17] = 0.52; fuArr[18] = 0.95; fuArr[19] = 0;   // 冷蓝
    device.queue.writeBuffer(fuBuf, 0, fuArr);

    /* 相机 */
    const eye = [
      Math.sin(yaw) * Math.cos(pitch) * radius,
      Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius,
    ];
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = norm([-eye[0], -eye[1], -eye[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    ruArr[0] = eye[0]; ruArr[1] = eye[1]; ruArr[2] = eye[2]; ruArr[3] = Math.tan(0.38);
    ruArr[4] = right[0]; ruArr[5] = right[1]; ruArr[6] = right[2]; ruArr[7] = cvs.width / cvs.height;
    ruArr[8] = up[0]; ruArr[9] = up[1]; ruArr[10] = up[2]; ruArr[11] = 64;
    ruArr[12] = fwd[0]; ruArr[13] = fwd[1]; ruArr[14] = fwd[2]; ruArr[15] = 22;
    ruArr[16] = HALF[0]; ruArr[17] = HALF[1]; ruArr[18] = HALF[2]; ruArr[19] = t % 37;
    device.queue.writeBuffer(ruBuf, 0, ruArr);

    const gx = Math.ceil(GW / 4), gy = Math.ceil(GH / 4), gz = Math.ceil(GD / 4);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    const run = (pipe, group) => {
      cp.setPipeline(pipe);
      cp.setBindGroup(0, group);
      cp.dispatchWorkgroups(gx, gy, gz);
    };
    run(advVelP, BGs.advVel);
    run(injP, BGs.inj);
    run(curlP, BGs.curl);
    run(vortP, BGs.vort);
    run(divP, BGs.div);
    for (let i = 0; i < JACOBI; i++) run(jacP, BGs.jac[i % 2]);
    run(subP, BGs.sub);
    run(advDenP, BGs.advDen);
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
      ...(canTime ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {}),
    });
    rp.setPipeline(showP);
    rp.setBindGroup(0, BGs.show);
    rp.draw(3);
    rp.end();

    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) {
        enc.resolveQuerySet(qs, 0, 4, qBuf, 0);
        enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 32);
      }
    }
    device.queue.submit([enc.finish()]);
    if (slot) {
      slot.busy = true;
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigInt64Array(slot.buf.getMappedRange());
        simMs += (Number(q[1] - q[0]) / 1e6 - simMs) * 0.1;
        drawMs += (Number(q[3] - q[2]) / 1e6 - drawMs) * 0.1;
        slot.buf.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (hud) {
      hud.textContent = GW + '×' + GH + '×' + GD + ' 体素 · ' +
        (canTime ? 'sim ' + simMs.toFixed(2) + ' ms · march ' + drawMs.toFixed(2) + ' ms · ' : '') +
        Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
