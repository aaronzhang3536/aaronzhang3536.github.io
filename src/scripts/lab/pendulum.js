/* 双摆混沌系综 — 裸 WebGPU
   几千个双摆，初始角只差亿分之一弧度，RK4 积分看它们何时分道扬镳。
   视图：实空间（摆尖云 + 拖尾）/ 相空间（θ₂-ω₂ 轨迹） */

const SIM_WGSL = /* wgsl */ `
struct SU { a: vec4f };   /* x dt, y 子步数, z g, w 未用 */
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var<storage, read_write> st: array<vec4f>;   /* θ1 ω1 θ2 ω2 */

fn deriv(s: vec4f, G: f32) -> vec4f {
  let d = s.x - s.z;
  let den = 2.0 - cos(2.0 * d);
  let dw1 = (-2.0 * G * sin(s.x) - G * sin(s.x - 2.0 * s.z)
             - 2.0 * sin(d) * (s.w * s.w + s.y * s.y * cos(d))) / den;
  let dw2 = (2.0 * sin(d) * (2.0 * s.y * s.y + 2.0 * G * cos(s.x) + s.w * s.w * cos(d))) / den;
  return vec4f(s.y, dw1, s.w, dw2);
}

@compute @workgroup_size(64)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&st)) { return; }
  var s = st[id.x];
  let dt = su.a.x;
  let G = su.a.z;
  let n = u32(su.a.y);
  for (var k = 0u; k < n; k++) {
    let k1 = deriv(s, G);
    let k2 = deriv(s + k1 * dt * 0.5, G);
    let k3 = deriv(s + k2 * dt * 0.5, G);
    let k4 = deriv(s + k3 * dt, G);
    s += (k1 + 2.0 * k2 + 2.0 * k3 + k4) * (dt / 6.0);
  }
  st[id.x] = s;
}`;

const PTS_WGSL = /* wgsl */ `
struct DU { a: vec4f };   /* x 模式(0 实空间/1 相空间), y N, z aspect, w 未用 */
@group(0) @binding(0) var<uniform> du: DU;
@group(0) @binding(1) var<storage, read> st: array<vec4f>;
struct VSOut { @builtin(position) p: vec4f, @location(0) col: vec3f, @location(1) uv: vec2f };

fn hue(h: f32) -> vec3f {
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
fn wrapPi(a: f32) -> f32 {
  return a - floor((a + 3.14159265) / 6.2831853) * 6.2831853;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let i = vi / 6u;
  let c = corners[vi % 6u];
  let s = st[i];
  var p: vec2f;
  if (du.a.x < 0.5) {
    /* 实空间摆尖：x=sinθ1+sinθ2, y=-(cosθ1+cosθ2)，范围 ±2 */
    p = vec2f(sin(s.x) + sin(s.z), -(cos(s.x) + cos(s.z))) / 2.25;
  } else {
    /* 相空间：横轴 θ2（±π），纵轴 ω2（±8） */
    p = vec2f(wrapPi(s.z) / 3.3, clamp(s.w / 8.0, -0.96, 0.96));
  }
  var o: VSOut;
  o.p = vec4f(p + c * vec2f(0.0035, 0.0035 * du.a.z), 0.0, 1.0);
  o.col = hue(f32(i) / du.a.y * 0.83) * 0.55 + 0.1;
  o.uv = c;
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let a = (1.0 - r2) * 0.35;
  return vec4f(in.col * a, a);
}`;

const ROD_WGSL = /* wgsl */ `
struct DU { a: vec4f };
@group(0) @binding(0) var<uniform> du: DU;
@group(0) @binding(1) var<storage, read> st: array<vec4f>;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let s = st[0];
  let j = vec2f(sin(s.x), -cos(s.x));
  let t = j + vec2f(sin(s.z), -cos(s.z));
  var pts = array<vec2f, 4>(vec2f(0.0), j, j, t);
  return vec4f(pts[vi] / 2.25, 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return vec4f(0.85, 0.9, 1.0, 1.0); }`;

const FADE_WGSL = /* wgsl */ `
struct FU { c: vec4f };
@group(0) @binding(0) var<uniform> fu: FU;
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
@fragment
fn fs() -> @location(0) vec4f { return fu.c; }`;

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
fn fs(in: VSOut) -> @location(0) vec4f { return textureSample(tex, samp, in.uv); }`;

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

  const wrapW = Math.min(920, cvs.parentElement.clientWidth || 920);
  const W = wrapW, Hc = Math.round(wrapW * 9 / 16);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(Hc * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const accTex = device.createTexture({
    size: [cvs.width, cvs.height], format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const accView = accTex.createView();
  const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const suBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const duBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const fuBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const simP = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: SIM_WGSL }), entryPoint: 'cs' },
  });
  const mkRP = (code, blend, topo) => {
    const m = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: m, entryPoint: 'vs' },
      fragment: { module: m, entryPoint: 'fs', targets: [{ format, ...(blend ? { blend } : {}) }] },
      primitive: { topology: topo || 'triangle-list' },
    });
  };
  const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
  const OVER = {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  };
  const ptsP = mkRP(PTS_WGSL, ADD);
  const rodP = mkRP(ROD_WGSL, null, 'line-list');
  const fadeP = mkRP(FADE_WGSL, OVER);
  const blitP = mkRP(BLIT_WGSL, null);

  const fadeBG = device.createBindGroup({
    layout: fadeP.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fuBuf } }],
  });
  const blitBG = device.createBindGroup({
    layout: blitP.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: samp },
      { binding: 1, resource: accView },
    ],
  });

  const $ = (id) => document.getElementById(id);
  const ui = { n: $('dp-n'), ang: $('dp-ang'), eps: $('dp-eps'), speed: $('dp-speed'), view: $('dp-view'), reset: $('dp-reset'), epsv: $('dp-epsv') };

  let N = 0, stBuf = null, simBG = null, ptsBG = null, rodBG = null, simTime = 0;
  function reset() {
    N = parseInt((ui.n && ui.n.value) || '4096', 10);
    const ang = (parseFloat((ui.ang && ui.ang.value) || '120') * Math.PI) / 180;
    const eps = Math.pow(10, parseFloat((ui.eps && ui.eps.value) || '-7'));
    if (ui.epsv) ui.epsv.textContent = '10^' + parseFloat((ui.eps && ui.eps.value) || '-7').toFixed(0) + ' rad';
    if (stBuf) stBuf.destroy();
    const init = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const d = eps * (i / (N - 1) - 0.5) * 2;
      init[i * 4] = ang + d;
      init[i * 4 + 1] = 0;
      init[i * 4 + 2] = ang + d;
      init[i * 4 + 3] = 0;
    }
    stBuf = device.createBuffer({ size: init.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(stBuf, 0, init);
    const bg = (pipe) => device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pipe === simP ? suBuf : duBuf } },
        { binding: 1, resource: { buffer: stBuf } },
      ],
    });
    simBG = bg(simP); ptsBG = bg(ptsP);
    /* rod 着色器只用 st（auto layout 不含 binding 0） */
    rodBG = device.createBindGroup({
      layout: rodP.getBindGroupLayout(0),
      entries: [{ binding: 1, resource: { buffer: stBuf } }],
    });
    simTime = 0;
    clearAcc = true;
  }
  let clearAcc = true;
  if (ui.reset) ui.reset.addEventListener('click', reset);
  if (ui.n) ui.n.addEventListener('change', reset);
  if (ui.ang) ui.ang.addEventListener('input', reset);
  if (ui.eps) ui.eps.addEventListener('input', reset);
  if (ui.view) ui.view.addEventListener('change', () => { clearAcc = true; });
  reset();

  const suArr = new Float32Array(4);
  const duArr = new Float32Array(4);
  const fuArr = new Float32Array(4);
  let prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.05) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;

    const speed = parseFloat((ui.speed && ui.speed.value) || '1');
    const SUB = 12;
    const dt = (dtF * speed) / SUB;
    simTime += dtF * speed;
    suArr[0] = Math.min(dt, 0.004); suArr[1] = SUB; suArr[2] = 9.81; suArr[3] = 0;
    device.queue.writeBuffer(suBuf, 0, suArr);
    const mode = parseInt((ui.view && ui.view.value) || '0', 10);
    duArr[0] = mode; duArr[1] = N; duArr[2] = cvs.width / cvs.height; duArr[3] = 0;
    device.queue.writeBuffer(duBuf, 0, duArr);
    fuArr[0] = 0.008; fuArr[1] = 0.010; fuArr[2] = 0.016; fuArr[3] = mode === 1 ? 0.02 : 0.08;
    device.queue.writeBuffer(fuBuf, 0, fuArr);

    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass();
    cp.setPipeline(simP);
    cp.setBindGroup(0, simBG);
    cp.dispatchWorkgroups(Math.ceil(N / 64));
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: accView,
        loadOp: clearAcc ? 'clear' : 'load',
        clearValue: { r: 0.008, g: 0.01, b: 0.016, a: 1 },
        storeOp: 'store',
      }],
    });
    clearAcc = false;
    rp.setPipeline(fadeP);
    rp.setBindGroup(0, fadeBG);
    rp.draw(3);
    rp.setPipeline(ptsP);
    rp.setBindGroup(0, ptsBG);
    rp.draw(N * 6);
    rp.end();

    const bp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    bp.setPipeline(blitP);
    bp.setBindGroup(0, blitBG);
    bp.draw(3);
    if (mode === 0) {
      bp.setPipeline(rodP);
      bp.setBindGroup(0, rodBG);
      bp.draw(4);
    }
    bp.end();
    device.queue.submit([enc.finish()]);

    if (hud) {
      hud.textContent = N.toLocaleString() + ' 个双摆 · RK4 ×' + SUB + ' 子步 · t = ' +
        simTime.toFixed(1) + 's · ' + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
