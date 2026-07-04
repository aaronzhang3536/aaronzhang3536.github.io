/* 路径追踪 Cornell Box — 裸 WebGPU：compute 逐像素路径追踪，storage buffer 渐进累积 */

const PT_WGSL = /* wgsl */ `
struct U {
  eye: vec4f,      // xyz 相机位置, w = tan(fov/2)
  right: vec4f,    // xyz 相机右轴, w = aspect
  up: vec4f,       // xyz 相机上轴, w = 帧号
  fwd: vec4f,      // xyz 相机前轴, w = 光源强度
  params: vec4f,   // x 最大弹射, y 宽, z 高, w 未用
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4f>;

const EPS = 1e-3;

var<private> rng: u32;
fn pcg(n: u32) -> u32 {
  var h = n * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (h >> 22u) ^ h;
}
fn rand() -> f32 { rng = pcg(rng); return f32(rng) / 4294967296.0; }

struct Hit { t: f32, p: vec3f, n: vec3f, alb: vec3f, m: u32 };
// m: 0 漫反射  1 镜面  2 玻璃  3 发光

fn planeT(roA: f32, rdA: f32, k: f32) -> f32 {
  if (abs(rdA) < 1e-6) { return -1.0; }
  let t = (k - roA) / rdA;
  if (t < EPS) { return -1.0; }
  return t;
}
fn sphT(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let h = b * b - cc;
  if (h < 0.0) { return -1.0; }
  let sq = sqrt(h);
  var t = -b - sq;
  if (t < EPS) { t = -b + sq; }
  if (t < EPS) { return -1.0; }
  return t;
}

const S1C = vec3f(-0.45, 0.42, -0.30);   // 漫反射球
const S1R = 0.42;
const S2C = vec3f(0.50, 0.35, 0.14);     // 镜面球
const S2R = 0.35;
const S3C = vec3f(-0.02, 0.25, 0.58);    // 玻璃球
const S3R = 0.25;

fn closest(ro: vec3f, rd: vec3f) -> Hit {
  var h = Hit(1e9, vec3f(0.0), vec3f(0.0), vec3f(0.0), 0u);
  var t: f32;
  var p: vec3f;
  // 地板 y=0（白）
  t = planeT(ro.y, rd.y, 0.0);
  if (t > 0.0 && t < h.t) {
    p = ro + rd * t;
    if (abs(p.x) < 1.0 && abs(p.z) < 1.0) { h = Hit(t, p, vec3f(0.0, 1.0, 0.0), vec3f(0.73), 0u); }
  }
  // 天花板 y=2（白，中央是灯）
  t = planeT(ro.y, rd.y, 2.0);
  if (t > 0.0 && t < h.t) {
    p = ro + rd * t;
    if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
      if (abs(p.x) < 0.45 && abs(p.z) < 0.45) { h = Hit(t, p, vec3f(0.0, -1.0, 0.0), vec3f(1.0), 3u); }
      else { h = Hit(t, p, vec3f(0.0, -1.0, 0.0), vec3f(0.73), 0u); }
    }
  }
  // 左墙 x=-1（红）
  t = planeT(ro.x, rd.x, -1.0);
  if (t > 0.0 && t < h.t) {
    p = ro + rd * t;
    if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) { h = Hit(t, p, vec3f(1.0, 0.0, 0.0), vec3f(0.65, 0.06, 0.06), 0u); }
  }
  // 右墙 x=1（绿）
  t = planeT(ro.x, rd.x, 1.0);
  if (t > 0.0 && t < h.t) {
    p = ro + rd * t;
    if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) { h = Hit(t, p, vec3f(-1.0, 0.0, 0.0), vec3f(0.10, 0.55, 0.12), 0u); }
  }
  // 后墙 z=-1（白）
  t = planeT(ro.z, rd.z, -1.0);
  if (t > 0.0 && t < h.t) {
    p = ro + rd * t;
    if (p.y > 0.0 && p.y < 2.0 && abs(p.x) < 1.0) { h = Hit(t, p, vec3f(0.0, 0.0, 1.0), vec3f(0.73), 0u); }
  }
  // 三个球
  t = sphT(ro, rd, S1C, S1R);
  if (t > 0.0 && t < h.t) { p = ro + rd * t; h = Hit(t, p, normalize(p - S1C), vec3f(0.30, 0.45, 0.85), 0u); }
  t = sphT(ro, rd, S2C, S2R);
  if (t > 0.0 && t < h.t) { p = ro + rd * t; h = Hit(t, p, normalize(p - S2C), vec3f(0.94, 0.95, 0.96), 1u); }
  t = sphT(ro, rd, S3C, S3R);
  if (t > 0.0 && t < h.t) { p = ro + rd * t; h = Hit(t, p, normalize(p - S3C), vec3f(1.0), 2u); }
  return h;
}

fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rand() * 6.2831853;
  let r2 = rand();
  let sr2 = sqrt(r2);
  var tv = vec3f(1.0, 0.0, 0.0);
  if (abs(n.x) > 0.9) { tv = vec3f(0.0, 1.0, 0.0); }
  let a = normalize(cross(n, tv));
  let b = cross(n, a);
  return normalize(a * cos(r1) * sr2 + b * sin(r1) * sr2 + n * sqrt(max(1.0 - r2, 0.0)));
}

@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(u.params.y);
  let H = u32(u.params.z);
  if (id.x >= W || id.y >= H) { return; }
  let idx = id.y * W + id.x;
  rng = pcg(idx * 9781u + u32(u.up.w) * 6271u + 1u);

  // 带亚像素抖动的主射线
  let px = ((f32(id.x) + rand()) / f32(W) * 2.0 - 1.0) * u.eye.w * u.right.w;
  let py = (1.0 - (f32(id.y) + rand()) / f32(H) * 2.0) * u.eye.w;
  var ro = u.eye.xyz;
  var rd = normalize(u.fwd.xyz + u.right.xyz * px + u.up.xyz * py);

  var through = vec3f(1.0);
  var col = vec3f(0.0);
  let maxB = u32(u.params.x);
  for (var b = 0u; b < maxB; b++) {
    let h = closest(ro, rd);
    if (h.t > 9.0e8) { break; }
    if (h.m == 3u) { col += through * u.fwd.w; break; }
    if (h.m == 0u) {
      through *= h.alb;
      var n = h.n;
      if (dot(n, rd) > 0.0) { n = -n; }
      rd = cosineDir(n);
      ro = h.p + n * EPS * 2.0;
    } else if (h.m == 1u) {
      through *= h.alb;
      var n = h.n;
      if (dot(n, rd) > 0.0) { n = -n; }
      rd = reflect(rd, n);
      ro = h.p + n * EPS * 2.0;
    } else {
      var n = h.n;
      var eta = 1.0 / 1.5;
      if (dot(rd, n) > 0.0) { n = -n; eta = 1.5; }
      let cosi = -dot(rd, n);
      let fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
      let refr = refract(rd, n, eta);
      if (dot(refr, refr) < 0.25 || rand() < fres) {
        rd = reflect(rd, n);
        ro = h.p + n * EPS * 2.0;
      } else {
        rd = normalize(refr);
        ro = h.p - n * EPS * 2.0;
        through *= vec3f(0.97, 0.99, 0.98);
      }
    }
    // 俄罗斯轮盘
    if (b > 2u) {
      let q = max(through.r, max(through.g, through.b));
      if (rand() > q) { break; }
      through /= max(q, 1e-4);
    }
  }
  accum[idx] += vec4f(col, 1.0);
}`;

const SHOW_WGSL = /* wgsl */ `
struct P { w: f32, h: f32, exposure: f32, pad: f32 };
@group(0) @binding(0) var<storage, read> accum: array<vec4f>;
@group(0) @binding(1) var<uniform> p: P;

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var v = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(v[vi], 0.0, 1.0);
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let idx = u32(fp.y) * u32(p.w) + u32(fp.x);
  let a = accum[idx];
  var c = a.rgb / max(a.w, 1.0) * p.exposure;
  c = aces(c);
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, 1.0);
}`;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) wgslEl.textContent = PT_WGSL;

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
  const cssW = wrapW, cssH = Math.round(wrapW * 9 / 16);
  cvs.style.width = cssW + 'px'; cvs.style.height = cssH + 'px';

  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  const ptPipe = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: PT_WGSL }), entryPoint: 'cs' },
  });
  const showMod = device.createShaderModule({ code: SHOW_WGSL });
  const showPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: showMod, entryPoint: 'vs' },
    fragment: { module: showMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const uBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const pBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  /* 分辨率可切，累积缓冲随之重建 */
  let W = 0, H = 0, accBuf = null, ptBG = null, showBG = null;
  let samples = 0, resetFlag = true;
  function rebuildRes(scale) {
    W = Math.round(cssW * scale); H = Math.round(cssH * scale);
    cvs.width = W; cvs.height = H;
    ctx.configure({ device, format, alphaMode: 'opaque' });
    if (accBuf) accBuf.destroy();
    accBuf = device.createBuffer({ size: W * H * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    ptBG = device.createBindGroup({
      layout: ptPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uBuf } },
        { binding: 1, resource: { buffer: accBuf } },
      ],
    });
    showBG = device.createBindGroup({
      layout: showPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: accBuf } },
        { binding: 1, resource: { buffer: pBuf } },
      ],
    });
    resetFlag = true;
  }

  /* GPU 计时 */
  let qs = null, qBuf = null, readPool = [];
  let gpuMs = 0;
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

  /* 交互：拖拽环绕 + 滚轮推拉，任何改动重置累积 */
  const $ = (id) => document.getElementById(id);
  const ui = { bounce: $('pt-bounce'), light: $('pt-light'), expo: $('pt-expo'), res: $('pt-res') };
  let yaw = 0, pitch = 0.06, radius = 3.3;
  let dragging = false, px0 = 0, py0 = 0;
  cvs.addEventListener('pointerdown', (e) => {
    dragging = true; px0 = e.clientX; py0 = e.clientY;
    cvs.setPointerCapture(e.pointerId);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px0) * 0.004;
    pitch += (e.clientY - py0) * 0.003;
    yaw = Math.max(-0.62, Math.min(0.62, yaw));
    pitch = Math.max(-0.25, Math.min(0.45, pitch));
    px0 = e.clientX; py0 = e.clientY;
    resetFlag = true;
  });
  cvs.addEventListener('pointerup', () => { dragging = false; });
  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(2.2, Math.min(5.2, radius + e.deltaY * 0.002));
    resetFlag = true;
  }, { passive: false });
  ['bounce', 'light'].forEach((k) => {
    if (ui[k]) ui[k].addEventListener('input', () => { resetFlag = true; });
  });
  if (ui.res) ui.res.addEventListener('change', () => rebuildRes(parseFloat(ui.res.value)));

  rebuildRes(parseFloat((ui.res && ui.res.value) || '0.75'));

  const uArr = new Float32Array(20);
  const pArr = new Float32Array(4);
  let frame = 0, prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dt = Math.min((ts - prev) / 1000, 0.1) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.05;
    frame++;

    /* 相机：绕房间中心环绕（开口朝向相机） */
    const tgt = [0, 0.9, 0];
    const eye = [
      Math.sin(yaw) * Math.cos(pitch) * radius,
      0.9 + Math.sin(pitch) * radius,
      Math.cos(yaw) * Math.cos(pitch) * radius,
    ];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fwd = norm(sub(tgt, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);

    const bounce = parseInt((ui.bounce && ui.bounce.value) || '6', 10);
    const light = parseFloat((ui.light && ui.light.value) || '14');
    const expo = parseFloat((ui.expo && ui.expo.value) || '1.1');

    const enc = device.createCommandEncoder();
    if (resetFlag) {
      enc.clearBuffer(accBuf);
      samples = 0;
      resetFlag = false;
    }

    uArr[0] = eye[0]; uArr[1] = eye[1]; uArr[2] = eye[2]; uArr[3] = Math.tan(0.35);
    uArr[4] = right[0]; uArr[5] = right[1]; uArr[6] = right[2]; uArr[7] = W / H;
    uArr[8] = up[0]; uArr[9] = up[1]; uArr[10] = up[2]; uArr[11] = frame;
    uArr[12] = fwd[0]; uArr[13] = fwd[1]; uArr[14] = fwd[2]; uArr[15] = light;
    uArr[16] = bounce; uArr[17] = W; uArr[18] = H; uArr[19] = 0;
    device.queue.writeBuffer(uBuf, 0, uArr);
    pArr[0] = W; pArr[1] = H; pArr[2] = expo; pArr[3] = 0;
    device.queue.writeBuffer(pBuf, 0, pArr);

    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    cp.setPipeline(ptPipe);
    cp.setBindGroup(0, ptBG);
    cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    cp.end();
    samples++;

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    rp.setPipeline(showPipe);
    rp.setBindGroup(0, showBG);
    rp.draw(3);
    rp.end();

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
        gpuMs += (Number(q[1] - q[0]) / 1e6 - gpuMs) * 0.1;
        slot.buf.unmap();
        slot.busy = false;
      }).catch(() => { slot.busy = false; });
    }
    if (hud) {
      hud.textContent = W + '×' + H + ' · ' + samples.toLocaleString() + ' spp · ' +
        (canTime ? 'trace ' + gpuMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
