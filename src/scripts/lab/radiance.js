/* Radiance Cascades 2D GI — 裸 WebGPU
   Sannikov 的级联辐射度：cascade i 的探针间距 ×2、方向数 ×4、射线区间 ×4，
   每级内存恒定；自顶向下归并后，cascade 0 就是全场景的漫反射全局光照。
   画布上直接画光源和墙，光照实时收敛，带软阴影与半影。 */

const SW = 640, SH = 384, NC = 5, BASE = 4.0;

/* ---------- 画笔 ---------- */
const PAINT_WGSL = /* wgsl */ `
struct BU { a: vec4f, b: vec4f };  /* a: xy 位置px, z 半径, w 模式(0光1墙2擦) · b: rgb 颜色 */
@group(0) @binding(0) var<uniform> bu: BU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  var c = textureLoad(src, vec2i(id.xy), 0);
  if (bu.a.z > 0.0) {
    let d = distance(vec2f(id.xy), bu.a.xy);
    if (d < bu.a.z) {
      if (bu.a.w < 0.5) { c = vec4f(bu.b.rgb, 1.0); }        /* 光源：发光 + 实体 */
      else if (bu.a.w < 1.5) { c = vec4f(0.0, 0.0, 0.0, 1.0); } /* 墙：不发光 + 实体 */
      else { c = vec4f(0.0); }                                 /* 橡皮 */
    }
  }
  textureStore(dst, id.xy, c);
}`;

/* ---------- JFA 距离场 ---------- */
const JFA_SEED_WGSL = /* wgsl */ `
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let s = textureLoad(scene, vec2i(id.xy), 0);
  if (s.a > 0.5) { textureStore(dst, id.xy, vec4f(vec2f(id.xy), 0.0, 0.0)); }
  else { textureStore(dst, id.xy, vec4f(-9999.0, -9999.0, 0.0, 0.0)); }
}`;

const JFA_WGSL = /* wgsl */ `
struct JU { step: vec4f };
@group(0) @binding(0) var<uniform> ju: JU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2f(id.xy);
  var best = textureLoad(src, vec2i(id.xy), 0).xy;
  var bd = 1e9;
  if (best.x > -9000.0) { bd = distance(p, best); }
  let st = i32(ju.step.x);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = vec2i(id.xy) + vec2i(dx, dy) * st;
      if (any(q < vec2i(0)) || any(q >= vec2i(dim))) { continue; }
      let s = textureLoad(src, q, 0).xy;
      if (s.x < -9000.0) { continue; }
      let d = distance(p, s);
      if (d < bd) { bd = d; best = s; }
    }
  }
  textureStore(dst, id.xy, vec4f(best, 0.0, 0.0));
}`;

/* ---------- 级联射线行进 + 归并 ---------- */
const CASCADE_WGSL = /* wgsl */ `
struct CU { a: vec4f };  /* x 级别 i, y 是否有上级(0/1), z W, w H */
@group(0) @binding(0) var<uniform> cu: CU;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var jfa: texture_2d<f32>;
@group(0) @binding(3) var upper: texture_2d<f32>;   /* cascade i+1 */
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;

const BASE = ${BASE.toFixed(1)};

fn sdf(p: vec2f, dim: vec2u) -> f32 {
  let q = clamp(vec2i(p), vec2i(0), vec2i(dim) - 1);
  let s = textureLoad(jfa, q, 0).xy;
  if (s.x < -9000.0) { return 1e6; }
  return distance(p, s);
}

/* 探针间距 2^(i+1)px；方向 4^(i+1)；区间 [B(4^i−1)/3, B(4^(i+1)−1)/3] */
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(cu.a.z);
  let H = u32(cu.a.w);
  if (id.x >= W || id.y >= H) { return; }
  let ci = u32(cu.a.x);
  let T = 1u << (ci + 1u);          /* 方向平铺 T×T */
  let PW = W / T;
  let PH = H / T;
  let tileX = id.x / PW;
  let tileY = id.y / PH;
  let px = id.x % PW;
  let py = id.y % PH;
  let dirIdx = tileY * T + tileX;
  let nDir = T * T;
  let ang = (f32(dirIdx) + 0.5) / f32(nDir) * 6.2831853;
  let dir = vec2f(cos(ang), sin(ang));
  let pos = (vec2f(f32(px), f32(py)) + 0.5) * f32(T);

  let p4i = pow(4.0, f32(ci));
  let t0 = BASE * (p4i - 1.0) / 3.0;
  let t1 = BASE * (p4i * 4.0 - 1.0) / 3.0;

  /* 球形步进 */
  var t = t0;
  var hit = false;
  var rad = vec3f(0.0);
  let dim = vec2u(W, H);
  for (var s = 0u; s < 28u; s++) {
    if (t >= t1) { break; }
    let sp = pos + dir * t;
    if (any(sp < vec2f(0.0)) || any(sp >= vec2f(f32(W), f32(H)))) { break; }
    let d = sdf(sp, dim);
    if (d < 0.75) {
      let sc = textureLoad(scene, vec2i(sp), 0);
      rad = sc.rgb;
      hit = true;
      break;
    }
    t += max(d, 0.75);
  }

  if (!hit && cu.a.y > 0.5) {
    /* 未命中：从 cascade i+1 归并（双线性 4 探针 × 4 子方向平均） */
    let T2 = T * 2u;
    let PW2 = W / T2;
    let PH2 = H / T2;
    let pc = pos / f32(T2) - 0.5;
    let i0 = vec2i(floor(pc));
    let fr = pc - floor(pc);
    var acc = vec3f(0.0);
    for (var sub = 0u; sub < 4u; sub++) {
      let cd = dirIdx * 4u + sub;
      let tX = cd % T2;
      let tY = cd / T2;
      var bi = vec3f(0.0);
      for (var k = 0u; k < 4u; k++) {
        let off = vec2i(i32(k & 1u), i32(k >> 1u));
        let pp = clamp(i0 + off, vec2i(0), vec2i(i32(PW2) - 1, i32(PH2) - 1));
        let texel = vec2i(i32(tX * PW2) + pp.x, i32(tY * PH2) + pp.y);
        let w = select(1.0 - fr.x, fr.x, (k & 1u) == 1u) * select(1.0 - fr.y, fr.y, (k >> 1u) == 1u);
        bi += textureLoad(upper, texel, 0).rgb * w;
      }
      acc += bi;
    }
    rad = acc / 4.0;
  }
  textureStore(dst, id.xy, vec4f(rad, select(1.0, 0.0, hit)));
}`;

/* ---------- 合成显示 ---------- */
const SHOW_WGSL = /* wgsl */ `
struct VU { m: vec4f };   /* x 视图: 0 GI, 1 场景, 2 SDF, 3+ 原始级联 */
@group(0) @binding(0) var<uniform> vu: VU;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var jfa: texture_2d<f32>;
@group(0) @binding(3) var c0: texture_2d<f32>;
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
  let dim = vec2f(textureDimensions(scene));
  let px = in.uv * dim;
  let m = u32(vu.m.x);
  var c: vec3f;
  if (m == 1u) {
    let s = textureLoad(scene, vec2i(px), 0);
    c = s.rgb + vec3f(s.a) * 0.15;
  } else if (m == 2u) {
    let s = textureLoad(jfa, vec2i(px), 0).xy;
    var d = 0.0;
    if (s.x > -9000.0) { d = distance(px, s); }
    c = vec3f(fract(d / 24.0) * 0.6 + 0.05) * vec3f(0.5, 0.75, 1.0);
  } else if (m == 3u) {
    c = textureLoad(c0, vec2i(px), 0).rgb;
  } else {
    /* GI：c0 的 4 探针双线性 × 4 方向平均 + 自发光 */
    let PW = u32(dim.x) / 2u;
    let PH = u32(dim.y) / 2u;
    let pc = px / 2.0 - 0.5;
    let i0 = vec2i(floor(pc));
    let fr = pc - floor(pc);
    var gi = vec3f(0.0);
    for (var d2 = 0u; d2 < 4u; d2++) {
      let tX = d2 % 2u;
      let tY = d2 / 2u;
      for (var k = 0u; k < 4u; k++) {
        let off = vec2i(i32(k & 1u), i32(k >> 1u));
        let pp = clamp(i0 + off, vec2i(0), vec2i(i32(PW) - 1, i32(PH) - 1));
        let texel = vec2i(i32(tX * PW) + pp.x, i32(tY * PH) + pp.y);
        let w = select(1.0 - fr.x, fr.x, (k & 1u) == 1u) * select(1.0 - fr.y, fr.y, (k >> 1u) == 1u);
        gi += textureLoad(c0, texel, 0).rgb * w;
      }
    }
    gi /= 4.0;
    let s = textureLoad(scene, vec2i(px), 0);
    c = gi * 1.6 + s.rgb;
    if (s.a > 0.5 && dot(s.rgb, s.rgb) < 0.001) { c = gi * 0.25; }  /* 墙体压暗 */
    c = c / (1.0 + c) * 1.25;
  }
  return vec4f(pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}`;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) wgslEl.textContent = CASCADE_WGSL;
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
  const W = wrapW, Hc = Math.round(wrapW * SH / SW);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(W * dpr); cvs.height = Math.round(Hc * dpr);
  cvs.style.width = W + 'px'; cvs.style.height = Hc + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const mkTex = (fmt) => device.createTexture({
    size: [SW, SH], format: fmt,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  const sceneT = [mkTex('rgba16float'), mkTex('rgba16float')];
  const sV = sceneT.map((t) => t.createView());
  const jfaT = [mkTex('rg32float'), mkTex('rg32float')];
  const jV = jfaT.map((t) => t.createView());
  const cascT = [];
  for (let i = 0; i <= NC; i++) cascT.push(mkTex('rgba16float').createView());
  /* cascT[NC] 是最顶级的"上级"占位（全零 → 顶级无归并） */

  const buBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const vuBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const juBufs = [], cuBufs = [];
  for (let s = 512; s >= 1; s >>= 1) {
    const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Float32Array([s, 0, 0, 0]));
    juBufs.push(b);
  }
  for (let i = 0; i < NC; i++) {
    const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Float32Array([i, i < NC - 1 ? 1 : 0, SW, SH]));
    cuBufs.push(b);
  }

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const paintP = mkCP(PAINT_WGSL);
  const seedP = mkCP(JFA_SEED_WGSL);
  const jfaP = mkCP(JFA_WGSL);
  const cascP = mkCP(CASCADE_WGSL);
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
  const paintBG = [
    bg(paintP, [{ buffer: buBuf }, sV[0], sV[1]]),
    bg(paintP, [{ buffer: buBuf }, sV[1], sV[0]]),
  ];
  let sPing = 0;   /* 当前场景在 sV[sPing] */
  const seedBG = [bg(seedP, [sV[0], jV[0]]), bg(seedP, [sV[1], jV[0]])];
  const jfaBG = juBufs.map((b, k) => bg(jfaP, [{ buffer: b }, jV[k % 2], jV[(k + 1) % 2]]));
  const jfaFinal = juBufs.length % 2;   /* 最终 JFA 所在 ping */
  /* cascade：从 NC-1 向 0，i 读 upper=cascT[i+1] 写 cascT[i] */
  const cascBG = [[], []];
  for (let sp = 0; sp < 2; sp++)
    for (let i = 0; i < NC; i++)
      cascBG[sp].push(bg(cascP, [{ buffer: cuBufs[i] }, sV[sp], jV[jfaFinal], cascT[i + 1], cascT[i]]));
  const showBG = [
    bg(showP, [{ buffer: vuBuf }, sV[0], jV[jfaFinal], cascT[0]]),
    bg(showP, [{ buffer: vuBuf }, sV[1], jV[jfaFinal], cascT[0]]),
  ];

  /* GPU 计时 */
  let qs = null, qBuf = null, readPool = [], gpuMs = 0;
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
  const ui = { brush: $('rc-brush'), size: $('rc-size'), view: $('rc-view'), clear: $('rc-clear'), hue: $('rc-hue') };
  let brush = null, down = false, initQueue = [];
  const pxOf = (e) => {
    const r = cvs.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * SW, (e.clientY - r.top) / r.height * SH];
  };
  cvs.addEventListener('pointerdown', (e) => { down = true; brush = pxOf(e); cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', (e) => { if (down) brush = pxOf(e); });
  const up = () => { down = false; brush = null; };
  cvs.addEventListener('pointerup', up);
  cvs.addEventListener('pointercancel', up);
  function hsl(h) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return 0.95 - 0.85 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  function seedScene() {
    /* 初始场景：两盏灯 + 几堵墙（排队逐帧画进去） */
    initQueue = [
      [140, 120, 14, 0, 1.0, 0.62, 0.28],
      [500, 290, 12, 0, 0.3, 0.62, 1.0],
      [320, 60, 9, 0, 0.5, 1.0, 0.5],
      [250, 200, 30, 1, 0, 0, 0],
      [251, 170, 30, 1, 0, 0, 0],
      [400, 130, 26, 1, 0, 0, 0],
      [180, 300, 24, 1, 0, 0, 0],
    ];
  }
  if (ui.clear) ui.clear.addEventListener('click', () => {
    initQueue = [[0, 0, 1e5, 2, 0, 0, 0]];   /* 一笔覆盖全屏的橡皮 */
  });
  seedScene();

  const buArr = new Float32Array(8);
  const vuArr = new Float32Array(4);
  let prev = 0, fps = 60;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dtF = Math.min((ts - prev) / 1000, 0.05) || 0.016;
    prev = ts;
    fps += ((1 / Math.max(dtF, 0.001)) - fps) * 0.05;

    /* 本帧的画笔（初始化队列优先） */
    let bs = null;
    if (initQueue.length) bs = initQueue.shift();
    else if (brush) {
      const mode = parseInt((ui.brush && ui.brush.value) || '0', 10);
      const size = parseFloat((ui.size && ui.size.value) || '10');
      const col = hsl(parseFloat((ui.hue && ui.hue.value) || '0.08'));
      bs = [brush[0], brush[1], size, mode, col[0], col[1], col[2]];
    }
    buArr[0] = bs ? bs[0] : 0; buArr[1] = bs ? bs[1] : 0;
    buArr[2] = bs ? bs[2] : 0; buArr[3] = bs ? bs[3] : 0;
    buArr[4] = bs ? bs[4] : 0; buArr[5] = bs ? bs[5] : 0; buArr[6] = bs ? bs[6] : 0;
    device.queue.writeBuffer(buBuf, 0, buArr);
    vuArr[0] = parseInt((ui.view && ui.view.value) || '0', 10);
    device.queue.writeBuffer(vuBuf, 0, vuArr);

    const gx = Math.ceil(SW / 8), gy = Math.ceil(SH / 8);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    /* 画笔（每帧走一次，无笔时半径 0 = 纯复制） */
    cp.setPipeline(paintP);
    cp.setBindGroup(0, paintBG[sPing]);
    cp.dispatchWorkgroups(gx, gy);
    sPing = 1 - sPing;
    /* JFA */
    cp.setPipeline(seedP);
    cp.setBindGroup(0, seedBG[sPing]);
    cp.dispatchWorkgroups(gx, gy);
    cp.setPipeline(jfaP);
    for (let k = 0; k < jfaBG.length; k++) {
      cp.setBindGroup(0, jfaBG[k]);
      cp.dispatchWorkgroups(gx, gy);
    }
    /* 级联：自顶向下 */
    cp.setPipeline(cascP);
    for (let i = NC - 1; i >= 0; i--) {
      cp.setBindGroup(0, cascBG[sPing][i]);
      cp.dispatchWorkgroups(gx, gy);
    }
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    rp.setPipeline(showP);
    rp.setBindGroup(0, showBG[sPing]);
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
      hud.textContent = SW + '×' + SH + ' · ' + NC + ' 级联 · 探针 2px~' + (1 << NC) + 'px · ' +
        (canTime ? 'GI ' + gpuMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
