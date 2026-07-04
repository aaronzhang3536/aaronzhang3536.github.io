/* 评论：基于 GitHub Issues 的零依赖实现
   每篇文章对应一个标题为 "comments: <slug>" 的 issue；
   前端通过公开 API 只读渲染，发评论跳转 GitHub。 */
const REPO = 'aaronzhang3536/aaronzhang3536.github.io';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getJSON(url) {
  const key = 'yzzn-cmt:' + url;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.d;
  } catch (e) {}
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('http ' + r.status);
  const d = await r.json();
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (e) {}
  return d;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN') + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function renderItem(c) {
  return '<div class="cmt-item">' +
    '<img class="cmt-ava" src="' + esc(c.user.avatar_url) + '&s=72" width="34" height="34" loading="lazy" alt="" />' +
    '<div class="cmt-main">' +
    '<div class="cmt-meta mono"><a href="' + esc(c.user.html_url) + '" target="_blank" rel="noopener">' +
    esc(c.user.login) + '</a><span>' + fmtTime(c.created_at) + '</span></div>' +
    '<div class="cmt-body">' + esc(c.body || '') + '</div>' +
    '</div></div>';
}

async function init() {
  const box = document.getElementById('cmt');
  if (!box) return;
  const slug = box.getAttribute('data-slug');
  const title = 'comments: ' + slug;
  const listEl = box.querySelector('#cmt-list');
  const footEl = box.querySelector('#cmt-foot');
  const newUrl = 'https://github.com/' + REPO + '/issues/new' +
    '?title=' + encodeURIComponent(title) +
    '&body=' + encodeURIComponent('本 issue 是文章《' + slug + '》的评论串，直接在下方留言即可。\n\nhttps://aaronzhang3536.github.io/posts/' + slug + '/');

  function fallback(msg) {
    listEl.innerHTML = '<p class="mono cmt-empty">' + msg + '</p>';
    footEl.innerHTML = '<a class="pie-btn" target="_blank" rel="noopener" href="https://github.com/' + REPO + '/issues">去 GitHub 查看评论 →</a>';
  }

  try {
    const q = 'repo:' + REPO + ' in:title type:issue "' + title + '"';
    const res = await getJSON('https://api.github.com/search/issues?q=' + encodeURIComponent(q));
    const issue = (res.items || []).find((it) => it.title === title);
    if (!issue) {
      listEl.innerHTML = '<p class="mono cmt-empty">还没有评论。</p>';
      footEl.innerHTML = '<a class="pie-btn primary" target="_blank" rel="noopener" href="' + newUrl + '">成为第一个评论的人 →</a>' +
        '<span class="mono cmt-note">将跳转 GitHub 新建评论串（需 GitHub 账号）</span>';
      return;
    }
    const comments = await getJSON(
      'https://api.github.com/repos/' + REPO + '/issues/' + issue.number + '/comments?per_page=50');
    listEl.innerHTML = comments.length
      ? comments.map(renderItem).join('')
      : '<p class="mono cmt-empty">评论串已建立，还没有留言。</p>';
    footEl.innerHTML = '<a class="pie-btn primary" target="_blank" rel="noopener" href="' +
      esc(issue.html_url) + '">在 GitHub 上评论 →</a>' +
      '<span class="mono cmt-note">共 ' + comments.length + ' 条 · 数据来自 GitHub Issues</span>';
  } catch (err) {
    fallback('评论加载失败（GitHub API 暂不可达或超出频率限制）。');
  }
}
init();
