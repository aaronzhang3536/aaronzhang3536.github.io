/* 评论：giscus（GitHub Discussions）
   懒加载：滚动到评论区附近才注入脚本；
   主题跟随站点切换；加载失败时降级为 Discussions 链接。 */
const REPO = 'aaronzhang3536/aaronzhang3536.github.io';
const GISCUS = {
  src: 'https://giscus.app/client.js',
  'data-repo': REPO,
  'data-repo-id': 'R_kgDOJcBG-A',
  'data-category': 'Announcements',
  'data-category-id': 'DIC_kwDOJcBG-M4DAehs',
  'data-mapping': 'pathname',
  'data-strict': '0',
  'data-reactions-enabled': '1',
  'data-emit-metadata': '0',
  'data-input-position': 'top',
  'data-lang': 'zh-CN',
  crossorigin: 'anonymous',
};

function giscusTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light' : 'transparent_dark';
}

function postTheme() {
  const frame = document.querySelector('iframe.giscus-frame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(
      { giscus: { setConfig: { theme: giscusTheme() } } }, 'https://giscus.app');
  }
}

function fallback(box) {
  box.innerHTML =
    '<p class="mono cmt-empty">评论组件加载失败（giscus 暂不可达）。</p>' +
    '<div class="cmt-foot"><a class="pie-btn" target="_blank" rel="noopener" ' +
    'href="https://github.com/' + REPO + '/discussions">去 GitHub Discussions 查看评论 →</a></div>';
}

function mount(box) {
  const s = document.createElement('script');
  Object.keys(GISCUS).forEach((k) => s.setAttribute(k, GISCUS[k]));
  s.setAttribute('data-theme', giscusTheme());
  s.async = true;
  s.onerror = () => fallback(box);
  const timer = setTimeout(() => {
    if (!document.querySelector('iframe.giscus-frame')) fallback(box);
  }, 12000);
  window.addEventListener('message', function ok(e) {
    if (e.origin === 'https://giscus.app') {
      clearTimeout(timer);
      window.removeEventListener('message', ok);
    }
  });
  box.appendChild(s);
  /* 站点主题切换时同步 giscus 主题 */
  new MutationObserver(postTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
}

function init() {
  const box = document.getElementById('cmt-box');
  if (!box) return;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        mount(box);
      }
    }, { rootMargin: '600px 0px' });
    io.observe(box);
  } else {
    mount(box);
  }
}
init();
