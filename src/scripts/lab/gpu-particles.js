/* GPU 粒子 — 裸 WebGPU：compute 模拟 + 累积缓冲拖尾 + timestamp-query 真实计时 */
import { mat4, vec3 } from 'wgpu-matrix';

const SIM_WGSL = /* wgsl */ `
struct Sim {
  dt: f32,
  time: f32,
  gravity: f32,
  turb: f32,
  attract: vec4f,   // xyz 引力点, w 未用
};
@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read_write> posBuf: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> velBuf: array<vec4f>;

fn n3(p: vec3f) -> vec3f {
  return vec3f(
    sin(p.y * 1.7 + p.z * 1.3),
    sin(p.z * 1.9 + p.x * 1.1),
    sin(p.x * 1.5 + p.y * 1.2));
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&posBuf)) { return; }
  var p = posBuf[i].xyz;
  var v = velBuf[i].xyz;

  let d = sim.attract.xyz - p;
  let r2 = dot(d, d) + 0.08;
  v += (d / sqrt(r2)) * (sim.gravity / r2) * sim.dt;

  let q = p * 0.9 + vec3f(0.0, sim.time * 0.15, 0.0);
  v += (n3(q) + 0.5 * n3(q * 2.1 + 5.0)) * sim.turb * sim.dt;

  v -= v * 0.55 * sim.dt;
  p += v * sim.dt;

  if (length(p) > 7.0) { v -= normalize(p) * 3.0 * sim.dt; }

  posBuf[i] = vec4f(p, posBuf[i].w);
  velBuf[i] = vec4f(v, 0.0);
}`;

const DRAW_WGSL = /* wgsl */ `
struct Cam {
  vp: mat4x4f,
  aspect: f32,
  size: f32,
  pad0: f32,
  pad1: f32,
};
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> posBuf: array<vec4f>;
@group(0) @binding(2) var<storage, read> velBuf: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let pi = vi / 6u;
  let c = corners[vi % 6u];
  let wp = posBuf[pi].xyz;
  var clip = cam.vp * vec4f(wp, 1.0);
  clip = vec4f(clip.xy + c * vec2f(cam.size, cam.size * cam.aspect) * clip.w, clip.zw);

  let s = clamp(length(velBuf[pi].xyz) * 0.45, 0.0, 1.0);
  var col = mix(vec3f(0.13, 0.32, 0.9), vec3f(1.0, 0.5, 0.14), s);
  col += vec3f(1.0, 0.9, 0.8) * pow(s, 4.0) * 0.7;

  var o: VSOut;
  o.pos = clip;
  o.col = col;
  o.uv = c;
  return o;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r = dot(in.uv, in.uv);
  if (r > 1.0) { discard; }
  let a = (1.0 - r) * 0.5;
  return vec4f(in.col * a, a);
}`;

const FADE_WGSL = /* wgsl */ `
struct Fade { color: vec4f };
@group(0) @binding(0) var<uniform> fade: Fade;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return fade.color; }`;

const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}`;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) wgslEl.textContent = '// ---- 模拟 (compute) ----\n' + SIM_WGSL + '\n\n// ---- 绘制 ----' + DRAW_WGSL;

  function fail(msg) {
    if (hud) hud.textContent = '';
    if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; }
    cvs.style.display = 'none';
  }
  if (!navigator.gpu) {
    fail('当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge / Firefox 打开这个实验。');
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { fail('WebGPU adapter 请求失败（可能被显卡黑名单拦截）。'); return; }
  const canTime = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: canTime ? ['timestamp-query'] : [],
  });

  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, H = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * dpr; cvs.height = H * dpr;
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';

  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  /* 离屏累积纹理（拖尾），再 blit 上屏 */
  const accTex = device.createTexture({
    size: [W * dpr, H * dpr], format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const accView = accTex.createView();
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const mkModule = (code) => device.createShaderModule({ code });
  const simMod = mkModule(SIM_WGSL);
  const drawMod = mkModule(DRAW_WGSL);
  const fadeMod = mkModule(FADE_WGSL);
  const blitMod = mkModule(BLIT_WGSL);

  const simPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: simMod, entryPoint: 'cs' },
  });
  const drawPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: drawMod, entryPoint: 'vs' },
    fragment: {
      module: drawMod, entryPoint: 'fs',
      targets: [{
        format,
        blend: {   /* 加色混合 */
          color: { srcFactor: 'one', dstFactor: 'one' },
          alpha: { srcFactor: 'one', dstFactor: 'one' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const fadePipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: fadeMod, entryPoint: 'vs' },
    fragment: {
      module: fadeMod, entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const blitPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: blitMod, entryPoint: 'vs' },
    fragment: { module: blitMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  /* uniforms */
  const simUB = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const camUB = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const fadeUB = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blitBG = device.createBindGroup({
    layout: blitPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: accView },
    ],
  });
  const fadeBG = device.createBindGroup({
    layout: fadePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fadeUB } }],
  });

  /* 粒子缓冲，可按数量重建 */
  let posBuf = null, velBuf = null, simBG = null, drawBG = null, COUNT = 0;
  function rebuild(n) {
    COUNT = n;
    if (posBuf) posBuf.destroy();
    if (velBuf) velBuf.destroy();
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = Math.cbrt(Math.random()) * 3.2;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      pos[i * 4] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 4 + 1] = r * Math.cos(ph);
      pos[i * 4 + 2] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 4 + 3] = Math.random();
    }
    posBuf = device.createBuffer({ size: pos.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    velBuf = device.createBuffer({ size: vel.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(posBuf, 0, pos);
    device.queue.writeBuffer(velBuf, 0, vel);
    simBG = device.createBindGroup({
      layout: simPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: simUB } },
        { binding: 1, resource: { buffer: posBuf } },
        { binding: 2, resource: { buffer: velBuf } },
      ],
    });
    drawBG = device.createBindGroup({
      layout: drawPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: camUB } },
        { binding: 1, resource: { buffer: posBuf } },
        { binding: 2, resource: { buffer: velBuf } },
      ],
    });
  }

  /* GPU 计时 */
  let qs = null, qBuf = null, readPool = [];
  let gpuCompute = 0, gpuDraw = 0;
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

  /* 参数与交互 */
  const $ = (id) => document.getElementById(id);
  const ui = { count: $('lab-count'), countV: $('lab-count-v'), grav: $('lab-grav'), turb: $('lab-turb'), trail: $('lab-trail') };
  /* 对数滑块：2^12 (4K) ~ 2^22 (4M)。拖动时即时显示，松手/停顿 250ms 后再重建缓冲 */
  const countOf = () => 1 << parseInt(ui.count.value, 10);
  let rebuildTo = 0;
  if (ui.count) {
    ui.count.addEventListener('input', () => {
      if (ui.countV) ui.countV.textContent = countOf().toLocaleString();
      clearTimeout(rebuildTo);
      rebuildTo = setTimeout(() => { if (countOf() !== COUNT) rebuild(countOf()); }, 250);
    });
  }
  let mouse = null;
  cvs.addEventListener('mousemove', (e) => {
    const r = cvs.getBoundingClientRect();
    mouse = [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  });
  cvs.addEventListener('mouseleave', () => { mouse = null; });

  rebuild(ui.count ? countOf() : 262144);

  const aspect = W / H;
  const proj = mat4.perspective(0.9, aspect, 0.1, 50);
  const simArr = new Float32Array(8);
  const camArr = new Float32Array(20);
  const fadeArr = new Float32Array(4);

  let prev = 0, fps = 60, first = true;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!cvs.isConnected) return;
    const dt = Math.min((ts - prev) / 1000, 0.033) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.05;
    const t = ts / 1000;

    /* 相机缓慢环绕 */
    const yaw = t * 0.12;
    const eye = [Math.sin(yaw) * 8.5, 1.6, Math.cos(yaw) * 8.5];
    const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const vp = mat4.multiply(proj, view);

    /* 引力点：鼠标投到过原点的视平面；无鼠标时自动漫游 */
    let att;
    if (mouse) {
      const f = vec3.normalize(vec3.negate(eye));
      const right = vec3.normalize(vec3.cross(f, [0, 1, 0]));
      const up = vec3.cross(right, f);
      const dist = vec3.length(eye);
      const th = Math.tan(0.45);
      att = vec3.add(
        vec3.mulScalar(right, mouse[0] * th * aspect * dist),
        vec3.mulScalar(up, mouse[1] * th * dist));
    } else {
      att = [Math.sin(t * 0.7) * 2.6, Math.sin(t * 1.13) * 1.5, Math.cos(t * 0.53) * 2.2];
    }

    const grav = parseFloat((ui.grav && ui.grav.value) || '3');
    const turb = parseFloat((ui.turb && ui.turb.value) || '1.2');
    const trail = parseFloat((ui.trail && ui.trail.value) || '0.12');

    simArr[0] = dt; simArr[1] = t; simArr[2] = grav; simArr[3] = turb;
    simArr[4] = att[0]; simArr[5] = att[1]; simArr[6] = att[2]; simArr[7] = 0;
    device.queue.writeBuffer(simUB, 0, simArr);
    camArr.set(vp, 0);
    camArr[16] = aspect; camArr[17] = 0.011; camArr[18] = 0; camArr[19] = 0;
    device.queue.writeBuffer(camUB, 0, camArr);
    fadeArr[0] = 0.008; fadeArr[1] = 0.010; fadeArr[2] = 0.016; fadeArr[3] = trail;
    device.queue.writeBuffer(fadeUB, 0, fadeArr);

    const enc = device.createCommandEncoder();

    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    cp.setPipeline(simPipe);
    cp.setBindGroup(0, simBG);
    cp.dispatchWorkgroups(Math.ceil(COUNT / 64));
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: accView,
        loadOp: first ? 'clear' : 'load',
        clearValue: { r: 0.008, g: 0.01, b: 0.016, a: 1 },
        storeOp: 'store',
      }],
      ...(canTime ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {}),
    });
    rp.setPipeline(fadePipe);
    rp.setBindGroup(0, fadeBG);
    rp.draw(3);
    rp.setPipeline(drawPipe);
    rp.setBindGroup(0, drawBG);
    rp.draw(COUNT * 6);
    rp.end();

    const bp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    bp.setPipeline(blitPipe);
    bp.setBindGroup(0, blitBG);
    bp.draw(3);
    bp.end();

    let slot = null;
    if (canTime) {
      slot = readPool.find((s) => !s.busy);
      if (slot) {
        enc.resolveQuerySet(qs, 0, 4, qBuf, 0);
        enc.copyBufferToBuffer(qBuf, 0, slot.buf, 0, 32);
      }
    }
    device.queue.submit([enc.finish()]);
    first = false;

    if (slot) {
      slot.busy = true;
      slot.buf.mapAsync(GPUMapMode.READ).then(() => {
        const q = new BigInt64Array(slot.buf.getMappedRange());
        gpuCompute += (Number(q[1] - q[0]) / 1e6 - gpuCompute) * 0.1;
        gpuDraw += (Number(q[3] - q[2]) / 1e6 - gpuDraw) * 0.1;
        slot.buf.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (hud) {
      hud.textContent = COUNT.toLocaleString() + ' 粒子 · ' +
        (canTime
          ? 'compute ' + gpuCompute.toFixed(2) + ' ms · draw ' + gpuDraw.toFixed(2) + ' ms · '
          : 'GPU 计时不可用 · ') +
        Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; frame(ts); });
}

main();
