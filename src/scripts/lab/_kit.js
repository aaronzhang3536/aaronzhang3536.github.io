/* 实验室公共护栏 —— 各 lab 模块共用的那一小块，只管「活着」不管「画什么」：
   · 失败 / 出错提示：#lab-nogpu + HUD；WebGPU 设备丢失（device.lost）与未捕获错误（uncapturederror）
   · 帧循环：画布离屏（IntersectionObserver）或标签页隐藏时暂停，画布移出文档时彻底停止
   · 尺寸：按 .lab-stage 宽度排版画布，背板取内容盒 × DPR；ResizeObserver + DPR 变化时防抖重排
   · 触控：交互画布 touch-action:none，拖拽不再滚动页面
   · 主题：主题切换时通知 Canvas2D 模块刷新调色板
   只在调用时访问 DOM / 浏览器全局，模块求值本身无副作用。 */

export const NO_WEBGPU =
  '当前浏览器不支持 WebGPU —— 请用新版 Chrome / Edge（桌面 113 起，Android 121 起）、' +
  'Safari 26 起（macOS / iOS / iPadOS）或 Windows 上的 Firefox 141 起打开这个实验。';
export const NO_ADAPTER =
  'WebGPU adapter 请求失败 —— 显卡或驱动可能在浏览器的黑名单里，或硬件加速被关闭了。';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || String(s || '');

/* 读取页面上的画布与提示元素，执行模块主函数；主函数抛出 / reject 的任何异常都落到可见提示上 */
export function boot(main, opts) {
  const cvs = document.getElementById('lab-cv');
  if (!cvs) return null;
  const lab = createLab(cvs, opts);
  let p;
  try { p = Promise.resolve(main(lab)); } catch (e) { p = Promise.reject(e); }
  p.catch((e) => lab.crash(e));
  return lab;
}

export function createLab(cvs, opts) {
  const o = opts || {};
  const gpu = o.gpu !== false;
  const hudEl = document.getElementById('lab-hud');
  const noGpu = document.getElementById('lab-nogpu');
  const cleanups = [];
  let pinned = '', pinUntil = 0, loopCtl = null, errCount = 0;

  const lab = { cvs, hudEl, noGpu, gpu, stopped: false, looping: false };

  function showNote(msg) {
    if (noGpu) { noGpu.hidden = false; noGpu.textContent = msg; }
  }

  /* HUD 写入：有置顶提示（错误）时提示优先 */
  lab.hud = (text) => {
    if (!hudEl) return;
    if (pinned && now() < pinUntil) text = pinned;
    else pinned = '';
    if (hudEl.textContent !== text) hudEl.textContent = text;
  };
  /* 置顶提示：ms 毫秒内（Infinity = 永久）盖住模块自己的 HUD 文本 */
  lab.notice = (msg, ms) => {
    pinned = msg;
    pinUntil = now() + (ms == null ? Infinity : ms);
    if (hudEl) hudEl.textContent = msg;
  };

  /* 初始化失败：停循环、藏画布、亮出原因（没有 #lab-nogpu 的页面写进 HUD） */
  lab.fail = (msg, failOpts) => {
    lab.stop();
    if (noGpu) {
      if (hudEl) hudEl.textContent = '';
      showNote(msg);
      if (!(failOpts && failOpts.keepCanvas)) cvs.style.display = 'none';
    } else {
      lab.notice(msg);
    }
  };
  /* 运行期致命错误（设备丢失 / 帧内异常）：停循环，画布保留最后一帧，HUD 与提示段同时说明 */
  lab.halt = (msg) => {
    if (lab.stopped) return;
    lab.stop();
    lab.notice(msg);
    showNote(msg);
  };
  lab.crash = (e) => {
    console.error('[lab]', e);
    const m = firstLine(e && e.message ? e.message : e);
    if (lab.looping) lab.halt('运行出错：' + m + ' —— 刷新页面重试。');
    else lab.fail((gpu ? 'WebGPU 初始化失败：' : '实验初始化失败：') + m);
  };

  lab.stop = () => {
    if (lab.stopped) return;
    lab.stopped = true;
    if (loopCtl) loopCtl.cancel();
    cleanups.splice(0).forEach((f) => { try { f(); } catch (e) { /* 清理尽力而为 */ } });
  };

  /* ---------- WebGPU ---------- */
  lab.adapter = async (adapterOpts) => {
    if (!navigator.gpu) { lab.fail(NO_WEBGPU); return null; }
    const adapter = await navigator.gpu.requestAdapter(adapterOpts);
    if (!adapter) { lab.fail(NO_ADAPTER); return null; }
    return adapter;
  };
  lab.device = async (adapter, desc) => {
    const device = await adapter.requestDevice(desc);
    lab.watch(device);
    return device;
  };
  lab.watch = (device) => {
    device.lost.then((info) => {
      if (info && info.reason === 'destroyed') return;   /* 主动销毁不算事故 */
      const why = info && info.message ? '（' + firstLine(info.message) + '）' : '';
      lab.halt('GPU 设备丢失' + why + ' —— 刷新页面可重新初始化。');
    });
    device.addEventListener('uncapturederror', (ev) => {
      errCount++;
      const m = firstLine(ev.error && ev.error.message ? ev.error.message : ev.error);
      if (errCount === 1) console.error('[lab] GPU 错误：', ev.error && ev.error.message ? ev.error.message : ev.error);
      /* 持续报错时一直置顶；偶发错误 4 秒后让位给正常 HUD */
      if (!lab.stopped) lab.notice('⚠ GPU 错误：' + m.slice(0, 100) + '（详见控制台）', 4000);
    });
    return device;
  };
  lab.context = () => {
    const ctx = cvs.getContext('webgpu');
    if (!ctx) throw new Error('canvas.getContext("webgpu") 返回空（这块画布无法创建 WebGPU 上下文）');
    return ctx;
  };

  /* ---------- 帧循环 ---------- */
  /* frame(ts) 每帧调用；onStart(ts) 在首帧和每次从暂停恢复的第一帧前调用（模块用它重置计时基准） */
  lab.loop = (frame, onStart) => {
    let raf = 0, onScreen = true, visible = !document.hidden, primed = false;
    const active = () => onScreen && visible;
    const tick = (ts) => {
      raf = 0;
      if (lab.stopped) return;
      if (!cvs.isConnected) { lab.stop(); return; }
      if (!active()) { primed = false; return; }   /* 暂停：不再续约，恢复时由 kick() 重新排 */
      raf = requestAnimationFrame(tick);
      if (!primed) { primed = true; if (onStart) onStart(ts); }
      try { frame(ts); } catch (e) { lab.crash(e); }
    };
    const kick = () => {
      if (lab.stopped) return;
      if (!cvs.isConnected) { lab.stop(); return; }
      if (!raf && active()) raf = requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((ents) => {
        onScreen = ents[ents.length - 1].isIntersecting;
        if (!onScreen) primed = false;
        kick();
      }, { rootMargin: '120px 0px' });
      io.observe(cvs);
      cleanups.push(() => io.disconnect());
    }
    const onVis = () => {
      visible = !document.hidden;
      if (!visible) primed = false;
      kick();
    };
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
    loopCtl = { kick, cancel: () => { if (raf) cancelAnimationFrame(raf); raf = 0; } };
    lab.looping = true;
    kick();
    return loopCtl;
  };
  /* 暂停中也想立刻画一帧时用（例如参数改了）；在跑时无副作用 */
  lab.kick = () => { if (loopCtl) loopCtl.kick(); };

  /* ---------- 尺寸 ---------- */
  /* spec: { aspect: 高/宽, dprCap: DPR 上限, scale: 固定背板倍率（给了就不看 DPR）, maxW: 最大 CSS 宽 }
     CSS 宽 = min(maxW, .lab-stage 宽)；背板 = 内容盒（扣掉边框）× 倍率，画面与屏幕像素一一对应 */
  lab.measure = (spec) => {
    const par = cvs.parentElement;
    const cssW = Math.max(1, Math.min(spec.maxW || 920, (par && par.clientWidth) || spec.maxW || 920));
    const cssH = Math.max(1, Math.round(cssW * spec.aspect));
    if (cvs.style.width !== cssW + 'px') cvs.style.width = cssW + 'px';
    if (cvs.style.height !== cssH + 'px') cvs.style.height = cssH + 'px';
    const cw = cvs.clientWidth || cssW, ch = cvs.clientHeight || cssH;
    const dpr = spec.scale || Math.min((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, spec.dprCap || 2);
    return { cssW, cssH, cw, ch, dpr, pw: Math.max(1, Math.round(cw * dpr)), ph: Math.max(1, Math.round(ch * dpr)) };
  };
  /* 排版 + 设定背板尺寸；返回几何。之后容器宽度或 DPR 变了（防抖 150ms），
     重新排版，背板尺寸真变了才回调 onChange(新几何) —— 模块在里面重建与尺寸相关的资源 */
  lab.fit = (spec, onChange) => {
    let g = lab.measure(spec);
    if (spec.backing !== false) { cvs.width = g.pw; cvs.height = g.ph; }
    if (!onChange) return g;
    let timer = 0;
    const refit = () => {
      timer = 0;
      if (lab.stopped || !cvs.isConnected || cvs.style.display === 'none') return;
      const n = lab.measure(spec);
      if (n.pw === g.pw && n.ph === g.ph && n.cw === g.cw && n.ch === g.ch && n.dpr === g.dpr) return;
      g = n;
      if (spec.backing !== false) { cvs.width = g.pw; cvs.height = g.ph; }
      try { onChange(g); } catch (e) { lab.crash(e); }
      lab.kick();
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(refit, 150); };
    if (typeof ResizeObserver === 'function' && cvs.parentElement) {
      const ro = new ResizeObserver(later);
      ro.observe(cvs.parentElement);
      cleanups.push(() => ro.disconnect());
    } else {
      addEventListener('resize', later);
      cleanups.push(() => removeEventListener('resize', later));
    }
    /* DPR 变化（换显示器 / 系统缩放）不一定改变 CSS 宽，单独盯 */
    let mq = null;
    const onDpr = () => { watchDpr(); later(); };
    const watchDpr = () => {
      if (mq) mq.removeEventListener('change', onDpr);
      if (typeof matchMedia !== 'function') return;
      mq = matchMedia('(resolution: ' + ((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1) + 'dppx)');
      mq.addEventListener('change', onDpr);
    };
    watchDpr();
    cleanups.push(() => { clearTimeout(timer); if (mq) mq.removeEventListener('change', onDpr); });
    return g;
  };

  /* ---------- 触控 ---------- */
  /* 交互画布：拖拽交给页面脚本，不触发滚动 / 缩放（否则先滚页面、随后 pointercancel） */
  lab.touch = () => { cvs.style.touchAction = 'none'; };

  return lab;
}

/* ---------- 主题 ---------- */
function themeKey() {
  const root = document.documentElement;
  const light = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  return (root.getAttribute('data-theme') || '') + '|' + (document.body.classList.contains('vm-wire') ? 'w' : '') + '|' + (light ? 'l' : 'd');
}
/* 主题切换（html[data-theme] / body.vm-wire / 系统明暗）时回调；返回取消函数 */
export function onThemeChange(cb) {
  let key = themeKey();
  const check = () => { const k = themeKey(); if (k !== key) { key = k; cb(); } };
  const mo = new MutationObserver(check);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  if (mq) mq.addEventListener('change', check);
  return () => { mo.disconnect(); if (mq) mq.removeEventListener('change', check); };
}
/* 颜色串（#rgb / #rrggbb / rgb()）的相对亮度 0..1；解析不了返回 -1 */
export function luminance(c) {
  const s = String(c || '').trim();
  let r, g, b;
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) [r, g, b] = m[1].split('').map((h) => parseInt(h + h, 16));
  else if ((m = s.match(/^#([0-9a-f]{6})/i))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i))) [r, g, b] = [m[1], m[2], m[3]].map(Number);
  else return -1;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
