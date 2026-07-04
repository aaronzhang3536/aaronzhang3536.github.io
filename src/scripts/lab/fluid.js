/* 2D 流体模拟 — 裸 WebGPU：Stable Fluids（半拉格朗日平流 + Jacobi 压力投影）+ 涡量约束 */

const SIM_W = 512, SIM_H = 288, JACOBI = 26;

/* 共享 uniform：
   a: x dt, y 速度耗散, z 染料耗散, w 涡量强度
   b: xy 溅射点 uv, zw 溅射方向（uv 增量）
   c: rgb 染料颜色, w 溅射半径（0 = 本帧无溅射） */
const FU_DECL = /* wgsl */ `
struct FU { a: vec4f, b: vec4f, c: vec4f };
`;

const ADVECT_VEL_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(dim);
  let v = textureSampleLevel(src, samp, uv, 0.0).xy;
  let q = uv - fu.a.x * v;
  let nv = textureSampleLevel(src, samp, q, 0.0).xy * fu.a.y;
  textureStore(dst, id.xy, vec4f(nv, 0.0, 0.0));
}`;

const SPLAT_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var dyeIn: texture_2d<f32>;
@group(0) @binding(3) var velOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var dyeOut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  var v = textureLoad(velIn, id.xy, 0).xy;
  var d = textureLoad(dyeIn, id.xy, 0).rgb;
  if (fu.c.w > 0.0) {
    let uv = (vec2f(id.xy) + 0.5) / vec2f(dim);
    let aspect = f32(dim.x) / f32(dim.y);
    var off = uv - fu.b.xy;
    off.x *= aspect;
    let g = exp(-dot(off, off) / (fu.c.w * fu.c.w));
    v += fu.b.zw * 60.0 * g;
    d += fu.c.rgb * g * 0.5;
  }
  textureStore(velOut, id.xy, vec4f(v, 0.0, 0.0));
  textureStore(dyeOut, id.xy, vec4f(d, 1.0));
}`;

const CURL_WGSL = /* wgsl */ `
@group(0) @binding(0) var vel: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
fn V(p: vec2i, dim: vec2u) -> vec2f {
  let q = clamp(p, vec2i(0), vec2i(dim) - 1);
  return textureLoad(vel, q, 0).xy;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let c = 0.5 * (V(p + vec2i(1, 0), dim).y - V(p - vec2i(1, 0), dim).y
               - V(p + vec2i(0, 1), dim).x + V(p - vec2i(0, 1), dim).x);
  textureStore(dst, id.xy, vec4f(c, 0.0, 0.0, 0.0));
}`;

const VORT_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var velIn: texture_2d<f32>;
@group(0) @binding(2) var curlT: texture_2d<f32>;
@group(0) @binding(3) var velOut: texture_storage_2d<rgba16float, write>;
fn C(p: vec2i, dim: vec2u) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(dim) - 1);
  return textureLoad(curlT, q, 0).x;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let c = C(p, dim);
  var grad = 0.5 * vec2f(
    abs(C(p + vec2i(1, 0), dim)) - abs(C(p - vec2i(1, 0), dim)),
    abs(C(p + vec2i(0, 1), dim)) - abs(C(p - vec2i(0, 1), dim)));
  grad = grad / (length(grad) + 1e-5);
  var v = textureLoad(velIn, id.xy, 0).xy;
  v += fu.a.w * c * vec2f(grad.y, -grad.x) * fu.a.x;
  textureStore(velOut, id.xy, vec4f(v, 0.0, 0.0));
}`;

const DIV_WGSL = /* wgsl */ `
@group(0) @binding(0) var vel: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;
fn V(p: vec2i, dim: vec2u) -> vec2f {
  let q = clamp(p, vec2i(0), vec2i(dim) - 1);
  return textureLoad(vel, q, 0).xy;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let d = 0.5 * (V(p + vec2i(1, 0), dim).x - V(p - vec2i(1, 0), dim).x
               + V(p + vec2i(0, 1), dim).y - V(p - vec2i(0, 1), dim).y);
  textureStore(dst, id.xy, vec4f(d, 0.0, 0.0, 0.0));
}`;

const JACOBI_WGSL = /* wgsl */ `
@group(0) @binding(0) var prIn: texture_2d<f32>;
@group(0) @binding(1) var divT: texture_2d<f32>;
@group(0) @binding(2) var prOut: texture_storage_2d<r32float, write>;
fn P(p: vec2i, dim: vec2u) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(dim) - 1);
  return textureLoad(prIn, q, 0).x;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(prOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  let np = (P(p + vec2i(1, 0), dim) + P(p - vec2i(1, 0), dim)
          + P(p + vec2i(0, 1), dim) + P(p - vec2i(0, 1), dim)
          - textureLoad(divT, id.xy, 0).x) * 0.25;
  textureStore(prOut, id.xy, vec4f(np, 0.0, 0.0, 0.0));
}`;

const SUBGRAD_WGSL = /* wgsl */ `
@group(0) @binding(0) var velIn: texture_2d<f32>;
@group(0) @binding(1) var prT: texture_2d<f32>;
@group(0) @binding(2) var velOut: texture_storage_2d<rgba16float, write>;
fn P(p: vec2i, dim: vec2u) -> f32 {
  let q = clamp(p, vec2i(0), vec2i(dim) - 1);
  return textureLoad(prT, q, 0).x;
}
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(velOut);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let p = vec2i(id.xy);
  var v = textureLoad(velIn, id.xy, 0).xy;
  v -= 0.5 * vec2f(P(p + vec2i(1, 0), dim) - P(p - vec2i(1, 0), dim),
                   P(p + vec2i(0, 1), dim) - P(p - vec2i(0, 1), dim));
  /* 边界：外圈一格速度清零（无滑移壁） */
  if (id.x == 0u || id.y == 0u || id.x == dim.x - 1u || id.y == dim.y - 1u) { v = vec2f(0.0); }
  textureStore(velOut, id.xy, vec4f(v, 0.0, 0.0));
}`;

const ADVECT_DYE_WGSL = FU_DECL + /* wgsl */ `
@group(0) @binding(0) var<uniform> fu: FU;
@group(0) @binding(1) var dye: texture_2d<f32>;
@group(0) @binding(2) var vel: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn cs(@builtin(global_invocation_id) id: vec3u) {
  let dim = textureDimensions(dst);
  if (id.x >= dim.x || id.y >= dim.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(dim);
  let v = textureSampleLevel(vel, samp, uv, 0.0).xy;
  let q = uv - fu.a.x * v;
  let d = textureSampleLevel(dye, samp, q, 0.0).rgb * fu.a.z;
  textureStore(dst, id.xy, vec4f(d, 1.0));
}`;

const SHOW_WGSL = /* wgsl */ `
struct VU { m: vec4f };   /* x 视图：0 染料 1 速度 2 压力 3 涡量 */
@group(0) @binding(0) var<uniform> vu: VU;
@group(0) @binding(1) var dye: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var vel: texture_2d<f32>;
@group(0) @binding(4) var prT: texture_2d<f32>;
@group(0) @binding(5) var curlT: texture_2d<f32>;
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * vec2f(0.5, -0.5) + 0.5;
  return o;
}
fn hue(h: f32) -> vec3f {
  return clamp(vec3f(abs(h * 6.0 - 3.0) - 1.0, 2.0 - abs(h * 6.0 - 2.0), 2.0 - abs(h * 6.0 - 4.0)), vec3f(0.0), vec3f(1.0));
}
/* 发散色标：负蓝正红，零为暗灰 */
fn diverge(t: f32) -> vec3f {
  let a = clamp(t, -1.0, 1.0);
  if (a < 0.0) { return mix(vec3f(0.05, 0.06, 0.09), vec3f(0.15, 0.45, 0.95), -a); }
  return mix(vec3f(0.05, 0.06, 0.09), vec3f(0.95, 0.30, 0.12), a);
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let m = u32(vu.m.x);
  var c: vec3f;
  if (m == 1u) {
    /* 速度场：方向→色相，速率→亮度 */
    let v = textureSampleLevel(vel, samp, in.uv, 0.0).xy;
    let sp = length(v);
    c = hue(fract(atan2(v.y, v.x) / 6.2831853 + 0.5)) * clamp(sp * 1.6, 0.02, 1.0);
  } else if (m == 2u) {
    let dim = vec2f(textureDimensions(prT));
    let p = textureLoad(prT, vec2i(in.uv * dim), 0).x;
    c = diverge(p * 4.0);
  } else if (m == 3u) {
    let dim = vec2f(textureDimensions(curlT));
    let w = textureLoad(curlT, vec2i(in.uv * dim), 0).x;
    c = diverge(w * 3.0);
  } else {
    c = textureSample(dye, samp, in.uv).rgb;
    c = c / (1.0 + c) * 1.35;
    c += vec3f(0.010, 0.012, 0.02);
  }
  c = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  return vec4f(c, 1.0);
}`;

async function main() {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return;
  const hud = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const wgslEl = document.getElementById('lab-wgsl');
  if (wgslEl) {
    wgslEl.textContent =
      '// ---- 平流（半拉格朗日） ----' + ADVECT_VEL_WGSL +
      '\n\n// ---- 涡量约束 ----' + VORT_WGSL +
      '\n\n// ---- 散度 ----' + DIV_WGSL +
      '\n\n// ---- Jacobi 压力迭代 ----' + JACOBI_WGSL +
      '\n\n// ---- 压力梯度投影 ----' + SUBGRAD_WGSL;
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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = W * dpr; cvs.height = H * dpr;
  cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
  const ctx = cvs.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const mkTex = (fmt) => device.createTexture({
    size: [SIM_W, SIM_H], format: fmt,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  const vel = [mkTex('rgba16float'), mkTex('rgba16float')];
  const dye = [mkTex('rgba16float'), mkTex('rgba16float')];
  const pr = [mkTex('r32float'), mkTex('r32float')];
  const divT = mkTex('r32float');
  const curlT = mkTex('r32float');
  const vV = vel.map((t) => t.createView());
  const dV = dye.map((t) => t.createView());
  const pV = pr.map((t) => t.createView());
  const divV = divT.createView();
  const curlV = curlT.createView();
  const samp = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  const fuBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const mkCP = (code) => device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'cs' },
  });
  const advVelP = mkCP(ADVECT_VEL_WGSL);
  const splatP = mkCP(SPLAT_WGSL);
  const curlP = mkCP(CURL_WGSL);
  const vortP = mkCP(VORT_WGSL);
  const divP = mkCP(DIV_WGSL);
  const jacP = mkCP(JACOBI_WGSL);
  const subP = mkCP(SUBGRAD_WGSL);
  const advDyeP = mkCP(ADVECT_DYE_WGSL);
  const showMod = device.createShaderModule({ code: SHOW_WGSL });
  const showP = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: showMod, entryPoint: 'vs' },
    fragment: { module: showMod, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  /* 每帧固定的乒乓次序：
     advectVel v0→v1 · splat(v1,d0)→(v0,d1) · curl v0 · vort v0→v1
     · div v1 · jacobi p0↔p1 ×26（终回 p0） · subGrad(v1,p0)→v0 · advectDye(d1,v0)→d0 */
  const bg = (pipe, entries) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: entries.map((r, i) => ({ binding: i, resource: r })),
  });
  const fuR = { buffer: fuBuf };
  const advVelBG = bg(advVelP, [fuR, vV[0], samp, vV[1]]);
  const splatBG = bg(splatP, [fuR, vV[1], dV[0], vV[0], dV[1]]);
  const curlBG = bg(curlP, [vV[0], curlV]);
  const vortBG = bg(vortP, [fuR, vV[0], curlV, vV[1]]);
  const divBG = bg(divP, [vV[1], divV]);
  const jacBG = [bg(jacP, [pV[0], divV, pV[1]]), bg(jacP, [pV[1], divV, pV[0]])];
  const subBG = bg(subP, [vV[1], pV[0], vV[0]]);
  const advDyeBG = bg(advDyeP, [fuR, dV[1], vV[0], samp, dV[0]]);
  const vuBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const showBG = bg(showP, [{ buffer: vuBuf }, dV[0], samp, vV[0], pV[0], curlV]);

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

  /* 交互：指针搅动；闲置时自动泼溅 */
  const $ = (id) => document.getElementById(id);
  const ui = { vort: $('fl-vort'), keep: $('fl-keep'), rad: $('fl-rad'), view: $('fl-view') };
  let pointer = null, lastMove = -10, hue = Math.random();
  function uvOf(e) {
    const r = cvs.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }
  cvs.addEventListener('pointermove', (e) => {
    const uv = uvOf(e);
    const prevP = pointer;
    pointer = { uv, d: prevP ? [uv[0] - prevP.uv[0], uv[1] - prevP.uv[1]] : [0, 0] };
    lastMove = performance.now() / 1000;
  });
  cvs.addEventListener('pointerleave', () => { pointer = null; });
  function hsl(h) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return 0.85 - 0.8 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }

  let auto = { frames: 0, uv: [0.5, 0.5], d: [0, 0], col: [1, 1, 1] };
  let autoNext = 0;

  const fuArr = new Float32Array(12);
  let prev = 0, fps = 60, t = 0;

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!cvs.isConnected) return;
    const dt = Math.min((ts - prev) / 1000, 0.033) || 0.016;
    prev = ts;
    t = ts / 1000;
    fps += ((1 / Math.max(dt, 0.001)) - fps) * 0.05;

    /* 溅射来源：指针优先；闲置 2.5s 后自动泼 */
    let sUV = null, sD = [0, 0], sCol = [1, 1, 1];
    if (pointer && (pointer.d[0] || pointer.d[1])) {
      hue = (hue + Math.hypot(pointer.d[0], pointer.d[1]) * 0.6) % 1;
      sUV = pointer.uv; sD = pointer.d; sCol = hsl(hue);
      pointer = { uv: pointer.uv, d: [0, 0] };
    } else if (t - lastMove > 2.5) {
      if (t > autoNext) {
        autoNext = t + 0.55 + Math.random() * 0.6;
        const a = Math.random() * Math.PI * 2;
        auto = {
          frames: 7,
          uv: [0.18 + Math.random() * 0.64, 0.2 + Math.random() * 0.6],
          d: [Math.cos(a) * 0.011, Math.sin(a) * 0.011],
          col: hsl(Math.random()),
        };
      }
      if (auto.frames > 0) {
        auto.frames--;
        sUV = auto.uv; sD = auto.d; sCol = auto.col;
      }
    }

    const vort = parseFloat((ui.vort && ui.vort.value) || '18');
    const keep = parseFloat((ui.keep && ui.keep.value) || '0.985');
    const rad = parseFloat((ui.rad && ui.rad.value) || '0.014');

    fuArr[0] = dt; fuArr[1] = 0.999; fuArr[2] = keep; fuArr[3] = vort;
    fuArr[4] = sUV ? sUV[0] : 0; fuArr[5] = sUV ? sUV[1] : 0;
    fuArr[6] = sD[0]; fuArr[7] = sD[1];
    fuArr[8] = sCol[0]; fuArr[9] = sCol[1]; fuArr[10] = sCol[2];
    fuArr[11] = sUV ? rad : 0;
    device.queue.writeBuffer(fuBuf, 0, fuArr);
    device.queue.writeBuffer(vuBuf, 0, new Float32Array([parseInt((ui.view && ui.view.value) || '0', 10), 0, 0, 0]));

    const gx = Math.ceil(SIM_W / 8), gy = Math.ceil(SIM_H / 8);
    const enc = device.createCommandEncoder();
    const cp = enc.beginComputePass(canTime ? {
      timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
    } : {});
    const run = (pipe, group) => {
      cp.setPipeline(pipe);
      cp.setBindGroup(0, group);
      cp.dispatchWorkgroups(gx, gy);
    };
    run(advVelP, advVelBG);
    run(splatP, splatBG);
    run(curlP, curlBG);
    run(vortP, vortBG);
    run(divP, divBG);
    for (let i = 0; i < JACOBI; i++) run(jacP, jacBG[i % 2]);
    run(subP, subBG);
    run(advDyeP, advDyeBG);
    cp.end();

    const rp = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store',
      }],
    });
    rp.setPipeline(showP);
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
      hud.textContent = SIM_W + '×' + SIM_H + ' 网格 · Jacobi ×' + JACOBI + ' · ' +
        (canTime ? 'sim ' + gpuMs.toFixed(2) + ' ms · ' : '') + Math.round(fps) + ' fps';
    }
  }
  requestAnimationFrame((ts) => { prev = ts; loop(ts); });
}

main();
