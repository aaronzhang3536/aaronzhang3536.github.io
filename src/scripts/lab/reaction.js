/* Gray-Scott 反应扩散 — 裸 WebGPU
   dU/dt = Du·∇²U − U·V² + F(1−U)
   dV/dt = Dv·∇²V + U·V² − (F+k)V
   同一组方程，只改 F/k 两个数，长出斑点、条纹、珊瑚、迷宫 */

const SIM_WGSL = /* wgsl */ `
struct RU {
  a: vec4f,   // x F, y k, z Du, w Dv
  b: vec4f,   // x dt, y 画笔uv.x, z 画笔uv.y, w 画笔半径(0=无)
};
@group(0) @binding(0) var<uniform> ru: RU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rg32float, write>;

fn S(p: vec2i, dim: vec2u) -> vec2f {
  /* 周期边界 */
  let d = vec2i(dim);
  let q = (p + d) % d;
  return textureLoad(src, q, 0).xy;
}

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let c = S(p, dim);
  /* 9 点拉普拉斯（中心 -1，边 0.2，角 0.05） */
  let lap = (S(p + vec2i(1, 0), dim) + S(p - vec2i(1, 0), dim)
           + S(p + vec2i(0, 1), dim) + S(p - vec2i(0, 1), dim)) * 0.2
          + (S(p + vec2i(1, 1), dim) + S(p + vec2i(1, -1), dim)
           + S(p + vec2i(-1, 1), dim) + S(p + vec2i(-1, -1), dim)) * 0.05
          - c;
  let uvv = c.x * c.y * c.y;
  var u = c.x + (ru.a.z * lap.x - uvv + ru.a.x * (1.0 - c.x)) * ru.b.x;
  var v = c.y + (ru.a.w * lap.y + uvv - (ru.a.x + ru.a.y) * c.y) * ru.b.x;
  /* 画笔：种一团 V */
  if (ru.b.w > 0.0) {
    let uv = vec2f(id.xy) / vec2f(dim);
    let off = uv - ru.b.yz;
    let asp = f32(dim.x) / f32(dim.y);
    if (dot(off * vec2f(asp, 1.0), off * vec2f(asp, 1.0)) < ru.b.w * ru.b.w) { v = 0.9; u = 0.1; }
  }
  textureStore(dst, id.xy, vec4f(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 0.0));
}`;

const SHOW_WGSL = /* wgsl */ `
struct VU { m: vec4f };   /* x 视图模式 */
@group(0) @binding(0) var<uniform> vu: VU;
@group(0) @binding(1) var src: texture_2d<f32>;
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
/* rg32float 不可过滤，手动双线性 */
fn bilerp(uv: vec2f) -> vec2f {
  let dim = vec2f(textureDimensions(src));
  let p = uv * dim - 0.5;
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let d = vec2i(dim);
  let a = textureLoad(src, clamp(i0, vec2i(0), d - 1), 0).xy;
  let b = textureLoad(src, clamp(i0 + vec2i(1, 0), vec2i(0), d - 1), 0).xy;
  let c = textureLoad(src, clamp(i0 + vec2i(0, 1), vec2i(0), d - 1), 0).xy;
  let e = textureLoad(src, clamp(i0 + vec2i(1, 1), vec2i(0), d - 1), 0).xy;
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let s = bilerp(in.uv);
  var c: vec3f;
  let m = u32(vu.m.x);
  if (m == 1u) {          /* U 浓度 */
    c = mix(vec3f(0.02, 0.03, 0.06), vec3f(0.9, 0.65, 0.25), s.x);
  } else if (m == 2u) {   /* V 浓度 */
    c = mix(vec3f(0.02, 0.03, 0.06), vec3f(0.3, 0.75, 0.95), s.y * 2.2);
  } else {                /* 伪彩色合成 */
    let t = clamp(s.y * 2.6, 0.0, 1.0);
    c = mix(vec3f(0.015, 0.02, 0.045), vec3f(0.06, 0.35, 0.5), smoothstep(0.0, 0.4, t));
    c = mix(c, vec3f(0.35, 0.85, 0.8), smoothstep(0.35, 0.7, t));
    c = mix(c, vec3f(0.95, 0.98, 0.9), smoothstep(0.65, 1.0, t));
  }
  return vec4f(pow(c, vec3f(1.0 / 2.2)), 1.0);
}`;

const PRESETS = {
  spots:  { zh: '斑点分裂', F: 0.030, k: 0.062 },
  coral:  { zh: '珊瑚生长', F: 0.058, k: 0.062 },
  maze:   { zh: '迷宫',     F: 0.029, k: 0.057 },
  stripe: { zh: '指纹条纹', F: 0.022, k: 0.051 },
  worms:  { zh: '蠕虫',     F: 0.046, k: 0.063 },
  chaos:  { zh: '扰动混沌', F: 0.026, k: 0.055 },
};

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) wgslEl.textContent = SIM_WGSL;
  function fail(msg) {
    if (hud) hud.textContent = '';
    if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; }
    cvs.style.display = 'none';
  }
  if (!navigator.gpu) { fail('当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge / Firefox 打开这个实验。'); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('WebGPU adapter 请求失败。'); return; }
  const device = await adapter.requestDevice();

  const SW = 640, SH = 360;
  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, Hc = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(Hc * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const mkTex = () => device.createTexture({
    size: [SW, SH], format: 'rg32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const texA = mkTex(), texB = mkTex();
  const vA = texA.createView(), vB = texB.createView();

  const ruBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const vuBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simP = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: SIM_WGSL }), entryPoint: 'cs' },
  });
  const showMod = device.createShaderModule({ code: SHOW_WGSL });
  const showP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: showMod, entryPoint: 'vs' },
    fragment: { module: showMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bg = (pipe, entries) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: entries.map((r, i) => ({ binding: i, resource: r })),
  });
  const simBG = [bg(simP, [{ buffer: ruBuf }, vA, vB]), bg(simP, [{ buffer: ruBuf }, vB, vA])];
  const showBG = [bg(showP, [{ buffer: vuBuf }, vA]), bg(showP, [{ buffer: vuBuf }, vB])];

  function seed() {
    const init = new Float32Array(SW * SH * 2);
    for (let i = 0; i < SW * SH; i++) init[i * 2] = 1;
    /* 中央几个随机小方块种 V */
    for (let b = 0; b < 6; b++) {
      const cx = 100 + Math.floor(Math.random() * (SW - 200));
      const cy = 60 + Math.floor(Math.random() * (SH - 120));
      for (let y = -4; y <= 4; y++)
        for (let x = -4; x <= 4; x++) {
          const i = (cy + y) * SW + cx + x;
          init[i * 2] = 0.4;
          init[i * 2 + 1] = 0.6;
        }
    }
    device.queue.writeTexture({ texture: texA }, init, { bytesPerRow: SW * 8 }, [SW, SH]);
    device.queue.writeTexture({ texture: texB }, init, { bytesPerRow: SW * 8 }, [SW, SH]);
  }

  const $ = (id) => document.getElementById(id);
  const ui = { preset: $('rd-preset'), F: $('rd-f'), k: $('rd-k'), speed: $('rd-speed'), view: $('rd-view'), reset: $('rd-reset'), fv: $('rd-fv'), kv: $('rd-kv') };
  function applyPreset() {
    const p = PRESETS[(ui.preset && ui.preset.value) || 'coral'];
    if (ui.F) ui.F.value = String(p.F);
    if (ui.k) ui.k.value = String(p.k);
  }
  if (ui.preset) ui.preset.addEventListener('change', applyPreset);
  if (ui.reset) ui.reset.addEventListener('click', seed);
  let brush = null;
  const uvOf = (e) => {
    const r = cvs.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  let down = false;
  cvs.addEventListener('pointerdown', (e) => { down = true; brush = uvOf(e); cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => { if (down) brush = uvOf(e); });
  cvs.addEventListener('pointerup', () => { down = false; brush = null; });
  cvs.addEventListener('pointercancel', () => { down = false; brush = null; });

  applyPreset();
  seed();

  let ping = 0, gen = 0, prev = 0, fps = 60;
  const ruArr = new Float32Array(8);
  const vuArr = new Float32Array(4);

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.05) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;

    const F = parseFloat((ui.F && ui.F.value) || '0.058');
    const kk = parseFloat((ui.k && ui.k.value) || '0.062');
    const steps = parseInt((ui.speed && ui.speed.value) || '12', 10);
    if (ui.fv) ui.fv.textContent = F.toFixed(3);
    if (ui.kv) ui.kv.textContent = kk.toFixed(3);
    ruArr[0] = F; ruArr[1] = kk; ruArr[2] = 0.21; ruArr[3] = 0.105;
    ruArr[4] = 1.0;
    ruArr[5] = brush ? brush[0] : 0; ruArr[6] = brush ? brush[1] : 0;
    ruArr[7] = brush ? 0.02 : 0;
    device.queue.writeBuffer(ruBuf, 0, ruArr);
    vuArr[0] = parseInt((ui.view && ui.view.value) || '0', 10);
    device.queue.writeBuffer(vuBuf, 0, vuArr);

    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(simP);
    for (let s = 0; s < steps; s++) {
      cp.setBindGroup(0, simBG[ping]);
      cp.dispatchWorkgroups(Math.ceil(SW / 8), Math.ceil(SH / 8));
      ping = 1 - ping;
      gen++;
    }
    cp.end();
    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    rp.setPipeline(showP);
    rp.setBindGroup(0, showBG[ping]);
    rp.draw(3);
    rp.end();
    device.queue.submit([enc.finish()]);

    if (hud) {
      hud.textContent = SW + '×' + SH + ' · 第 ' + gen.toLocaleString() + ' 代 · ' +
        steps + ' 步/帧 · F=' + F.toFixed(3) + ' k=' + kk.toFixed(3) + ' · ' + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
