(function () {
    var body = document.body;
    var SITE_TITLE0 = document.title;

    /* 细线 SVG 图标（stroke: currentColor，跟随按钮颜色） */
    var SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var CLOUD = '<path d="M4.6 9.8a2.9 2.9 0 1 1 .5-5.7 4 4 0 0 1 7.8 1.1 2.4 2.4 0 0 1-.9 4.6z"/>';
    var SUN = '<circle cx="8" cy="8" r="2.9"/><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"/>';
    var icons = {
      dark:  SVG + '<path d="M13.4 9.6A5.8 5.8 0 1 1 6.4 2.6a4.6 4.6 0 0 0 7 7z"/></svg>',
      light: SVG + SUN + '</svg>',
      wire:  SVG + '<path d="M3 5.5h7v7H3zM6 3h7v7h-7zM3 5.5 6 3M10 5.5 13 3M10 12.5 13 10M3 12.5 6 10"/></svg>',
      rain:  SVG + CLOUD + '<path d="M5.4 11.6l-.7 1.9M8.2 11.6l-.7 1.9M11 11.6l-.7 1.9"/></svg>',
      storm: SVG + CLOUD + '<path d="M8.6 10.6 7 12.9h2.1L7.5 15.4"/></svg>',
      wind:  SVG + '<path d="M1.8 5.2h6.7a1.7 1.7 0 1 0-1.7-1.7M1.8 8.3h9.8a1.7 1.7 0 1 1-1.7 1.7M1.8 11.4h4.6"/></svg>',
      snow:  SVG + '<path d="M8 1.8v12.4M2.6 4.9l10.8 6.2M13.4 4.9 2.6 11.1"/></svg>',
      sand:  SVG + '<path d="M1.6 4.6c2.4-1.6 4.8 1.6 7.2 0 1.2-.8 2.4-1 3.6-.4M1.6 8.2c2.4-1.6 4.8 1.6 7.2 0 1.2-.8 2.4-1 3.6-.4M1.6 11.8c2.4-1.6 4.8 1.6 7.2 0"/><circle cx="13.6" cy="8.6" r=".7" fill="currentColor" stroke="none"/><circle cx="12.6" cy="12.2" r=".7" fill="currentColor" stroke="none"/></svg>',
      clear: SVG + SUN + '</svg>',
      off:   SVG + SUN + '<path d="M2 14 14 2"/></svg>'
    };

    var btnTheme = document.getElementById('btn-theme');
    var themeOrder = ['dark', 'light', 'wire'];
    var themeNames = { dark: 'DARK', light: 'LIGHT', wire: 'WIREFRAME' };
    var themeZh = { dark: '暗色', light: '亮色', wire: '线框' };
    var curTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    var lastLit = curTheme;
    function setTheme(m) {
      curTheme = m;
      body.classList.toggle('vm-wire', m === 'wire');
      if (m !== 'wire') {
        document.documentElement.setAttribute('data-theme', m);
        lastLit = m;
      }
      btnTheme.innerHTML = icons[m];
      var tl = '主题：' + themeZh[m] + '（点击切换）';
      btnTheme.title = tl;
      btnTheme.setAttribute('aria-label', tl);
    }
    btnTheme.addEventListener('click', function () {
      setTheme(themeOrder[(themeOrder.indexOf(curTheme) + 1) % themeOrder.length]);
    });
    setTheme(curTheme);

    /* stat unit HUD：数字轻微抖动 */
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var hudSuspend = false;   /* PIE 部分模式会挂起引擎计时 */
    if (!reduced) {
      var els = {
        frame: document.getElementById('ms-frame'),
        game: document.getElementById('ms-game'),
        draw: document.getElementById('ms-draw'),
        gpu: document.getElementById('ms-gpu')
      };
      var base = { game: 4.2, draw: 3.0, gpu: 8.9 };
      setInterval(function () {
        if (hudSuspend) {
          els.game.textContent = els.draw.textContent = els.gpu.textContent = '-- ms';
          els.frame.textContent = 'suspended';
          return;
        }
        var g = base.game + (Math.random() - 0.5) * 0.6;
        var d = base.draw + (Math.random() - 0.5) * 0.4;
        var p = base.gpu + wxLoad + (Math.random() - 0.5) * 1.2;
        els.game.textContent = g.toFixed(2) + ' ms';
        els.draw.textContent = d.toFixed(2) + ' ms';
        els.gpu.textContent = p.toFixed(2) + ' ms';
        els.frame.textContent = Math.max(16.61, g + d + p * 0.55).toFixed(2) + ' ms';
      }, 500);
    }

    /* 控制台 */
    var cmd = document.getElementById('cmd');
    var echo = document.getElementById('echo');
    cmd.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var v = cmd.value.trim().toLowerCase();
      cmd.value = '';
      if (v.indexOf('weather') === 0) {
        var wm = v.slice(7).trim();
        if (!wm) echo.textContent = '用法：weather rain | storm | wind | snow | sand | clear';
        else setWeather(wm, false);
        return;
      }
      if (v === 'bg' || v.indexOf('bg ') === 0) {
        var ba = v.slice(2).trim();
        if (ba === 'off') {
          bgOn = false;
          if (bgTimer) clearInterval(bgTimer);
          bgImgs.forEach(function (im) { im.classList.remove('show'); });
          echo.textContent = '背景图已关闭。';
        } else if (ba === 'on') {
          bgOn = true; bgNext(); bgStart();
          echo.textContent = '背景图已开启，每 ' + (bgInterval / 1000) + ' 秒刷新。';
        } else if (ba === 'next') {
          if (!bgOn) { echo.textContent = '背景图处于关闭状态，先执行 bg on。'; }
          else { bgNext(); echo.textContent = '正在拉取下一张背景图…'; }
        } else if (/^\d+$/.test(ba)) {
          bgInterval = Math.max(5, parseInt(ba, 10)) * 1000;
          if (bgOn) bgStart();
          echo.textContent = '背景图刷新间隔已设为 ' + (bgInterval / 1000) + ' 秒。';
        } else {
          echo.textContent = '用法：bg on | off | next | <秒数>　当前：' +
            (bgOn ? '开启，每 ' + (bgInterval / 1000) + ' 秒刷新' : '关闭');
        }
        return;
      }
      if (v.indexOf('play') === 0) {
        var pm = v.slice(4).trim();
        var alias = {
          arcade: 'arcade', game: 'arcade',
          tea: 'tea', teabreak: 'tea',
          workout: 'workout', sport: 'workout',
          idle: 'idle', moyu: 'idle', fish: 'idle',
          zen: 'zen'
        };
        if (!pm) echo.textContent = '用法：play arcade | tea | workout | idle | zen';
        else if (alias[pm]) {
          enterPie(alias[pm]);
          echo.textContent = '已进入：' + GM[alias[pm]].zh;
        } else {
          echo.textContent = "未知 GameMode '" + pm + "'。可选：arcade tea workout idle zen";
        }
        return;
      }
      switch (v) {
        case 'wireframe': setTheme('wire'); echo.textContent = 'Theme: Wireframe'; break;
        case 'dark': setTheme('dark'); echo.textContent = 'Theme: Dark'; break;
        case 'light': setTheme('light'); echo.textContent = 'Theme: Light'; break;
        case 'lit': setTheme(lastLit); echo.textContent = 'Theme: ' + themeNames[lastLit]; break;
        case 'stat fps': echo.textContent = '60.2 FPS — 16.61 ms（稳如老狗）'; break;
        case 'help': echo.textContent = 'dark | light | wireframe | lit | weather rain|storm|… | bg on|off|next|<秒> | play arcade|tea|workout|idle|zen | stat fps | quit'; break;
        case 'quit':
          if (pieMode) exitPie(false);
          else echo.textContent = '想得美。写完这周的博客再走。';
          break;
        case '': break;
        default: echo.textContent = "未知命令 '" + v + "'。输入 help 查看可用命令。";
      }
    });

    /* ---------- 随机背景图 ----------
       图源均为免 key 的公开随机图接口（已实测可用）：
       - bing.img.run/rand.php       必应壁纸随机（约 300KB，速度快）
       - api.dujin.org/bing/1920.php 必应壁纸随机镜像
       - picsum.photos               随机摄影图（Fastly CDN） */
    var bgSrcs = [
      function () { return 'https://bing.img.run/rand.php?t=' + Date.now(); },
      function () { return 'https://api.dujin.org/bing/1920.php?t=' + Date.now(); },
      function () { return 'https://picsum.photos/1920/1080?t=' + Date.now(); }
    ];
    var bgImgs = [], bgCur = 0, bgTimer = null, bgOn = true;
    var bgInterval = 60000, bgLoading = false;
    (function bgInit() {
      var layer = document.createElement('div');
      layer.id = 'bg-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(layer, document.body.firstChild);
      for (var k = 0; k < 2; k++) {
        var im = document.createElement('img');
        im.alt = '';
        bgImgs.push(im);
        layer.appendChild(im);
      }
    })();
    function bgNext() {
      if (bgLoading) return;
      bgLoading = true;
      var idle = bgImgs[1 - bgCur], tries = 0;
      (function attempt() {
        idle.onload = function () {
          bgImgs[bgCur].classList.remove('show');
          if (bgOn) idle.classList.add('show');
          bgCur = 1 - bgCur;
          bgLoading = false;
        };
        idle.onerror = function () {
          if (++tries < bgSrcs.length) attempt();   /* 换一个源重试 */
          else bgLoading = false;
        };
        idle.src = bgSrcs[Math.floor(Math.random() * bgSrcs.length)]();
      })();
    }
    function bgStart() {
      if (bgTimer) clearInterval(bgTimer);
      bgTimer = setInterval(bgNext, bgInterval);
    }
    bgNext();
    bgStart();

    /* ---------- 天气系统 ---------- */
    var wxLoad = 0;
    var wxLoadMap = { clear: 0, rain: 0.7, wind: 0.4, snow: 0.4, sand: 1.6, storm: 3.0 };
    var wxNames = { clear: '晴（特效关闭）', rain: '小雨', wind: '大风', snow: '降雪', sand: '沙尘暴', storm: '雷暴' };
    var wxOrder = ['rain', 'storm', 'wind', 'snow', 'sand', 'clear'];
    var wxMode = 'clear', wxParts = [], wxLeaves = [];
    var wxCvs = null, wxCtx = null, wxFlashEl = null;
    var wxW = 0, wxH = 0, wxWind = 0, wxT = 0, wxColors = {}, wxColorTick = 0;
    var bolts = null, boltAge = 0, nextBolt = 0;
    var btnWx = document.getElementById('btn-wx');

    function wxRefreshColors() {
      var cs = getComputedStyle(document.body);
      ['rain', 'snow', 'sand', 'wind', 'haze', 'bolt'].forEach(function (k) {
        wxColors[k] = cs.getPropertyValue('--wx-' + k).trim();
      });
    }
    function wxResize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      wxW = window.innerWidth; wxH = window.innerHeight;
      wxCvs.width = wxW * dpr; wxCvs.height = wxH * dpr;
      wxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      wxBuild();
    }
    function wxBuild() {
      wxParts = []; wxLeaves = [];
      var area = wxW * wxH, i, n;
      if (wxMode === 'rain' || wxMode === 'storm') {
        n = Math.min(Math.round(area / 9000) * (wxMode === 'storm' ? 2 : 1), 480);
        for (i = 0; i < n; i++) wxParts.push({
          x: Math.random() * wxW, y: Math.random() * wxH,
          spd: 900 + Math.random() * 500, len: 11 + Math.random() * 12
        });
      } else if (wxMode === 'wind') {
        n = Math.min(Math.round(area / 16000), 90);
        for (i = 0; i < n; i++) wxParts.push({
          x: Math.random() * wxW, y: Math.random() * wxH,
          spd: 250 + Math.random() * 350, len: 30 + Math.random() * 60,
          ph: Math.random() * 6.28
        });
        for (i = 0; i < 10; i++) wxLeaves.push({
          x: Math.random() * wxW, y: Math.random() * wxH,
          spd: 120 + Math.random() * 220, size: 3 + Math.random() * 3,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 7, ph: Math.random() * 6.28
        });
      } else if (wxMode === 'snow') {
        n = Math.min(Math.round(area / 11000), 180);
        for (i = 0; i < n; i++) wxParts.push({
          x: Math.random() * wxW, y: Math.random() * wxH,
          spd: 35 + Math.random() * 55, size: 1 + Math.random() * 2,
          ph: Math.random() * 6.28, amp: 12 + Math.random() * 22
        });
      } else if (wxMode === 'sand') {
        n = Math.min(Math.round(area / 4500), 520);
        for (i = 0; i < n; i++) wxParts.push({
          x: Math.random() * wxW, y: Math.random() * wxH,
          spd: 350 + Math.random() * 450, size: 0.8 + Math.random() * 1.8,
          a: 0.25 + Math.random() * 0.55, ph: Math.random() * 6.28
        });
      }
    }
    function makeBoltPath() {
      var x = wxW * (0.1 + Math.random() * 0.8), y = 0;
      var end = wxH * (0.4 + Math.random() * 0.25);
      var pts = [[x, 0]];
      while (y < end) {
        y += 20 + Math.random() * 32;
        x += (Math.random() - 0.5) * 55;
        pts.push([x, y]);
      }
      return pts;
    }
    function makeStrike() {
      /* 一次雷击随机 1~5 条闪电，每条带一点时间错位 */
      var n = 1 + Math.floor(Math.random() * 5), arr = [];
      for (var i = 0; i < n; i++) {
        arr.push({
          pts: makeBoltPath(),
          delay: i === 0 ? 0 : Math.random() * 0.18,
          w: 1.8 + Math.random() * 1.4
        });
      }
      return arr;
    }
    function setWeather(m, silent) {
      if (!(m in wxLoadMap)) {
        echo.textContent = "未知天气 '" + m + "'。可选：rain storm wind snow sand clear";
        return;
      }
      if (reduced) {
        echo.textContent = '系统开启了「减少动态效果」，天气特效已停用。';
        return;
      }
      wxMode = m;
      wxLoad = wxLoadMap[m];
      bolts = null; wxFlashEl.style.opacity = '0';
      nextBolt = performance.now() + 2500;
      wxBuild();
      wxRefreshColors();
      btnWx.innerHTML = icons[m];
      var wl = '天气：' + wxNames[m] + '（点击切换）';
      btnWx.title = wl;
      btnWx.setAttribute('aria-label', wl);
      if (!silent) echo.textContent = '天气切换：' + wxNames[m];
    }
    btnWx.addEventListener('click', function () {
      var next = wxOrder[(wxOrder.indexOf(wxMode) + 1) % wxOrder.length];
      setWeather(next, true);
    });

    if (reduced) {
      btnWx.innerHTML = icons.off;
      btnWx.title = '天气特效已停用（系统开启了减少动态效果）';
      btnWx.setAttribute('aria-label', btnWx.title);
    } else {
      wxCvs = document.createElement('canvas');
      wxCvs.id = 'wx-canvas';
      wxCvs.setAttribute('aria-hidden', 'true');
      document.body.appendChild(wxCvs);
      wxCtx = wxCvs.getContext('2d');
      wxFlashEl = document.createElement('div');
      wxFlashEl.id = 'wx-flash';
      wxFlashEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(wxFlashEl);
      window.addEventListener('resize', wxResize);
      wxResize();
      wxRefreshColors();
      setWeather('rain', true);

      var wxPrev = 0;
      (function wxLoop(ts) {
        requestAnimationFrame(wxLoop);
        var dt = Math.min((ts - wxPrev) / 1000, 0.05);
        wxPrev = ts;
        wxT += dt;
        if (++wxColorTick % 45 === 0) wxRefreshColors();  /* 跟随主题/视图模式换色 */
        wxCtx.clearRect(0, 0, wxW, wxH);
        if (wxMode === 'clear') return;

        /* 风场：不同天气不同的基础风 + 阵风 */
        var target =
          wxMode === 'rain'  ? 70 :
          wxMode === 'storm' ? 240 + Math.sin(wxT * 0.8) * 130 :
          wxMode === 'wind'  ? 300 + Math.sin(wxT * 0.6) * 150 + Math.sin(wxT * 2.3) * 40 :
          wxMode === 'snow'  ? 40 + Math.sin(wxT * 0.4) * 30 :
          wxMode === 'sand'  ? 480 : 0;
        wxWind += (target - wxWind) * 0.05;

        var i, p, ctx = wxCtx;
        if (wxMode === 'rain' || wxMode === 'storm') {
          ctx.strokeStyle = wxColors.rain;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (i = 0; i < wxParts.length; i++) {
            p = wxParts[i];
            p.x += wxWind * 1.2 * dt; p.y += p.spd * dt;
            if (p.y > wxH + 24) { p.y = -24; p.x = Math.random() * wxW; }
            if (p.x > wxW + 30) p.x = -30;
            var slope = wxWind * 1.2 / p.spd;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - slope * p.len, p.y - p.len);
          }
          ctx.stroke();

          /* 闪电（仅雷暴）：每次雷击 1~5 条 */
          if (wxMode === 'storm') {
            if (ts > nextBolt) {
              bolts = makeStrike(); boltAge = 0;
              nextBolt = ts + 4500 + Math.random() * 8000;
            }
            if (bolts) {
              boltAge += dt;
              var done = true, peak = 0;
              ctx.save();
              ctx.strokeStyle = wxColors.bolt;
              ctx.shadowColor = wxColors.bolt;
              ctx.shadowBlur = 16;
              for (var b = 0; b < bolts.length; b++) {
                var bo = bolts[b];
                var life = (boltAge - bo.delay) / 0.45;
                if (life < 0) { done = false; continue; }
                if (life >= 1) continue;
                done = false;
                var a = life < 0.12 ? 1 : life < 0.2 ? 0.15 : life < 0.32 ? 0.85
                        : Math.max(0, 1 - (life - 0.32) / 0.5);
                if (a > peak) peak = a;
                ctx.globalAlpha = a;
                ctx.lineWidth = bo.w;
                ctx.beginPath();
                ctx.moveTo(bo.pts[0][0], bo.pts[0][1]);
                for (i = 1; i < bo.pts.length; i++) ctx.lineTo(bo.pts[i][0], bo.pts[i][1]);
                ctx.stroke();
              }
              ctx.restore();
              /* 闪光强度随同时亮着的条数微增 */
              var boost = Math.min(0.22 + (bolts.length - 1) * 0.025, 0.3);
              wxFlashEl.style.opacity = (peak * boost).toFixed(3);
              if (done) { bolts = null; wxFlashEl.style.opacity = '0'; }
            }
          }
        } else if (wxMode === 'wind') {
          ctx.strokeStyle = wxColors.wind;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (i = 0; i < wxParts.length; i++) {
            p = wxParts[i];
            p.x += (p.spd + wxWind) * dt;
            p.y += Math.sin(wxT * 1.5 + p.ph) * 24 * dt;
            if (p.x > wxW + p.len) { p.x = -p.len; p.y = Math.random() * wxH; }
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.len, p.y + Math.sin(p.ph) * 3);
          }
          ctx.stroke();
          ctx.fillStyle = wxColors.wind;
          for (i = 0; i < wxLeaves.length; i++) {
            p = wxLeaves[i];
            p.x += (p.spd + wxWind * 0.6) * dt;
            p.y += Math.sin(wxT * 2 + p.ph) * 50 * dt + 18 * dt;
            p.rot += p.vr * dt;
            if (p.x > wxW + 20) { p.x = -20; p.y = Math.random() * wxH * 0.8; }
            if (p.y > wxH + 20) p.y = -20;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
            ctx.restore();
          }
        } else if (wxMode === 'snow') {
          ctx.fillStyle = wxColors.snow;
          for (i = 0; i < wxParts.length; i++) {
            p = wxParts[i];
            p.y += p.spd * dt;
            p.x += (wxWind * 0.4 + Math.sin(wxT * 0.9 + p.ph) * p.amp) * dt;
            if (p.y > wxH + 6) { p.y = -6; p.x = Math.random() * wxW; }
            if (p.x > wxW + 6) p.x = -6;
            if (p.x < -6) p.x = wxW + 6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, 6.2832);
            ctx.fill();
          }
        } else if (wxMode === 'sand') {
          ctx.fillStyle = wxColors.haze;
          ctx.fillRect(0, 0, wxW, wxH);
          for (i = 0; i < wxParts.length; i++) {
            p = wxParts[i];
            p.x += (p.spd + wxWind * 0.5) * dt;
            p.y += Math.sin(wxT * 3 + p.ph) * 26 * dt + 8 * dt;
            if (p.x > wxW + 8) { p.x = -8; p.y = Math.random() * wxH; }
            if (p.y > wxH + 8) p.y = -8;
            ctx.globalAlpha = p.a;
            ctx.fillStyle = wxColors.sand;
            ctx.fillRect(p.x, p.y, p.size * 2.2, p.size);
          }
          ctx.globalAlpha = 1;
        }
      })(0);
    }

    /* ---------- PIE 娱乐区框架 ---------- */
    var GM = {};   /* 各 GameMode 在下方注册：{ bp, zh, incognito?, start(stage) -> cleanup } */
    var pieEl = document.getElementById('pie');
    var pieStage = document.getElementById('pie-stage');
    var pieTitleEl = document.getElementById('pie-title');
    var btnPie = document.getElementById('btn-pie');
    var pieMenu = document.getElementById('pie-menu');
    var pieMode = null, pieCleanup = null;
    var pieEscHook = null;   /* 模式可拦截 Esc（如游戏厅内先返回大厅） */

    function enterPie(m) {
      if (!GM[m]) {
        echo.textContent = "未知 GameMode '" + m + "'。可选：arcade tea workout idle zen";
        return;
      }
      exitPie(true);
      pieMode = m;
      body.classList.add('pie-on');
      pieEl.classList.add('on');
      pieEl.classList.toggle('zen', m === 'zen');
      pieEl.classList.toggle('incognito', !!GM[m].incognito);
      pieTitleEl.textContent = '▶ ' + GM[m].zh;
      pieCleanup = GM[m].start(pieStage) || null;
    }
    function exitPie(silent) {
      if (!pieMode) return;
      if (pieCleanup) { try { pieCleanup(); } catch (err) {} }
      pieCleanup = null;
      pieEscHook = null;
      pieStage.innerHTML = '';
      pieEl.classList.remove('on', 'zen', 'incognito');
      body.classList.remove('pie-on', 'zen-hide');
      hudSuspend = false;
      var name = GM[pieMode].zh;
      pieMode = null;
      if (!silent) echo.textContent = '已退出「' + name + '」。';
    }
    btnPie.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = pieMenu.classList.toggle('open');
      btnPie.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#pie-menu')) {
        pieMenu.classList.remove('open');
        btnPie.setAttribute('aria-expanded', 'false');
      }
    });
    pieMenu.addEventListener('click', function (e) {
      var it = e.target.closest('.gm');
      if (!it) return;
      pieMenu.classList.remove('open');
      enterPie(it.getAttribute('data-gm'));
    });
    document.getElementById('pie-exit').addEventListener('click', function () { exitPie(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pieMode) {
        if (pieEscHook && pieEscHook()) return;
        exitPie(false);
      }
    });

    /* ---------- GameMode: 茶歇 · 烘焙光照 ---------- */
    GM.tea = {
      bp: 'TeaBreak', zh: '茶歇 · 烘焙光照',
      start: function (stage) {
        hudSuspend = true;
        var prevWx = wxMode;
        if (!reduced && wxMode !== 'rain') setWeather('rain', true);
        stage.innerHTML =
          '<div class="pie-panel">' +
            '<h3 id="tea-h">Building Lighting…</h3>' +
            '<div class="sub" id="tea-sub">光照还没烤完，正大光明地歇一会儿。选择烘焙时长：</div>' +
            '<div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">' +
              '<button type="button" class="pie-btn tdur" data-m="5">5 分钟</button>' +
              '<button type="button" class="pie-btn tdur on" data-m="15">15 分钟</button>' +
              '<button type="button" class="pie-btn tdur" data-m="25">25 分钟</button>' +
              '<button type="button" class="pie-btn" id="tea-sound" style="margin-left:auto;">雨声：开</button>' +
            '</div>' +
            '<div class="pb"><i id="tea-bar"></i></div>' +
            '<div class="mono" style="display:flex; justify-content:space-between; font-size:12px; color:var(--ink2); margin-top:8px;">' +
              '<span id="tea-state">等待开始</span><span id="tea-left">--:--</span>' +
            '</div>' +
            '<div style="margin-top:22px;">' +
              '<button type="button" class="pie-btn primary" id="tea-go">开始烘焙</button>' +
            '</div>' +
          '</div>';
        var q = function (s) { return stage.querySelector(s); };
        var mins = 15, timer = null, running = false;
        var audio = null, soundOn = true;
        function fmt(s) {
          s = Math.max(0, Math.ceil(s));
          return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
        }
        function startRainSound() {
          if (audio || !soundOn) return;
          try {
            var AC = window.AudioContext || window.webkitAudioContext;
            var ctx = new AC();
            var len = ctx.sampleRate * 2;
            var buf = ctx.createBuffer(1, len, ctx.sampleRate);
            var d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            var src = ctx.createBufferSource();
            src.buffer = buf; src.loop = true;
            var f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = 800;
            var g = ctx.createGain(); g.gain.value = 0.06;
            src.connect(f); f.connect(g); g.connect(ctx.destination);
            src.start();
            audio = ctx;
          } catch (err) { audio = null; }
        }
        function stopRainSound() {
          if (audio) { try { audio.close(); } catch (err) {} audio = null; }
        }
        stage.querySelectorAll('.tdur').forEach(function (b) {
          b.addEventListener('click', function () {
            if (running) return;
            stage.querySelectorAll('.tdur').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            mins = parseInt(b.getAttribute('data-m'), 10);
          });
        });
        q('#tea-sound').addEventListener('click', function () {
          soundOn = !soundOn;
          this.textContent = '雨声：' + (soundOn ? '开' : '关');
          if (!soundOn) stopRainSound();
          else if (running) startRainSound();
        });
        q('#tea-go').addEventListener('click', function () {
          if (running) return;
          running = true;
          var total = mins * 60 * 1000;
          var endT = Date.now() + total;
          q('#tea-h').textContent = 'Building Lighting…';
          q('#tea-sub').textContent = '烘焙中。离开屏幕，去倒杯茶。';
          q('#tea-state').textContent = '烘焙中…';
          startRainSound();
          timer = setInterval(function () {
            var remain = endT - Date.now();
            q('#tea-bar').style.width = Math.min(100, (1 - remain / total) * 100) + '%';
            q('#tea-left').textContent = fmt(remain / 1000);
            document.title = running ? '☕ ' + fmt(remain / 1000) + ' · 烘焙光照中' : document.title;
            if (remain <= 0) {
              clearInterval(timer); timer = null; running = false;
              q('#tea-bar').style.width = '100%';
              q('#tea-h').textContent = 'Lighting build complete ✓';
              q('#tea-sub').textContent = '烤好了。该回来干活了。';
              q('#tea-state').textContent = '完成';
              q('#tea-go').textContent = '再来一轮';
              document.title = '✓ 烘焙完成 · 一帧之内';
              stopRainSound();
            }
          }, 500);
        });
        return function cleanup() {
          if (timer) clearInterval(timer);
          stopRainSound();
          document.title = SITE_TITLE0;
          if (!reduced && wxMode !== prevWx) setWeather(prevWx, true);
        };
      }
    };

    /* ---------- GameMode: 摸鱼 · Compiling Shaders ---------- */
    GM.idle = {
      bp: 'Idle', zh: '摸鱼 · Compiling Shaders',
      incognito: true,   /* 隐藏 PIE 横幅，伪装成真编译 */
      start: function (stage) {
        hudSuspend = true;
        stage.innerHTML =
          '<div style="width:min(640px,94vw);" class="mono">' +
            '<div style="font-size:15px; margin-bottom:6px;">Compiling Shaders (<span id="id-n">3427</span> / <span id="id-t">8192</span>)</div>' +
            '<div class="pb" style="height:14px;"><i id="id-bar" style="transition:width 1s linear;"></i></div>' +
            '<div id="id-log" style="margin-top:18px; font-size:11px; line-height:1.9; color:var(--ink2); height:15em; overflow:hidden;"></div>' +
            '<div style="margin-top:14px; font-size:10.5px; color:var(--ink2); opacity:0.45;">按任意键返回工作状态</div>' +
          '</div>';
        var q = function (s) { return stage.querySelector(s); };
        var n = 3427, total = 8192;
        var shaders = [
          'FBasePassPS', 'FTSRResolveHistoryCS', 'FMegaLightsRayGenRGS',
          'FVirtualShadowMapProjectionCS', 'FNaniteCullRasterizeCS',
          'FLumenScreenProbeGatherCS', 'FDistanceFieldShadowingCS',
          'FPostProcessTonemapPS', 'FSkyAtmosphereLUTCS', 'FHairStrandsVisibilityPS',
          'FDismembermentCutPlanePS', 'FChaosClothSimCS', 'FTKCharacterOutlinePS'
        ];
        var logEl = q('#id-log');
        function addLog(line) {
          var div = document.createElement('div');
          div.textContent = line;
          logEl.appendChild(div);
          while (logEl.children.length > 14) logEl.removeChild(logEl.firstChild);
        }
        addLog('LogShaderCompilers: Display: Submitted ' + total + ' shader compile jobs');
        var timer = setInterval(function () {
          if (Math.random() < 0.8) {
            n += 1 + Math.floor(Math.random() * 3);
            var s = shaders[Math.floor(Math.random() * shaders.length)];
            addLog('LogShaderCompilers: Display: Compiled ' + s +
              ' (permutation ' + Math.floor(Math.random() * 512) + '/512, ' +
              (0.2 + Math.random() * 4).toFixed(2) + 's)');
          } else {
            addLog('LogDerivedDataCache: Display: Cache miss on key SHADER_' +
              Math.random().toString(36).slice(2, 10).toUpperCase());
          }
          /* 永远编不完：快到头就"发现新变体" */
          if (n > total - 400) {
            total += 512 + Math.floor(Math.random() * 512);
            addLog('LogShaderCompilers: Display: Discovered ' + (total % 1000 + 512) + ' new permutations, re-queueing…');
          }
          q('#id-n').textContent = n;
          q('#id-t').textContent = total;
          q('#id-bar').style.width = (n / total * 100).toFixed(1) + '%';
        }, 900);
        /* 任意键/点击立即返回（延迟挂载，避开进入时的点击） */
        function bail() { exitPie(true); }
        var armed = setTimeout(function () {
          document.addEventListener('keydown', bail);
          pieEl.addEventListener('mousedown', bail);
        }, 400);
        return function cleanup() {
          clearInterval(timer);
          clearTimeout(armed);
          document.removeEventListener('keydown', bail);
          pieEl.removeEventListener('mousedown', bail);
        };
      }
    };

    /* ---------- 游戏厅 · 游戏 1：帧预算保卫战 ---------- */
    function budgetGame(stage) {
        stage.innerHTML =
          '<div style="text-align:center;">' +
            '<canvas id="ag" style="border:1px solid var(--line); background:var(--surface); max-width:100%;"></canvas>' +
            '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">' +
              '← → / A D 或鼠标移动　·　接住 pass 攒满一帧（≥14ms 自动提交，15.5ms 以上双倍分）　·　超过 16.67ms = 掉帧，掉 3 帧游戏结束' +
            '</div>' +
          '</div>';
        var cvs = stage.querySelector('#ag');
        var W = Math.min(560, window.innerWidth - 60);
        var H = Math.min(600, window.innerHeight - 170);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        cvs.width = W * dpr; cvs.height = H * dpr;
        cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
        var g = cvs.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);

        var BUDGET = 16.67, SUBMIT = 14;
        var PASSES = [
          ['ShadowDepth', 2.1, '--c-render'], ['BasePass', 3.4, '--c-char'],
          ['Lumen GI', 4.2, '--c-render'],    ['VSM Update', 2.8, '--c-engine'],
          ['MegaLights', 3.0, '--c-tool'],    ['PostFX', 1.6, '--c-char'],
          ['Nanite Cull', 1.2, '--c-engine'], ['TSR', 2.4, '--c-tool']
        ];
        var OPTS = [['LOD 切换', -2.4], ['Nanite 启用', -3.0], ['剔除优化', -1.8]];
        var col = {};
        function sampleColors() {
          var cs = getComputedStyle(document.body);
          ['--ink', '--ink2', '--line', '--surface2', '--accent', '--play',
           '--c-render', '--c-engine', '--c-char', '--c-tool'].forEach(function (k) {
            col[k] = cs.getPropertyValue(k).trim();
          });
        }
        sampleColors();

        var hi = 0;
        try { hi = parseInt(localStorage.getItem('yzzn-arcade-hi') || '0', 10); } catch (err) {}
        var px, acc, score, lives, blocks, spawnT, over, shakeT, flashT, submitT, tick = 0;
        var keys = {}, raf = null, prev = 0;
        var PW = 132, PH = 34;

        function reset() {
          px = W / 2; acc = 0; score = 0; lives = 3;
          blocks = []; spawnT = 0; over = false;
          shakeT = 0; flashT = 0; submitT = 0;
        }
        reset();

        function spawn() {
          var isOpt = Math.random() < 0.18;
          var src = isOpt
            ? OPTS[Math.floor(Math.random() * OPTS.length)]
            : PASSES[Math.floor(Math.random() * PASSES.length)];
          var w = 60 + Math.abs(src[1]) * 15;
          blocks.push({
            name: src[0], ms: src[1],
            c: isOpt ? col['--play'] : col[src[2]],
            x: 10 + Math.random() * (W - w - 20), y: -30, w: w, h: 26
          });
        }
        function onKeyDown(e) {
          keys[e.key.toLowerCase()] = true;
          if (over && (e.key === ' ' || e.key === 'Enter')) reset();
          if (['arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
        }
        function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }
        function onMouse(e) {
          var r = cvs.getBoundingClientRect();
          px = (e.clientX - r.left) / r.width * W;
        }
        function onClick() { if (over) reset(); }
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        cvs.addEventListener('mousemove', onMouse);
        cvs.addEventListener('click', onClick);

        function loop(ts) {
          raf = requestAnimationFrame(loop);
          var dt = Math.min((ts - prev) / 1000, 0.04);
          prev = ts;
          if (++tick % 60 === 0) sampleColors();

          if (!over) {
            /* 输入 */
            var v = 420;
            if (keys['arrowleft'] || keys['a']) px -= v * dt;
            if (keys['arrowright'] || keys['d']) px += v * dt;
            px = Math.max(PW / 2, Math.min(W - PW / 2, px));
            /* 生成与下落 */
            spawnT -= dt;
            if (spawnT <= 0) {
              spawn();
              spawnT = Math.max(0.5, 1.3 - score * 0.018);
            }
            var fall = 130 + score * 3.5;
            var padTop = H - 60;
            for (var i = blocks.length - 1; i >= 0; i--) {
              var b = blocks[i];
              b.y += fall * dt;
              var caught = b.y + b.h >= padTop && b.y + b.h < padTop + 26 &&
                           b.x + b.w > px - PW / 2 && b.x < px + PW / 2;
              if (caught) {
                blocks.splice(i, 1);
                acc = Math.max(0, acc + b.ms);
                if (acc > BUDGET) {
                  lives--; acc = 0; shakeT = 0.35; flashT = 0.35;
                  if (lives <= 0) {
                    over = true;
                    if (score > hi) {
                      hi = score;
                      try { localStorage.setItem('yzzn-arcade-hi', String(hi)); } catch (err) {}
                    }
                  }
                } else if (acc >= SUBMIT) {
                  score += acc >= 15.5 ? 2 : 1;
                  acc = 0; submitT = 0.25;
                }
              } else if (b.y > H) {
                blocks.splice(i, 1);
              }
            }
            if (shakeT > 0) shakeT -= dt;
            if (flashT > 0) flashT -= dt;
            if (submitT > 0) submitT -= dt;
          }

          /* ---- 绘制 ---- */
          g.clearRect(0, 0, W, H);
          g.save();
          if (shakeT > 0) g.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);

          /* 顶部信息 */
          g.font = '12px Consolas, monospace';
          g.fillStyle = col['--ink2'];
          g.textAlign = 'left';
          g.fillText('SCORE ' + score + '   HI ' + hi, 12, 22);
          g.textAlign = 'right';
          g.fillText('LIVES ' + Array(lives + 1).join('▮') + Array(4 - lives).join('▯'), W - 12, 22);

          /* 方块 */
          g.textAlign = 'center';
          g.font = '11px Consolas, monospace';
          for (var j = 0; j < blocks.length; j++) {
            var bb = blocks[j];
            g.fillStyle = bb.c;
            g.globalAlpha = 0.88;
            g.fillRect(bb.x, bb.y, bb.w, bb.h);
            g.globalAlpha = 1;
            g.fillStyle = col['--ink'];
            g.fillText(bb.name + ' ' + (bb.ms > 0 ? '+' : '') + bb.ms.toFixed(1), bb.x + bb.w / 2, bb.y + 17);
          }

          /* 帧槽（挡板即预算条） */
          var padTop2 = H - 60, padL = px - PW / 2;
          g.strokeStyle = submitT > 0 ? col['--play'] : col['--ink2'];
          g.lineWidth = submitT > 0 ? 2.5 : 1.5;
          g.strokeRect(padL, padTop2, PW, PH);
          g.fillStyle = acc < SUBMIT ? col['--play'] : col['--accent'];
          g.globalAlpha = 0.75;
          g.fillRect(padL + 2, padTop2 + 2, (PW - 4) * Math.min(1, acc / BUDGET), PH - 4);
          g.globalAlpha = 1;
          /* 提交线刻度 */
          var sx = padL + 2 + (PW - 4) * (SUBMIT / BUDGET);
          g.strokeStyle = col['--ink'];
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(sx, padTop2 + 2); g.lineTo(sx, padTop2 + PH - 2); g.stroke();
          g.fillStyle = col['--ink'];
          g.font = '11px Consolas, monospace';
          g.fillText(acc.toFixed(1) + ' / 16.67 ms', px, padTop2 + PH + 16);

          /* 掉帧红闪 */
          if (flashT > 0) {
            g.fillStyle = 'rgba(217, 106, 96, ' + (flashT * 0.6).toFixed(2) + ')';
            g.fillRect(0, 0, W, H);
          }
          /* 结束画面 */
          if (over) {
            g.fillStyle = 'rgba(0,0,0,0.55)';
            g.fillRect(0, 0, W, H);
            g.fillStyle = col['--accent'];
            g.font = 'bold 26px Consolas, monospace';
            g.fillText('FRAME OUT OF BUDGET', W / 2, H / 2 - 30);
            g.fillStyle = col['--ink'];
            g.font = '14px Consolas, monospace';
            g.fillText('提交帧数：' + score + '　最高纪录：' + hi, W / 2, H / 2 + 6);
            g.fillStyle = col['--ink2'];
            g.font = '12px Consolas, monospace';
            g.fillText('空格 / 点击重开　·　Esc 退出', W / 2, H / 2 + 34);
          }
          g.restore();
        }
        raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });

        return function cleanup() {
          if (raf) cancelAnimationFrame(raf);
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('keyup', onKeyUp);
          cvs.removeEventListener('mousemove', onMouse);
          cvs.removeEventListener('click', onClick);
        };
    }

    /* ---------- 游戏厅 · 游戏 2：纹理 2048 ---------- */
    function tex2048Game(stage) {
      var HIKEY = 'yzzn-arc-tex2048';
      var LBL = { 256: '256', 512: '512', 1024: '1K', 2048: '2K', 4096: '4K', 8192: '8K', 16384: '16K' };
      var hi = 0;
      try { hi = parseInt(localStorage.getItem(HIKEY) || '0', 10); } catch (err) {}
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:min(340px,86vw); margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="t2-score">SCORE 0</span><span id="t2-hi">HI ' + hi + '</span>' +
          '</div>' +
          '<div id="t2" class="t2-grid"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">方向键 / WASD 合并相同分辨率的贴图 · 目标 8K · R 重开</div>' +
          '<div id="t2-msg" class="mono" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var q = function (s) { return stage.querySelector(s); };
      var cells, score, won, over;
      var LINES = {
        left:  [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15]],
        right: [[3,2,1,0],[7,6,5,4],[11,10,9,8],[15,14,13,12]],
        up:    [[0,4,8,12],[1,5,9,13],[2,6,10,14],[3,7,11,15]],
        down:  [[12,8,4,0],[13,9,5,1],[14,10,6,2],[15,11,7,3]]
      };
      function spawn() {
        var free = [];
        cells.forEach(function (v, i) { if (!v) free.push(i); });
        if (free.length) cells[free[Math.floor(Math.random() * free.length)]] = Math.random() < 0.9 ? 256 : 512;
      }
      function reset() {
        cells = []; for (var i = 0; i < 16; i++) cells.push(0);
        score = 0; won = false; over = false;
        spawn(); spawn(); render();
        q('#t2-msg').textContent = '';
      }
      function render() {
        var h = '';
        cells.forEach(function (v) {
          var lvl = v ? Math.round(Math.log(v / 256) / Math.LN2) + 1 : 0;
          h += '<div class="c' + (lvl ? ' l' + Math.min(lvl, 7) : '') + '">' + (v ? LBL[v] : '') + '</div>';
        });
        q('#t2').innerHTML = h;
        q('#t2-score').textContent = 'SCORE ' + score;
        if (score > hi) {
          hi = score;
          try { localStorage.setItem(HIKEY, String(hi)); } catch (err) {}
          q('#t2-hi').textContent = 'HI ' + hi;
        }
      }
      function slide(a) {
        var r = a.filter(function (v) { return v; });
        for (var i = 0; i < r.length - 1; i++) {
          if (r[i] === r[i + 1]) {
            r[i] *= 2; score += r[i];
            if (r[i] === 8192 && !won) {
              won = true;
              q('#t2-msg').textContent = '✓ 合成 8K 贴图！还可以继续冲 16K';
            }
            r.splice(i + 1, 1);
          }
        }
        while (r.length < 4) r.push(0);
        return r;
      }
      function canMove() {
        if (cells.indexOf(0) >= 0) return true;
        for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
          var v = cells[r * 4 + c];
          if (c < 3 && cells[r * 4 + c + 1] === v) return true;
          if (r < 3 && cells[(r + 1) * 4 + c] === v) return true;
        }
        return false;
      }
      function move(dir) {
        if (over) return;
        var changed = false;
        LINES[dir].forEach(function (L) {
          var slid = slide(L.map(function (i) { return cells[i]; }));
          for (var k = 0; k < 4; k++) {
            if (cells[L[k]] !== slid[k]) { cells[L[k]] = slid[k]; changed = true; }
          }
        });
        if (changed) {
          spawn(); render();
          if (!canMove()) {
            over = true;
            q('#t2-msg').textContent = '合并不动了 — 按 R 重开';
          }
        }
      }
      function onKey(e) {
        var k = e.key.toLowerCase();
        var map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
        if (map[k]) { e.preventDefault(); move(map[k]); }
        else if (k === 'r') reset();
      }
      document.addEventListener('keydown', onKey);
      reset();
      return function cleanup() { document.removeEventListener('keydown', onKey); };
    }

    /* ---------- 游戏厅 · 游戏 3：Bug 打地鼠 ---------- */
    function bugGame(stage) {
      var HIKEY = 'yzzn-arc-bug';
      var BUGS = ['空指针', '越界', '竞态', '内存泄漏', 'off-by-one', '死锁'];
      var FEATS = ['需求', 'feature'];
      var hi = 0;
      try { hi = parseInt(localStorage.getItem(HIKEY) || '0', 10); } catch (err) {}
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:min(430px,90vw); margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="bw-score">SCORE 0</span><span id="bw-time">45 s</span><span id="bw-hi">HI ' + hi + '</span>' +
          '</div>' +
          '<div class="bug-grid" id="bw"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">打 <span style="color:var(--c-render);">bug</span> +1 分 · 打到 <span style="color:var(--play);">需求</span> −3 分（it’s not a bug, it’s a feature）</div>' +
          '<div style="margin-top:12px;"><button type="button" class="pie-btn primary" id="bw-go">开始</button></div>' +
        '</div>';
      var q = function (s) { return stage.querySelector(s); };
      var grid = q('#bw'), cells = [], active = {}, timers = [], ivs = [];
      for (var i = 0; i < 12; i++) {
        var c = document.createElement('div');
        c.className = 'c';
        c.textContent = '···';
        (function (idx, el) {
          el.addEventListener('click', function () { hit(idx); });
        })(i, c);
        grid.appendChild(c);
        cells.push(c);
      }
      var score = 0, t = 45, running = false;
      function clearCell(i) {
        if (active[i]) { clearTimeout(active[i].to); delete active[i]; }
        cells[i].className = 'c';
        cells[i].textContent = '···';
      }
      function hit(i) {
        if (!running || !active[i]) return;
        score += active[i].type === 'bug' ? 1 : -3;
        clearCell(i);
        q('#bw-score').textContent = 'SCORE ' + score;
      }
      function spawnOne() {
        if (!running) return;
        var free = [];
        for (var i = 0; i < 12; i++) if (!active[i]) free.push(i);
        if (!free.length) return;
        var i2 = free[Math.floor(Math.random() * free.length)];
        var type = Math.random() < 0.22 ? 'feat' : 'bug';
        var pool = type === 'bug' ? BUGS : FEATS;
        cells[i2].className = 'c ' + type;
        cells[i2].textContent = pool[Math.floor(Math.random() * pool.length)];
        active[i2] = {
          type: type,
          to: setTimeout(function () { clearCell(i2); }, 900 + Math.random() * 600)
        };
      }
      function end() {
        running = false;
        ivs.forEach(clearInterval); ivs = [];
        for (var i = 0; i < 12; i++) clearCell(i);
        if (score > hi) {
          hi = score;
          try { localStorage.setItem(HIKEY, String(hi)); } catch (err) {}
          q('#bw-hi').textContent = 'HI ' + hi;
        }
        q('#bw-go').textContent = '再来一局（' + score + ' 分）';
        q('#bw-go').style.display = '';
      }
      q('#bw-go').addEventListener('click', function () {
        score = 0; t = 45; running = true;
        q('#bw-score').textContent = 'SCORE 0';
        q('#bw-time').textContent = '45 s';
        this.style.display = 'none';
        ivs.push(setInterval(spawnOne, 620));
        ivs.push(setInterval(function () {
          t--;
          q('#bw-time').textContent = t + ' s';
          if (t <= 0) end();
        }, 1000));
      });
      return function cleanup() {
        running = false;
        ivs.forEach(clearInterval);
        Object.keys(active).forEach(function (k) { clearTimeout(active[k].to); });
      };
    }

    /* ---------- 游戏厅 · 游戏 4：Shader 打字员 ---------- */
    function typerGame(stage) {
      var HIKEY = 'yzzn-arc-typer';
      var WORDS = [
        'lerp', 'saturate', 'dot', 'cross', 'normalize', 'mul', 'frac', 'clip',
        'discard', 'cbuffer', 'ddx', 'ddy', 'rsqrt', 'step', 'smoothstep',
        'float3', 'half4', 'SV_Target', 'tex2D', 'SampleLevel', 'numthreads',
        'groupshared', 'InterlockedAdd', 'RWTexture2D', 'SV_Position'
      ];
      var hi = 0;
      try { hi = parseInt(localStorage.getItem(HIKEY) || '0', 10); } catch (err) {}
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:min(560px,90vw); margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="ty-score">SCORE 0</span><span id="ty-lives">LIVES ▮▮▮</span><span id="ty-hi">HI ' + hi + '</span>' +
          '</div>' +
          '<div class="ty-area" id="ty-area"></div>' +
          '<div style="width:min(560px,90vw); margin:10px auto 0;">' +
            '<input type="text" id="ty-in" class="mono" spellcheck="false" autocomplete="off" placeholder="敲出下落的关键字（大小写不限）…" ' +
              'style="width:100%; box-sizing:border-box; background:var(--surface); border:1px solid var(--line); color:var(--ink); padding:9px 12px; font-size:14px; outline:none;">' +
          '</div>' +
          '<div id="ty-msg" class="mono" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--accent);"></div>' +
        '</div>';
      var q = function (s) { return stage.querySelector(s); };
      var area = q('#ty-area'), input = q('#ty-in');
      var words = [], score = 0, lives = 3, over = false, ivs = [];
      function livesTxt() {
        return 'LIVES ' + Array(lives + 1).join('▮') + Array(4 - lives).join('▯');
      }
      function gameOver() {
        over = true;
        ivs.forEach(clearInterval); ivs = [];
        input.disabled = true;
        if (score > hi) {
          hi = score;
          try { localStorage.setItem(HIKEY, String(hi)); } catch (err) {}
          q('#ty-hi').textContent = 'HI ' + hi;
        }
        q('#ty-msg').textContent = '编译失败！得分 ' + score + ' — 点击输入框上方区域重开';
        area.style.cursor = 'pointer';
        area.addEventListener('click', restart);
      }
      function restart() {
        area.removeEventListener('click', restart);
        area.style.cursor = '';
        words.forEach(function (w) { w.el.remove(); });
        words = []; score = 0; lives = 3; over = false;
        input.disabled = false; input.value = ''; input.focus();
        q('#ty-score').textContent = 'SCORE 0';
        q('#ty-lives').textContent = livesTxt();
        q('#ty-msg').textContent = '';
        run();
      }
      function run() {
        ivs.push(setInterval(function () {   /* 生成 */
          if (over) return;
          var text = WORDS[Math.floor(Math.random() * WORDS.length)];
          var el = document.createElement('span');
          el.className = 'ty-word';
          el.textContent = text;
          el.style.color = 'var(--ink)';
          area.appendChild(el);
          var x = Math.random() * (area.clientWidth - el.offsetWidth - 16) + 8;
          el.style.left = x + 'px';
          words.push({ el: el, text: text.toLowerCase(), y: -18 });
        }, 1500));
        ivs.push(setInterval(function () {   /* 下落 */
          if (over) return;
          var sp = (36 + score * 0.5) * 0.045;
          for (var i = words.length - 1; i >= 0; i--) {
            var w = words[i];
            w.y += sp;
            w.el.style.top = w.y + 'px';
            if (w.y > area.clientHeight - 14) {
              w.el.remove();
              words.splice(i, 1);
              lives--;
              q('#ty-lives').textContent = livesTxt();
              if (lives <= 0) { gameOver(); return; }
            }
          }
        }, 45));
      }
      input.addEventListener('input', function () {
        if (over) return;
        var v = input.value.trim().toLowerCase();
        for (var i = 0; i < words.length; i++) {
          if (words[i].text === v) {
            score += words[i].text.length;
            words[i].el.remove();
            words.splice(i, 1);
            input.value = '';
            q('#ty-score').textContent = 'SCORE ' + score;
            break;
          }
        }
      });
      input.focus();
      run();
      return function cleanup() { ivs.forEach(clearInterval); };
    }

    /* ---------- 游戏厅 · 游戏 5：N-back 训练 ---------- */
    function nbackGame(stage) {
      var HIKEY = 'yzzn-arc-nback';
      var LETTERS = 'BCDFGHKMPRSTX';
      var hi = 0;
      try { hi = parseInt(localStorage.getItem(HIKEY) || '0', 10); } catch (err) {}
      var N = 2, timers = [], seq = [], idx = -1, responded = false;
      var hits = 0, misses = 0, fa = 0, running = false;
      function setup() {
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<h3>N-back 训练</h3>' +
            '<div class="sub">字母逐个出现；若与 N 个之前的相同，按空格或点「匹配」。认知科学经典的工作记忆测验。</div>' +
            '<div style="display:flex; gap:10px; justify-content:center; margin-bottom:18px;">' +
              '<button type="button" class="pie-btn nb-n" data-n="1">N = 1</button>' +
              '<button type="button" class="pie-btn nb-n on" data-n="2">N = 2</button>' +
              '<button type="button" class="pie-btn nb-n" data-n="3">N = 3</button>' +
            '</div>' +
            '<div class="mono" style="font-size:12px; color:var(--ink2); margin-bottom:16px;">最佳正确率：' + hi + '%</div>' +
            '<button type="button" class="pie-btn primary" id="nb-go">开始（22 个刺激）</button>' +
          '</div>';
        stage.querySelectorAll('.nb-n').forEach(function (b) {
          b.addEventListener('click', function () {
            stage.querySelectorAll('.nb-n').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            N = parseInt(b.getAttribute('data-n'), 10);
          });
        });
        stage.querySelector('#nb-go').addEventListener('click', runGame);
      }
      function runGame() {
        var total = 20 + N;
        seq = [];
        for (var i = 0; i < total; i++) {
          if (i >= N && Math.random() < 0.3) seq.push(seq[i - N]);
          else seq.push(LETTERS[Math.floor(Math.random() * LETTERS.length)]);
        }
        hits = 0; misses = 0; fa = 0; idx = -1; running = true;
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<div class="mono" style="font-size:12px; color:var(--ink2);" id="nb-prog"></div>' +
            '<div class="nb-letter" id="nb-l"></div>' +
            '<button type="button" class="pie-btn primary" id="nb-match" style="min-width:140px;">匹配（空格）</button>' +
          '</div>';
        stage.querySelector('#nb-match').addEventListener('click', respond);
        step();
      }
      function isTarget(i) { return i >= N && seq[i] === seq[i - N]; }
      function respond() {
        if (!running || idx < 0 || responded) return;
        responded = true;
        if (isTarget(idx)) hits++;
        else fa++;
      }
      function onSpace(e) {
        if (e.key === ' ' && running) { e.preventDefault(); respond(); }
      }
      function step() {
        if (idx >= 0 && isTarget(idx) && !responded) misses++;
        idx++;
        if (idx >= seq.length) { finish(); return; }
        responded = false;
        var l = stage.querySelector('#nb-l');
        l.textContent = seq[idx];
        stage.querySelector('#nb-prog').textContent = (idx + 1) + ' / ' + seq.length + '　N = ' + N;
        timers.push(setTimeout(function () { l.textContent = '·'; }, 1400));
        timers.push(setTimeout(step, 2200));
      }
      function finish() {
        running = false;
        var total = seq.length - N;
        var targets = 0;
        for (var i = N; i < seq.length; i++) if (isTarget(i)) targets++;
        var correctRej = (total - targets) - fa;
        var acc = Math.max(0, Math.round((hits + correctRej) / total * 100));
        if (acc > hi) {
          hi = acc;
          try { localStorage.setItem(HIKEY, String(hi)); } catch (err) {}
        }
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<h3>正确率 ' + acc + '%</h3>' +
            '<div class="sub">N = ' + N + '　命中 ' + hits + ' / ' + targets + '　漏报 ' + misses + '　误报 ' + fa + '　最佳 ' + hi + '%</div>' +
            '<button type="button" class="pie-btn primary" id="nb-again">再来一组</button>' +
          '</div>';
        stage.querySelector('#nb-again').addEventListener('click', setup);
      }
      document.addEventListener('keydown', onSpace);
      setup();
      return function cleanup() {
        running = false;
        timers.forEach(clearTimeout);
        document.removeEventListener('keydown', onSpace);
      };
    }

    /* 彩纸庆祝：从宿主元素底部两角向上喷彩纸 */
    function confettiBurst(host) {
      var rect = host.getBoundingClientRect();
      var PAD = 90;
      var w = rect.width + PAD * 2, h = rect.height + PAD * 2;
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.style.cssText = 'position:absolute; left:' + (-PAD) + 'px; top:' + (-PAD) +
        'px; width:' + w + 'px; height:' + h + 'px; pointer-events:none; z-index:6;';
      host.appendChild(cv);
      var g = cv.getContext('2d');
      var cs = getComputedStyle(document.body);
      var colors = ['--accent', '--play', '--c-render', '--c-engine', '--c-char', '--c-tool', '--c-ai', '--c-life']
        .map(function (k) { return cs.getPropertyValue(k).trim(); });
      var parts = [];
      function burst(x, y, dir) {
        for (var i = 0; i < 46; i++) {
          var a = (-90 + dir * (10 + Math.random() * 45)) * Math.PI / 180;
          var v = 260 + Math.random() * 320;
          parts.push({
            x: x, y: y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
            w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
            c: colors[Math.floor(Math.random() * colors.length)]
          });
        }
      }
      burst(PAD + rect.width * 0.12, PAD + rect.height, 1);
      burst(PAD + rect.width * 0.88, PAD + rect.height, -1);
      var t0 = performance.now(), prevT = t0;
      (function tick(ts) {
        if (!cv.isConnected) return;
        var dt = Math.min((ts - prevT) / 1000, 0.04);
        prevT = ts;
        var life = (ts - t0) / 2600;
        g.clearRect(0, 0, w, h);
        if (life >= 1) { cv.remove(); return; }
        g.globalAlpha = life > 0.7 ? (1 - life) / 0.3 : 1;
        parts.forEach(function (p) {
          p.vy += 620 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.99;
          p.rot += p.vr * dt;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.c;
          g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          g.restore();
        });
        requestAnimationFrame(tick);
      })(t0);
    }

    /* ---------- 游戏厅 · 游戏 6：拼图 ---------- */
    function jigsawGame(stage) {
      var size = 4, res = 1024;
      var timers = [], perm = [], sel = -1, moves = 0, sec = 0, playing = false;
      var objUrl = null;
      function freeObj() {
        if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
      }
      function bestKey(s) { return 'yzzn-arc-jig' + s; }
      function getBest(s) {
        try { return parseInt(localStorage.getItem(bestKey(s)) || '0', 10); } catch (err) { return 0; }
      }
      function fmtT(s) { return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2); }
      function stopTimers() { timers.forEach(clearInterval); timers = []; }

      function setup() {
        stopTimers();
        var best = getBest(size);
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<h3>拼图</h3>' +
            '<div class="sub">图片实时取自 Lorem Picsum（按设定分辨率出图），切块打乱。点两块交换位置，复原即胜。</div>' +
            '<div class="mono" style="font-size:11px; color:var(--ink2); margin-bottom:8px;">切割块数：' +
              '<span id="jg-sl" style="color:var(--ink);">' + size + '×' + size + '（' + (size * size) + ' 块）</span>' +
            '</div>' +
            '<div style="margin-bottom:16px;">' +
              '<input type="range" id="jg-size" min="2" max="20" step="1" value="' + size + '" ' +
                'style="width:min(320px,80vw); accent-color:var(--play);" aria-label="切割块数">' +
            '</div>' +
            '<div class="mono" style="font-size:11px; color:var(--ink2); margin-bottom:8px;">处理分辨率：' +
              '<span id="jg-rl" style="color:var(--ink);">' + res + '×' + res + '</span>' +
            '</div>' +
            '<div style="margin-bottom:16px;">' +
              '<input type="range" id="jg-res" min="256" max="8192" step="64" value="' + res + '" ' +
                'style="width:min(320px,80vw); accent-color:var(--play);" aria-label="处理分辨率">' +
            '</div>' +
            '<div class="mono" style="font-size:12px; color:var(--ink2); margin-bottom:16px;">本尺寸最佳：<span id="jg-best">' + (best ? fmtT(best) : '—') + '</span></div>' +
            '<button type="button" class="pie-btn primary" id="jg-go">拉图开拼</button>' +
          '</div>';
        stage.querySelector('#jg-size').addEventListener('input', function () {
          size = parseInt(this.value, 10);
          stage.querySelector('#jg-sl').textContent = size + '×' + size + '（' + (size * size) + ' 块）';
          var b2 = getBest(size);
          stage.querySelector('#jg-best').textContent = b2 ? fmtT(b2) : '—';
        });
        stage.querySelector('#jg-res').addEventListener('input', function () {
          res = parseInt(this.value, 10);
          stage.querySelector('#jg-rl').textContent =
            res + '×' + res + (res >= 4096 ? '（大图较耗内存）' : '');
        });
        stage.querySelector('#jg-go').addEventListener('click', load);
      }

      function load() {
        stopTimers();
        /* 源图按固定比例拉取（非方形、非 2 次幂），本地中心裁切+缩放到目标分辨率 */
        var srcW = Math.min(2400, Math.max(640, Math.round(res * 1.25)));
        var srcH = Math.round(srcW * 2 / 3);
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<h3>正在处理图片…</h3>' +
          '</div>';
        var tries = 0;
        (function attempt() {
          /* seed URL 保证同一张图可被稳定复用（随机重定向源不可用） */
          var seed = Math.random().toString(36).slice(2, 10);
          var url = 'https://picsum.photos/seed/' + seed + '/' + srcW + '/' + srcH;
          var im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = function () {
            try {
              var side = Math.min(im.naturalWidth, im.naturalHeight);
              var cv = document.createElement('canvas');
              cv.width = res; cv.height = res;
              var cx = cv.getContext('2d');
              cx.imageSmoothingEnabled = true;
              cx.imageSmoothingQuality = 'high';
              cx.drawImage(im,
                (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side,
                0, 0, res, res);
              cv.toBlob(function (bl) {
                if (bl) {
                  freeObj();
                  objUrl = URL.createObjectURL(bl);
                  board(objUrl);
                } else {
                  board(url);   /* 编码失败：退化为直接用源图（CSS 拉伸） */
                }
              }, 'image/jpeg', 0.85);
            } catch (err) {
              board(url);       /* canvas 不可用：同样退化 */
            }
          };
          im.onerror = function () {
            if (++tries < 3) attempt();
            else {
              stage.innerHTML =
                '<div class="pie-panel" style="text-align:center;">' +
                  '<h3>图片拉取失败</h3>' +
                  '<div class="sub">网络不给力，稍后再试。</div>' +
                  '<button type="button" class="pie-btn primary" id="jg-re">重试</button>' +
                '</div>';
              stage.querySelector('#jg-re').addEventListener('click', load);
            }
          };
          im.src = url;
        })();
      }

      function solved() {
        for (var i = 0; i < perm.length; i++) if (perm[i] !== i) return false;
        return true;
      }

      function board(url) {
        var px = Math.floor(Math.min(460, window.innerWidth - 70, window.innerHeight - 300));
        perm = [];
        for (var i = 0; i < size * size; i++) perm.push(i);
        do {
          for (var j = perm.length - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var tmp = perm[j]; perm[j] = perm[k]; perm[k] = tmp;
          }
        } while (solved());
        sel = -1; moves = 0; sec = 0; playing = true;
        var best = getBest(size);
        stage.innerHTML =
          '<div style="text-align:center;">' +
            '<div class="mono" style="display:flex; justify-content:space-between; width:' + px + 'px; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
              '<span id="jg-time">0:00</span><span id="jg-moves">0 步</span>' +
              '<span>' + (best ? 'BEST ' + fmtT(best) : '') + '</span>' +
            '</div>' +
            '<div class="jig-wrap" style="width:' + px + 'px; height:' + px + 'px;">' +
              '<div class="jig-board" id="jg-b" style="grid-template-columns:repeat(' + size + ',1fr); gap:' + (size >= 10 ? 1 : 2) + 'px;"></div>' +
              '<div class="jig-prev" id="jg-p" style="background-image:url(' + url + ');"></div>' +
            '</div>' +
            '<div style="display:flex; gap:10px; justify-content:center; margin-top:12px;">' +
              '<button type="button" class="pie-btn" id="jg-peek">按住看原图</button>' +
              '<button type="button" class="pie-btn" id="jg-new">换一张</button>' +
              '<button type="button" class="pie-btn" id="jg-opt">设置</button>' +
            '</div>' +
            '<div id="jg-msg" class="mono" style="font-size:13px; margin-top:10px; min-height:1.4em; color:var(--play);"></div>' +
          '</div>';
        var q = function (s) { return stage.querySelector(s); };
        var b = q('#jg-b'), prev = q('#jg-p');

        function setBg(el, piece) {
          var r = Math.floor(piece / size), c = piece % size;
          el.style.backgroundImage = 'url(' + url + ')';
          el.style.backgroundSize = (size * 100) + '% ' + (size * 100) + '%';
          el.style.backgroundPosition =
            (c / (size - 1) * 100) + '% ' + (r / (size - 1) * 100) + '%';
        }
        function win() {
          playing = false;
          stopTimers();
          b.classList.add('solved');
          if (!reduced) {
            b.parentNode.classList.add('win');
            confettiBurst(b.parentNode);
          }
          var bs = getBest(size);
          var isBest = !bs || sec < bs;
          if (isBest) { try { localStorage.setItem(bestKey(size), String(sec)); } catch (err) {} }
          q('#jg-msg').textContent =
            '✓ 拼好了！' + size + '×' + size + ' · 用时 ' + fmtT(sec) + ' · ' + moves + ' 步' + (isBest ? ' · 新纪录！' : '');
        }
        function tap(i) {
          if (!playing) return;
          var tiles = b.children;
          if (sel < 0) { sel = i; tiles[i].classList.add('sel'); return; }
          if (sel === i) { tiles[i].classList.remove('sel'); sel = -1; return; }
          var tmp = perm[sel]; perm[sel] = perm[i]; perm[i] = tmp;
          setBg(tiles[sel], perm[sel]);
          setBg(tiles[i], perm[i]);
          tiles[sel].classList.remove('sel');
          sel = -1;
          moves++;
          q('#jg-moves').textContent = moves + ' 步';
          if (solved()) win();
        }
        for (var m = 0; m < size * size; m++) {
          var t = document.createElement('div');
          t.className = 't';
          setBg(t, perm[m]);
          (function (idx) {
            t.addEventListener('click', function () { tap(idx); });
          })(m);
          b.appendChild(t);
        }
        timers.push(setInterval(function () {
          if (playing) { sec++; q('#jg-time').textContent = fmtT(sec); }
        }, 1000));
        var peek = q('#jg-peek');
        peek.addEventListener('pointerdown', function () { prev.style.display = 'block'; });
        peek.addEventListener('pointerup', function () { prev.style.display = 'none'; });
        peek.addEventListener('pointerleave', function () { prev.style.display = 'none'; });
        q('#jg-new').addEventListener('click', load);
        q('#jg-opt').addEventListener('click', setup);
      }

      setup();
      return function cleanup() { stopTimers(); freeObj(); };
    }

    /* ---------- GameMode: 游戏厅（合集大厅） ---------- */
    var ARC = [
      { id: 'budget',   name: '帧预算保卫战',    cat: 'gfx',     glyph: '16.7', desc: '接住 render pass，攒满一帧就提交', hiKey: 'yzzn-arcade-hi', start: budgetGame },
      { id: 'tex2048',  name: '纹理 2048',       cat: 'classic', glyph: '8K',   desc: '合并贴图分辨率，目标合出 8K', hiKey: 'yzzn-arc-tex2048', start: tex2048Game },
      { id: 'bugwhack', name: 'Bug 打地鼠',      cat: 'classic', glyph: 'BUG',  desc: '手起锤落修 bug，小心别打到需求', hiKey: 'yzzn-arc-bug', start: bugGame },
      { id: 'typer',    name: 'Shader 打字员',   cat: 'gfx',     glyph: 'HLSL', desc: '关键字落地之前把它敲出来', hiKey: 'yzzn-arc-typer', start: typerGame },
      { id: 'nback',    name: 'N-back 训练',     cat: 'ai',      glyph: 'N-bk', desc: '工作记忆测验，认知科学经典', hiKey: 'yzzn-arc-nback', hiSuf: '%', start: nbackGame },
      { id: 'jigsaw',   name: '拼图',            cat: 'classic', glyph: 'PZL',  desc: '实时抓取网络图片，切块复原', hiKey: 'yzzn-arc-jig4', hiLabel: 'BEST', hiSuf: 's', start: jigsawGame },
      { id: 'gradient', name: '梯度下降',        cat: 'ai',      glyph: '∇',    desc: '调好学习率，滚进全局最小值', wip: true },
      { id: 'tuner',    name: '调音师',          cat: 'music',   glyph: '440',  desc: '凭耳朵把失谐的音调准', wip: true },
      { id: 'overfit',  name: '过拟合警察',      cat: 'ai',      glyph: 'FIT',  desc: '一眼识别欠拟合与过拟合', wip: true },
      { id: 'frustum',  name: '视锥体剔除',      cat: 'gfx',     glyph: 'CULL', desc: '只点视锥内的，手要快', wip: true },
      { id: 'tetris',   name: 'Pass 俄罗斯方块', cat: 'classic', glyph: 'TET',  desc: '摆好 pass，整行提交一帧', wip: true },
      { id: 'rhythm',   name: '节奏机',          cat: 'music',   glyph: '4/4',  desc: '四轨下落式音游', wip: true }
    ];
    var ARC_CATS = {
      gfx: ['图形', '--c-render'],
      ai: ['AI·认知', '--c-ai'],
      music: ['音乐', '--c-life'],
      classic: ['经典改造', '--c-tool']
    };
    function arcHiOf(g) {
      if (!g.hiKey) return 0;
      try { return parseInt(localStorage.getItem(g.hiKey) || '0', 10); } catch (err) { return 0; }
    }
    GM.arcade = {
      bp: 'Arcade', zh: '游戏厅',
      start: function (stage) {
        var inGame = false, curClean = null, filter = 'all';
        function coins(delta) {
          var c = 0;
          try { c = parseInt(localStorage.getItem('yzzn-arc-coins') || '0', 10); } catch (err) {}
          if (delta) {
            c += delta;
            try { localStorage.setItem('yzzn-arc-coins', String(c)); } catch (err) {}
          }
          return c;
        }
        function renderHall() {
          inGame = false;
          pieTitleEl.textContent = '▶ 游戏厅';
          var html = '<div class="arc-hall"><div class="arc-top mono"><div class="arc-filters">' +
            '<button type="button" class="pie-btn arc-f' + (filter === 'all' ? ' on' : '') + '" data-f="all">全部</button>';
          Object.keys(ARC_CATS).forEach(function (k) {
            html += '<button type="button" class="pie-btn arc-f' + (filter === k ? ' on' : '') + '" data-f="' + k + '">' + ARC_CATS[k][0] + '</button>';
          });
          html += '</div><span class="arc-coins">累计投币 ' + coins(0) + ' 次</span></div><div class="arc-grid">';
          ARC.forEach(function (g) {
            if (filter !== 'all' && g.cat !== filter) return;
            var hi = arcHiOf(g);
            html += '<div class="arc-card' + (g.wip ? ' wip' : '') + '" data-id="' + g.id + '" role="button" tabindex="' + (g.wip ? -1 : 0) + '">' +
              '<div class="arc-glyph" style="color:var(' + ARC_CATS[g.cat][1] + ');">' + g.glyph + '</div>' +
              '<div class="arc-name">' + g.name + '</div>' +
              '<div class="arc-desc">' + g.desc + '</div>' +
              '<div class="arc-meta">' +
                (g.wip ? '<span class="tag-wip">开发中</span>'
                       : (hi ? '<span>' + (g.hiLabel || 'HI') + ' ' + hi + (g.hiSuf || '') + '</span>' : '<span>NEW</span>')) +
                '<span>' + ARC_CATS[g.cat][0] + '</span>' +
              '</div></div>';
          });
          html += '</div></div>';
          stage.innerHTML = html;
          stage.querySelectorAll('.arc-f').forEach(function (b) {
            b.addEventListener('click', function () {
              filter = b.getAttribute('data-f');
              renderHall();
            });
          });
          stage.querySelectorAll('.arc-card').forEach(function (c) {
            c.addEventListener('click', function () {
              var g = null;
              ARC.forEach(function (x) { if (x.id === c.getAttribute('data-id')) g = x; });
              if (g && !g.wip) openGame(g);
            });
          });
        }
        function openGame(g) {
          coins(1);
          inGame = true;
          pieTitleEl.textContent = '▶ 游戏厅 › ' + g.name;
          stage.innerHTML =
            '<div class="arc-game">' +
              '<div class="arc-gamebar mono">' +
                '<button type="button" class="pie-btn" id="arc-back">← 大厅</button>' +
                '<span>' + g.name + '</span>' +
              '</div>' +
              '<div id="arc-body"></div>' +
            '</div>';
          stage.querySelector('#arc-back').addEventListener('click', backToHall);
          curClean = g.start(stage.querySelector('#arc-body')) || null;
        }
        function backToHall() {
          if (curClean) { try { curClean(); } catch (err) {} curClean = null; }
          renderHall();
        }
        pieEscHook = function () {
          if (inGame) { backToHall(); return true; }
          return false;
        };
        renderHall();
        return function cleanup() {
          if (curClean) { try { curClean(); } catch (err) {} curClean = null; }
        };
      }
    };

    /* ---------- GameMode: 运动 · 拉伸 Montage ---------- */
    GM.workout = {
      bp: 'Workout', zh: '工间拉伸',
      start: function (stage) {
        var EX = [
          { name: '颈部拉伸', desc: '头缓慢倒向一侧肩膀，保持 10 秒后换边。不要耸肩。', dur: 20, pose: 'neck' },
          { name: '肩部环绕', desc: '双肩向后缓慢画圈，打开胸腔，配合深呼吸。', dur: 20, pose: 'shoulder' },
          { name: '手腕拉伸', desc: '伸直手臂掌心向前，另一手轻拉手指——鼠标手救星。左右各 10 秒。', dur: 20, pose: 'wrist' },
          { name: '开胸展背', desc: '十指相扣置于背后，向后向下伸展，挺胸抬头。', dur: 20, pose: 'chest' },
          { name: '远眺护眼', desc: '注视 6 米以外的物体 20 秒，让睫状肌歇歇。顺便确认一下远景 LOD 没崩。', dur: 20, pose: 'eye' },
          { name: '起身伸展', desc: '站起来，双手交扣举过头顶用力向上够，踮脚更佳。', dur: 20, pose: 'stand' }
        ];
        var POSES = {
          neck:     { head: [88, 34, 10], lines: [[80,46,80,106],[80,58,58,92],[80,58,102,92],[80,106,64,148],[80,106,96,148]] },
          shoulder: { head: [80, 32, 10], lines: [[80,44,80,106],[80,58,56,50],[56,50,48,28],[80,58,104,50],[104,50,112,28],[80,106,64,148],[80,106,96,148]] },
          wrist:    { head: [72, 34, 10], lines: [[72,46,72,106],[72,58,122,54],[122,54,128,42],[72,64,108,64],[72,106,58,148],[72,106,88,148]] },
          chest:    { head: [80, 32, 10], lines: [[80,44,80,106],[80,58,64,88],[80,58,96,88],[64,88,96,88],[80,106,64,148],[80,106,96,148]] },
          eye:      { head: [36, 40, 9],  lines: [[32,50,32,100],[32,60,20,84],[32,60,46,80],[32,100,22,140],[32,100,44,140],[124,26,142,26],[142,26,142,44],[142,44,124,44],[124,44,124,26]], dash: [[48,42,120,34]] },
          stand:    { head: [80, 30, 10], lines: [[80,42,80,104],[80,54,64,18],[80,54,96,18],[80,104,66,148],[80,104,94,148]] }
        };
        stage.innerHTML =
          '<div class="pie-panel">' +
            '<h3>工间拉伸</h3>' +
            '<div class="sub">6 节 · 每节 20 秒 · 共 2 分钟。跟着火柴人做。</div>' +
            '<div id="wo-tl" style="display:flex; gap:3px; margin-bottom:20px;"></div>' +
            '<div style="display:flex; gap:24px; align-items:center;">' +
              '<canvas id="wo-cv" width="160" height="160" style="border:1px solid var(--line); flex:none; background:var(--surface2);"></canvas>' +
              '<div style="flex:1; min-width:0;">' +
                '<div style="font-size:18px; font-weight:800; margin:4px 0;" id="wo-name"></div>' +
                '<div style="font-size:13px; color:var(--ink2); line-height:1.7;" id="wo-desc"></div>' +
                '<div class="mono" style="font-size:30px; font-weight:700; margin-top:10px;" id="wo-count"></div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top:22px; display:flex; gap:10px;">' +
              '<button type="button" class="pie-btn" id="wo-pause">暂停</button>' +
              '<button type="button" class="pie-btn" id="wo-skip">跳过本节</button>' +
              '<span class="mono" style="margin-left:auto; font-size:12px; color:var(--ink2); align-self:center;" id="wo-step"></span>' +
            '</div>' +
          '</div>';
        var q = function (s) { return stage.querySelector(s); };
        var tl = q('#wo-tl');
        EX.forEach(function () {
          var seg = document.createElement('div');
          seg.style.cssText = 'flex:1; height:10px; background:var(--surface2); border:1px solid var(--line); overflow:hidden;';
          seg.innerHTML = '<i style="display:block; height:100%; width:0%; background:var(--play);"></i>';
          tl.appendChild(seg);
        });
        var cv = q('#wo-cv').getContext('2d');
        function drawPose(key) {
          var p = POSES[key];
          var ink = getComputedStyle(document.body).getPropertyValue('--ink').trim();
          cv.clearRect(0, 0, 160, 160);
          cv.strokeStyle = ink;
          cv.lineWidth = 3;
          cv.lineCap = 'round';
          cv.setLineDash([]);
          cv.beginPath();
          cv.arc(p.head[0], p.head[1], p.head[2], 0, 6.2832);
          cv.stroke();
          cv.beginPath();
          p.lines.forEach(function (l) { cv.moveTo(l[0], l[1]); cv.lineTo(l[2], l[3]); });
          cv.stroke();
          if (p.dash) {
            cv.setLineDash([4, 5]);
            cv.beginPath();
            p.dash.forEach(function (l) { cv.moveTo(l[0], l[1]); cv.lineTo(l[2], l[3]); });
            cv.stroke();
            cv.setLineDash([]);
          }
        }
        var idx = 0, t = 0, paused = false, timer = null;
        function show() {
          var e = EX[idx];
          q('#wo-name').textContent = e.name;
          q('#wo-desc').textContent = e.desc;
          q('#wo-step').textContent = '第 ' + (idx + 1) + ' / ' + EX.length + ' 节';
          drawPose(e.pose);
        }
        function finish() {
          clearInterval(timer); timer = null;
          stage.innerHTML =
            '<div class="pie-panel" style="text-align:center;">' +
              '<h3 style="color:var(--play);">拉伸完成 ✓</h3>' +
              '<div class="sub">6 节全部完成。脖子和手腕会感谢你的。</div>' +
              '<button type="button" class="pie-btn primary" id="wo-again">再来一遍</button>' +
            '</div>';
          stage.querySelector('#wo-again').addEventListener('click', function () {
            exitPie(true); enterPie('workout');
          });
        }
        function next() {
          idx++;
          t = 0;
          if (idx >= EX.length) { finish(); return; }
          show();
        }
        show();
        timer = setInterval(function () {
          if (paused || !timer) return;
          t += 0.1;
          var e = EX[idx];
          q('#wo-count').textContent = Math.ceil(Math.max(0, e.dur - t)) + ' s';
          tl.children[idx].firstChild.style.width = Math.min(100, t / e.dur * 100) + '%';
          if (t >= e.dur) next();
        }, 100);
        q('#wo-pause').addEventListener('click', function () {
          paused = !paused;
          this.textContent = paused ? '继续' : '暂停';
        });
        q('#wo-skip').addEventListener('click', function () {
          if (timer) { tl.children[idx].firstChild.style.width = '100%'; next(); }
        });
        return function cleanup() { if (timer) clearInterval(timer); };
      }
    };

    /* ---------- GameMode: 禅 · 空关卡 ---------- */
    GM.zen = {
      bp: 'Zen', zh: '禅 · 放空一会儿',
      incognito: true,
      start: function (stage) {
        hudSuspend = true;
        body.classList.add('zen-hide');
        var QUOTES = [
          '过早的优化是万恶之源。 — Donald Knuth',
          '先让它跑起来，再让它跑对，最后让它跑快。 — Kent Beck',
          '一帧迟到的画面，就是一帧丢失的画面。',
          '实时渲染是妥协的艺术：快、好、便宜，你只能选到"快"。',
          'The best code is no code at all.',
          '阴影没有 bug，只有你还没理解的投影空间。',
          'Focus is a matter of deciding what things you’re not going to do. — John Carmack',
          '删掉的代码是调试过的代码。',
          '所有的卡顿，最后都会在 profiler 里认罪。',
          '音乐是心灵在不自觉中进行的算术。 — 莱布尼茨',
          '大脑是唯一用自己来研究自己的器官。',
          'Ship it.'
        ];
        stage.innerHTML =
          '<div class="zen-quote">' +
            '<p id="zen-q"></p>' +
            '<span class="hint mono">点击换一句 · ESC 退出</span>' +
          '</div>';
        var qEl = stage.querySelector('#zen-q');
        var last = -1;
        function pick() {
          var i;
          do { i = Math.floor(Math.random() * QUOTES.length); } while (i === last && QUOTES.length > 1);
          last = i;
          qEl.textContent = QUOTES[i];
        }
        pick();
        stage.addEventListener('click', pick);
        return function cleanup() { body.classList.remove('zen-hide'); };
      }
    };

    /* ---------- 鼠标交互（仅精确指针设备） ---------- */
    var fine = window.matchMedia('(pointer: fine)').matches;
    if (!fine) return;

    /* 1. MegaLights 光标点光：带惯性跟随 */
    var light = document.createElement('div');
    light.id = 'cursor-light';
    document.body.appendChild(light);
    var tx = 0, ty = 0, lx = -9999, ly = -9999, lit = false;
    document.addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      if (!lit) { lit = true; lx = tx; ly = ty; light.style.opacity = '1'; }
    });
    document.documentElement.addEventListener('mouseleave', function () {
      light.style.opacity = '0'; lit = false;
    });
    (function tick() {
      if (reduced) { lx = tx; ly = ty; }
      else { lx += (tx - lx) * 0.12; ly += (ty - ly) * 0.12; }
      light.style.transform = 'translate(' + lx + 'px,' + ly + 'px)';
      requestAnimationFrame(tick);
    })();

    /* 2. 框选 Actor：空白处拖拽拉出选框 */
    var mq = document.createElement('div');
    mq.id = 'marquee';
    var cnt = document.createElement('span');
    cnt.className = 'cnt mono';
    mq.appendChild(cnt);
    document.body.appendChild(mq);

    var drag = false, moved = false, sx = 0, sy = 0, selectables = [];
    function clearSelection() {
      document.querySelectorAll('.selected').forEach(function (el) { el.classList.remove('selected'); });
    }
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('a, button, input, header, .frame, .about, .console, .pie-layer')) return;
      drag = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      selectables = Array.prototype.slice.call(document.querySelectorAll('.col-card, .post, .cvar'));
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      var w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      if (!moved && w + h < 6) return;
      if (!moved) { moved = true; document.body.style.userSelect = 'none'; }
      mq.style.display = 'block';
      mq.style.left = x + 'px'; mq.style.top = y + 'px';
      mq.style.width = w + 'px'; mq.style.height = h + 'px';
      var n = 0;
      selectables.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var hit = r.left < x + w && r.right > x && r.top < y + h && r.bottom > y;
        el.classList.toggle('selected', hit);
        if (hit) n++;
      });
      cnt.textContent = n ? n + ' selected' : '';
    });
    document.addEventListener('mouseup', function () {
      if (!drag) return;
      drag = false;
      mq.style.display = 'none';
      document.body.style.userSelect = '';
      if (moved) {
        var n = document.querySelectorAll('.selected').length;
        echo.textContent = n
          ? '已选中 ' + n + ' 个 Actor（点击空白处取消）'
          : '';
      }
    });
    document.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }   /* 框选结束触发的 click 不清除选择 */
      if (!e.target.closest('.selected')) clearSelection();
    });

    /* 3. 专栏卡片：跟随鼠标的 3D 倾斜 */
    if (!reduced) {
      document.querySelectorAll('.col-card').forEach(function (card) {
        card.addEventListener('mousemove', function (e) {
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          card.style.transform = 'perspective(650px) rotateX(' + (-py * 4).toFixed(2) + 'deg) rotateY(' + (px * 5).toFixed(2) + 'deg)';
        });
        card.addEventListener('mouseleave', function () {
          card.style.transform = '';
        });
      });
    }
  })();
