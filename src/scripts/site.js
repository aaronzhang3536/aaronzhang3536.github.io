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
      off:   SVG + SUN + '<path d="M2 14 14 2"/></svg>',
      snd:   SVG + '<path d="M2.5 6v4h2.8L9 13V3L5.3 6z"/><path d="M10.8 5.5a3.4 3.4 0 0 1 0 5M12.6 3.8a5.8 5.8 0 0 1 0 8.4"/></svg>',
      sndoff: SVG + '<path d="M2.5 6v4h2.8L9 13V3L5.3 6z"/><path d="M11 6.5l3 3M14 6.5l-3 3"/></svg>'
    };

    var btnTheme = document.getElementById('btn-theme');
    var themeOrder = ['dark', 'light', 'wire'];
    var themeNames = { dark: 'DARK', light: 'LIGHT', wire: 'WIREFRAME' };
    var themeZh = { dark: '暗色', light: '亮色', wire: '线框' };
    var storedTheme = null;
    try { storedTheme = localStorage.getItem('yzzn-theme'); } catch (err) {}
    var curTheme = storedTheme ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var lastLit = curTheme === 'wire' ? 'dark' : curTheme;
    function setTheme(m) {
      curTheme = m;
      try { localStorage.setItem('yzzn-theme', m); } catch (err) {}
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
          bgSave();
          if (bgTimer) clearInterval(bgTimer);
          bgImgs.forEach(function (im) { im.classList.remove('show'); });
          echo.textContent = '背景图已关闭。';
        } else if (ba === 'on') {
          bgOn = true; bgSave(); bgNext(); bgStart();
          echo.textContent = '背景图已开启，每 ' + (bgInterval / 1000) + ' 秒刷新。';
        } else if (ba === 'next') {
          if (!bgOn) { echo.textContent = '背景图处于关闭状态，先执行 bg on。'; }
          else { bgNext(); echo.textContent = '正在拉取下一张背景图…'; }
        } else if (/^\d+$/.test(ba)) {
          bgInterval = Math.max(5, parseInt(ba, 10)) * 1000;
          bgSave();
          if (bgOn) bgStart();
          echo.textContent = '背景图刷新间隔已设为 ' + (bgInterval / 1000) + ' 秒。';
        } else {
          echo.textContent = '用法：bg on | off | next | <秒数>　当前：' +
            (bgOn ? '开启，每 ' + (bgInterval / 1000) + ' 秒刷新' : '关闭');
        }
        return;
      }
      if (v.indexOf('search ') === 0) {
        location.href = '/search/?q=' + encodeURIComponent(v.slice(7).trim());
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
        case 'sound on': if (!sndOn) sndToggle(); echo.textContent = '环境音已开启。'; break;
        case 'sound off': if (sndOn) sndToggle(); echo.textContent = '环境音已关闭。'; break;
        case 'stat fps': echo.textContent = '60.2 FPS — 16.61 ms（稳如老狗）'; break;
        case 'help': echo.textContent = 'dark | light | wireframe | lit | weather rain|storm|… | bg on|off|next|<秒> | play arcade|tea|workout|idle|zen | sound on|off | stat fps | quit'; break;
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
    var bgPref = '';
    try { bgPref = localStorage.getItem('yzzn-bg') || ''; } catch (err) {}
    var bgImgs = [], bgCur = 0, bgTimer = null, bgOn = bgPref !== 'off';
    var bgInterval = (parseInt(bgPref, 10) || 60) * 1000, bgLoading = false;
    function bgSave() {
      try { localStorage.setItem('yzzn-bg', bgOn ? String(bgInterval / 1000) : 'off'); } catch (err) {}
    }
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
    /* 底部积累：雪堆 / 沙丘用高度场，雨用积水系数 + 涟漪 */
    var ACC_W = 6, ACC_CAP = 64;   /* 积累到约小草高度(px)就封顶，不再增长 */
    var wxAccum = null, wxAccumN = 0, wxWet = 0, wxRipples = [];
    var wxMeadow = null;   /* 晴天草地 */
    function accIdx(x) { return Math.max(0, Math.min(wxAccumN - 1, Math.round(x / ACC_W))); }
    function accAt(x) { return wxAccum ? wxAccum[accIdx(x)] : 0; }
    function accAdd(x, amt, cap) {
      if (!wxAccum) return;
      var i = accIdx(x);
      wxAccum[i] = Math.min(cap, wxAccum[i] + amt);
    }
    function drawAccum(color, alpha) {
      if (!wxAccum) return;
      var top = 0;
      for (var i = 0; i < wxAccumN; i++) if (wxAccum[i] > top) top = wxAccum[i];
      if (top < 0.8) return;
      var g = wxCtx;
      g.beginPath();
      g.moveTo(0, wxH + 2);
      for (var j = 0; j < wxAccumN; j++) g.lineTo(j * ACC_W, wxH - wxAccum[j]);
      g.lineTo(wxW, wxH + 2);
      g.closePath();
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
    }
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
      wxMeadow = null;
      wxAccumN = Math.ceil(wxW / ACC_W) + 1;
      wxAccum = [];
      for (var ai = 0; ai < wxAccumN; ai++) wxAccum.push(0);
      wxWet = 0;
      wxRipples = [];
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
        n = Math.min(Math.round(area / 7000), 340);
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
      } else if (wxMode === 'clear') {
        /* 晴天：底部长出花花草草 */
        var csm = getComputedStyle(document.body);
        var tok = function (k, fb) {
          var v = csm.getPropertyValue(k).trim();
          return (!v || v === 'transparent') ? csm.getPropertyValue(fb).trim() : v;
        };
        var grassCol = tok('--c-engine', '--wx-wind');
        var petals = ['--c-render', '--c-ai', '--c-life', '--accent', '--c-tool']
          .map(function (k) { return tok(k, '--accent'); });
        wxMeadow = [];
        var nB = Math.min(Math.round(wxW / 6), 320);
        for (var bi = 0; bi < nB; bi++) {
          var isF = Math.random() < 0.16;
          wxMeadow.push({
            x: Math.random() * wxW,
            h: 16 + Math.random() * (isF ? 34 : 48),
            g: 0,
            rate: 1 / (12 + Math.random() * 24),
            ph: Math.random() * 6.28,
            sw: 0.6 + Math.random() * 0.8,
            f: isF ? petals[Math.floor(Math.random() * petals.length)] : null,
            c: grassCol,
            a: 0.62 + Math.random() * 0.35
          });
        }
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
      try { localStorage.setItem('yzzn-wx', m); } catch (err) {}
      wxLoad = wxLoadMap[m];
      bolts = null; wxFlashEl.style.opacity = '0';
      nextBolt = performance.now() + 2500;
      wxBuild();
      wxRefreshColors();
      btnWx.innerHTML = icons[m];
      var wl = '天气：' + wxNames[m] + '（点击切换）';
      btnWx.title = wl;
      btnWx.setAttribute('aria-label', wl);
      sndSet(m);
      if (!silent) echo.textContent = '天气切换：' + wxNames[m];
    }
    btnWx.addEventListener('click', function () {
      var next = wxOrder[(wxOrder.indexOf(wxMode) + 1) % wxOrder.length];
      setWeather(next, true);
    });

    /* ---------- 天气环境音（WebAudio 合成，无音频文件） ---------- */
    var btnSnd = document.getElementById('btn-snd');
    var sndOn = false;
    try { sndOn = localStorage.getItem('yzzn-snd') === '1'; } catch (err) {}
    var AC = null, sndNoise = null, sndStopFn = null, sndMode = 'clear';

    function sndCtx() {
      if (!AC) {
        var A = window.AudioContext || window.webkitAudioContext;
        AC = new A();
        AC.onstatechange = function () { sndRefreshBtn(); };
        var len = AC.sampleRate * 2;
        sndNoise = AC.createBuffer(1, len, AC.sampleRate);
        var d = sndNoise.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (AC.state === 'suspended') AC.resume();
      return AC;
    }
    function sndStop() {
      if (sndStopFn) { try { sndStopFn(); } catch (err) {} sndStopFn = null; }
      sndRefreshBtn();
    }
    /* 真实发声状态：开关为开、当前天气有音可放、且确实在响 */
    function sndActive() {
      if (!sndOn) return false;
      if (sndMode === 'clear') return true;   /* 晴天本来就静音，视为正常 */
      return !!(AC && AC.state === 'running' && sndStopFn);
    }
    /* 每种天气一套合成配方：噪声源 + 滤波 + 缓慢 LFO */
    function sndBuild(mode) {
      sndStop();
      if (mode === 'clear' || !sndOn) return;
      var ctx = sndCtx();
      var master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
      var nodes = [master];
      function layer(filterType, freq, q, gain) {
        var src = ctx.createBufferSource();
        src.buffer = sndNoise; src.loop = true;
        var f = ctx.createBiquadFilter();
        f.type = filterType; f.frequency.value = freq; f.Q.value = q;
        var g = ctx.createGain(); g.gain.value = gain;
        src.connect(f); f.connect(g); g.connect(master);
        src.start();
        nodes.push(src);
        return { f: f, g: g };
      }
      function lfo(param, base, depth, hz) {
        var o = ctx.createOscillator();
        o.frequency.value = hz;
        var og = ctx.createGain(); og.gain.value = depth;
        param.value = base;
        o.connect(og); og.connect(param);
        o.start();
        nodes.push(o);
      }
      if (mode === 'rain') {
        layer('lowpass', 800, 0.7, 0.05);
        layer('bandpass', 2400, 1.5, 0.012);          /* 高频雨点沙沙 */
      } else if (mode === 'storm') {
        layer('lowpass', 700, 0.7, 0.065);
        var rumble = layer('lowpass', 120, 0.5, 0.05); /* 持续低频滚雷 */
        lfo(rumble.g.gain, 0.04, 0.025, 0.11);
      } else if (mode === 'wind') {
        var w = layer('bandpass', 380, 0.6, 0.045);
        lfo(w.f.frequency, 380, 220, 0.13);            /* 呼啸的音高起伏 */
        lfo(w.g.gain, 0.04, 0.028, 0.17);
      } else if (mode === 'snow') {
        var s = layer('lowpass', 350, 0.5, 0.018);     /* 几乎无声的柔风 */
        lfo(s.g.gain, 0.015, 0.008, 0.08);
      } else if (mode === 'sand') {
        var g1 = layer('bandpass', 950, 0.5, 0.05);
        layer('bandpass', 2600, 0.8, 0.02);            /* 沙砾摩擦感 */
        lfo(g1.f.frequency, 950, 350, 0.2);
      }
      sndStopFn = function () {
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + 0.5);
        setTimeout(function () {
          nodes.forEach(function (n) {
            try { if (n.stop) n.stop(); n.disconnect(); } catch (err) {}
          });
        }, 600);
      };
      sndRefreshBtn();
    }
    function sndSet(mode) {
      sndMode = mode;
      if (sndOn && AC) sndBuild(mode);
    }
    /* 雷声：随机远近的多层合成 —— 炸裂声 + 主体轰鸣 + 次声滚雷 + 回滚，近雷震屏 */
    function thunder(strikes) {
      if (!sndOn || !AC) return;
      var dist = Math.random();                     /* 0 = 头顶炸雷，1 = 天边闷雷 */
      var delay = 150 + dist * 1400;                /* 光先到，声后到 */
      setTimeout(function () {
        var ctx = AC;
        if (ctx.state !== 'running') return;
        var t = ctx.currentTime;
        var close = 1 - dist;
        var power = Math.min(0.5 + strikes * 0.08 + close * 0.5, 1.3);

        /* 压限器兜底，允许更高的响度而不破音 */
        var comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.3;
        var tail = comp;
        if (ctx.createStereoPanner) {
          var pan = ctx.createStereoPanner();
          pan.pan.setValueAtTime((Math.random() * 2 - 1) * 0.7, t);
          pan.pan.linearRampToValueAtTime((Math.random() * 2 - 1) * 0.7, t + 4.5);
          comp.connect(pan);
          tail = pan;
        }
        tail.connect(ctx.destination);

        function burst(at, dur, f0, f1, type, peak, q) {
          if (peak <= 0.005) return;
          var src = ctx.createBufferSource();
          src.buffer = sndNoise;
          src.loop = true;
          var f = ctx.createBiquadFilter();
          f.type = type;
          f.Q.value = q || 0.7;
          f.frequency.setValueAtTime(f0, t + at);
          if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
          var g = ctx.createGain();
          g.gain.setValueAtTime(0, t + at);
          g.gain.linearRampToValueAtTime(peak, t + at + 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
          src.connect(f); f.connect(g); g.connect(comp);
          src.start(t + at);
          src.stop(t + at + dur + 0.1);
        }
        burst(0, 0.3, 3200, 900, 'bandpass', 0.5 * power * close, 1.2);   /* 炸裂（近雷才尖）*/
        burst(0.02, 2.2, 520, 85, 'lowpass', 0.85 * power);               /* 主体轰鸣 */
        burst(0.1, 4.5 + strikes * 0.5, 80, 45, 'lowpass', 0.7 * power);  /* 次声滚雷 */
        burst(1.0, 2.2, 260, 70, 'lowpass', 0.4 * power);                 /* 第一次回滚 */
        burst(2.1, 2.6, 180, 55, 'lowpass', 0.22 * power);                /* 天边折返 */

        /* 头顶的雷把屏幕也震一下 */
        if (close > 0.55 && !reduced) {
          document.body.classList.add('thunder-shake');
          setTimeout(function () {
            document.body.classList.remove('thunder-shake');
          }, 500);
        }
      }, delay);
    }
    function sndRefreshBtn() {
      if (!btnSnd) return;
      var pending = sndOn && !sndActive();
      btnSnd.innerHTML = icons[sndOn ? 'snd' : 'sndoff'];
      btnSnd.style.opacity = pending ? '0.4' : '';
      var st = pending
        ? '环境音：待激活（点击恢复播放）'
        : '环境音：' + (sndOn ? '开' : '关') + '（点击切换）';
      btnSnd.title = st;
      btnSnd.setAttribute('aria-label', st);
    }
    function sndToggle() {
      /* 开关显示"开"但实际没在响：先让声音恢复，而不是把开关关掉 */
      if (sndOn && !sndActive()) {
        sndCtx();
        sndBuild(sndMode);
        sndRefreshBtn();
        return;
      }
      sndOn = !sndOn;
      try { localStorage.setItem('yzzn-snd', sndOn ? '1' : '0'); } catch (err) {}
      if (sndOn) { sndCtx(); sndBuild(sndMode); }
      else sndStop();
      sndRefreshBtn();
    }
    if (btnSnd) btnSnd.addEventListener('click', sndToggle);
    sndRefreshBtn();
    /* 上次开着音：等第一次交互手势后恢复（浏览器自动播放策略）。
       手势若落在声音按钮上则交给按钮自己处理，避免两个逻辑打架 */
    if (sndOn) {
      var sndArm = function (e) {
        if (e && e.target && e.target.closest && e.target.closest('#btn-snd')) return;
        document.removeEventListener('pointerdown', sndArm);
        document.removeEventListener('keydown', sndArm);
        sndCtx();
        sndBuild(sndMode);
        sndRefreshBtn();
      };
      document.addEventListener('pointerdown', sndArm);
      document.addEventListener('keydown', sndArm);
    }

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
      var storedWx = null;
      try { storedWx = localStorage.getItem('yzzn-wx'); } catch (err) {}
      setWeather(storedWx && wxLoadMap.hasOwnProperty(storedWx) ? storedWx : 'rain', true);

      var wxPrev = 0;
      (function wxLoop(ts) {
        requestAnimationFrame(wxLoop);
        var dt = Math.min((ts - wxPrev) / 1000, 0.05);
        wxPrev = ts;
        wxT += dt;
        if (++wxColorTick % 45 === 0) wxRefreshColors();  /* 跟随主题/视图模式换色 */
        wxCtx.clearRect(0, 0, wxW, wxH);
        if (wxMode === 'clear') {
          if (!wxMeadow) return;
          var gm = wxCtx;
          var breeze = Math.sin(wxT * 0.4) * 0.6 + Math.sin(wxT * 1.7) * 0.2;
          for (var mi = 0; mi < wxMeadow.length; mi++) {
            var bl = wxMeadow[mi];
            if (bl.g < 1) bl.g = Math.min(1, bl.g + bl.rate * dt);
            var hgt = bl.h * bl.g;
            if (hgt < 2) continue;
            var bend = (Math.sin(wxT * bl.sw + bl.ph) * 3 + breeze * 6) * (hgt / 40);
            var tipX = bl.x + bend, tipY = wxH - hgt;
            gm.strokeStyle = bl.c;
            gm.globalAlpha = bl.a;
            gm.lineWidth = 1.8;
            gm.beginPath();
            gm.moveTo(bl.x, wxH + 1);
            gm.quadraticCurveTo(bl.x + bend * 0.3, wxH - hgt * 0.55, tipX, tipY);
            gm.stroke();
            if (bl.f) {
              var bloom = Math.max(0, (bl.g - 0.7) / 0.3);
              if (bloom > 0.05) {
                var fr = 2.6 * bloom;
                gm.fillStyle = bl.f;
                for (var pi = 0; pi < 5; pi++) {
                  var pa = pi / 5 * 6.2832 + bl.ph;
                  gm.beginPath();
                  gm.arc(tipX + Math.cos(pa) * fr, tipY + Math.sin(pa) * fr, fr * 0.75, 0, 6.2832);
                  gm.fill();
                }
                gm.fillStyle = bl.c;
                gm.beginPath();
                gm.arc(tipX, tipY, fr * 0.55, 0, 6.2832);
                gm.fill();
              }
            }
          }
          gm.globalAlpha = 1;
          return;
        }

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
            var floorY = wxH - 3 - wxWet;
            if (p.y > floorY) {
              wxWet = Math.min(ACC_CAP, wxWet + (wxMode === 'storm' ? 0.014 : 0.006));
              if (wxRipples.length < 28 && Math.random() < 0.25) {
                wxRipples.push({ x: p.x, y: floorY, r: 1.5, a: 0.5 });
              }
              p.y = -24; p.x = Math.random() * wxW;
            }
            if (p.x > wxW + 30) p.x = -30;
            var slope = wxWind * 1.2 / p.spd;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - slope * p.len, p.y - p.len);
          }
          ctx.stroke();

          /* 底部积水与涟漪 */
          if (wxWet > 1) {
            var band = wxWet;
            ctx.globalAlpha = Math.min(0.22 + wxWet / 300, 0.55);
            ctx.fillStyle = wxColors.rain;
            ctx.fillRect(0, wxH - band, wxW, band);
            ctx.globalAlpha = 1;
          }
          for (var ri = wxRipples.length - 1; ri >= 0; ri--) {
            var rp = wxRipples[ri];
            rp.r += 34 * dt;
            rp.a -= dt * 0.85;
            if (rp.a <= 0) { wxRipples.splice(ri, 1); continue; }
            ctx.globalAlpha = rp.a;
            ctx.strokeStyle = wxColors.rain;
            ctx.beginPath();
            ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, 6.2832);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;

          /* 闪电（仅雷暴）：每次雷击 1~5 条 */
          if (wxMode === 'storm') {
            if (ts > nextBolt) {
              bolts = makeStrike(); boltAge = 0;
              thunder(bolts.length);
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
            if (p.y > wxH - 2 - accAt(p.x)) {
              accAdd(p.x, (0.45 + p.size * 0.22) * 7, ACC_CAP);
              p.y = -6; p.x = Math.random() * wxW;
            }
            if (p.x > wxW + 6) p.x = -6;
            if (p.x < -6) p.x = wxW + 6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, 6.2832);
            ctx.fill();
          }
          for (var si = 1; si < wxAccumN - 1; si++) {
            wxAccum[si] += ((wxAccum[si - 1] + wxAccum[si + 1]) / 2 - wxAccum[si]) * 0.02;
          }
          drawAccum(wxColors.snow, 0.9);
        } else if (wxMode === 'sand') {
          ctx.fillStyle = wxColors.haze;
          ctx.fillRect(0, 0, wxW, wxH);
          for (i = 0; i < wxParts.length; i++) {
            p = wxParts[i];
            p.x += (p.spd + wxWind * 0.5) * dt;
            p.y += Math.sin(wxT * 3 + p.ph) * 26 * dt + 8 * dt;
            if (p.x > wxW + 8) { p.x = -8; p.y = Math.random() * wxH; }
            if (p.y > wxH - 24 - accAt(p.x) && Math.random() < dt * 5) {
              accAdd(p.x, 2.2, ACC_CAP);
              p.y = Math.random() * wxH * 0.6;
              p.x = -8;
            }
            ctx.globalAlpha = p.a;
            ctx.fillStyle = wxColors.sand;
            ctx.fillRect(p.x, p.y, p.size * 2.2, p.size);
          }
          for (var di = wxAccumN - 2; di >= 0; di--) {
            var mv = wxAccum[di] * 0.006;
            wxAccum[di] -= mv;
            wxAccum[di + 1] = Math.min(ACC_CAP, wxAccum[di + 1] + mv);
          }
          drawAccum(wxColors.sand, 0.85);
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

    /* ---------- 摸鱼 · WebGPU 写实鱼缸（glTF 模型 + PBR-lite + 假 GI） ---------- */
    function fishTankGPU(stage) {
      var dead = false, innerCleanup = null, raf = null;
      var W = Math.min(840, window.innerWidth - 60);
      var H = Math.min(470, window.innerHeight - 230);
      var touched = 0;
      try { touched = parseInt(localStorage.getItem('yzzn-fish') || '0', 10); } catch (err) {}
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<canvas id="f4d" style="border:1px solid var(--line); max-width:94vw;"></canvas>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">左键拖拽环绕 · 滚轮缩放 · 右键拖拽平移 · 双击复位 · 点按撒食 / 摸鱼 · 模型 Barramundi Fish (CC0)</div>' +
          '<div class="mono" id="f4d-n" style="font-size:12.5px; margin-top:6px; color:var(--ink);"></div>' +
        '</div>';
      var cvs = stage.querySelector('#f4d');
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = W * dpr; cvs.height = H * dpr;
      cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
      var nEl = stage.querySelector('#f4d-n');
      function hud() { if (nEl) nEl.textContent = '累计摸鱼 ' + touched + ' 次'; }
      hud();

      function fallback() {
        if (dead) return;
        stage.innerHTML =
          '<div class="pie-panel" style="text-align:center;">' +
            '<h3>需要 WebGPU</h3>' +
            '<div class="sub">这缸鱼由 WebGPU 实时渲染。请用新版 Chrome / Edge / Firefox / Safari 打开。</div>' +
          '</div>';
      }

      function cssRGB(name, fb) {
        var v = getComputedStyle(document.body).getPropertyValue(name).trim();
        if (!v || v === 'transparent') v = fb;
        var m = v.match(/^#([0-9a-f]{6})$/i);
        if (m) {
          var n = parseInt(m[1], 16);
          return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        }
        m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
        if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
        return [1, 0.55, 0.2];
      }
      function lin3(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }
      function mMulG(a, b) {
        var o = new Float32Array(16);
        for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
        return o;
      }
      function mPerspG(fovy, asp, n, f) {
        var t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
        o[0] = t / asp; o[5] = t; o[10] = f / (n - f); o[11] = -1; o[14] = f * n / (n - f);
        return o;
      }
      function mLookG(eye, at) {
        var zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
        var zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
        var xx = zz, xz = -zx;
        var xl = Math.hypot(xx, xz) || 1; xx /= xl; xz /= xl;
        var yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
        return new Float32Array([
          xx, yx, zx, 0,
          0, yy, zy, 0,
          xz, yz, zz, 0,
          -(xx * eye[0] + xz * eye[2]),
          -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
          -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
        ]);
      }

      (async function init() {
        var adapter = null, device = null;
        try {
          if (navigator.gpu) {
            adapter = await navigator.gpu.requestAdapter();
            if (adapter) device = await adapter.requestDevice();
          }
        } catch (err) { device = null; }
        if (!device || dead) { fallback(); return; }
        try {

        var ctx = cvs.getContext('webgpu');
        var format = navigator.gpu.getPreferredCanvasFormat();
        ctx.configure({ device: device, format: format, alphaMode: 'opaque' });
        var depthTex = device.createTexture({
          size: [W * dpr, H * dpr], format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        var depthView = depthTex.createView();

        /* ---- WGSL ---- */
        var ACES = ''
          + 'fn aces(x: vec3f) -> vec3f {\n'
          + '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));\n'
          + '}\n';
        var MESH = ''
          + 'struct G { vp: mat4x4f, eye: vec4f, fog: vec4f };\n'
          + 'struct M { m: mat4x4f, color: vec4f, anim: vec4f, pat: vec4f };\n'
          + '@group(0) @binding(0) var<uniform> g: G;\n'
          + '@group(1) @binding(0) var<uniform> mdl: M;\n'
          + '@group(2) @binding(0) var samp2: sampler;\n'
          + '@group(2) @binding(1) var albedoTex: texture_2d<f32>;\n'
          + 'struct VSI { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) u: f32, @location(3) uv: vec2f };\n'
          + 'struct VSO { @builtin(position) cp: vec4f, @location(0) n: vec3f, @location(1) w: vec3f,\n'
          + '  @location(2) ly: f32, @location(3) u: f32, @location(4) fog: f32, @location(5) uv: vec2f };\n'
          + '@vertex fn vs(in: VSI) -> VSO {\n'
          + '  var p = in.p;\n'
          + '  let t = g.eye.w;\n'
          + '  let bend = sin(t * 5.0 + mdl.anim.y - in.u * 5.0) * mdl.anim.x * (0.12 + in.u * in.u * 0.9);\n'
          + '  p.z += bend;\n'
          + '  let w = mdl.m * vec4f(p, 1.0);\n'
          + '  var o: VSO;\n'
          + '  o.cp = g.vp * w;\n'
          + '  o.n = (mdl.m * vec4f(in.n, 0.0)).xyz;\n'
          + '  o.w = w.xyz;\n'
          + '  o.ly = in.p.y;\n'
          + '  o.u = in.u;\n'
          + '  o.uv = in.uv;\n'
          + '  o.fog = clamp((distance(g.eye.xyz, w.xyz) - 5.0) / 11.0, 0.0, 1.0);\n'
          + '  return o;\n'
          + '}\n'
          + 'fn caust(p: vec2f, t: f32) -> f32 {\n'
          + '  var c = 0.5 + 0.5 * sin(p.x * 2.9 + t * 1.6) * sin(p.y * 2.6 - t * 1.1);\n'
          + '  c += 0.5 + 0.5 * sin(p.x * 4.7 - t * 1.9) * sin(p.y * 3.9 + t * 1.4);\n'
          + '  return pow(c * 0.5, 4.0) * 1.7;\n'
          + '}\n'
          + ACES
          + '@fragment fn fs(in: VSO) -> @location(0) vec4f {\n'
          + '  let texC = textureSample(albedoTex, samp2, in.uv).rgb;\n'
          + '  if (g.fog.w > 0.5) { return vec4f(mdl.color.rgb, 1.0); }\n'
          + '  let t = g.eye.w;\n'
          + '  let n = normalize(in.n);\n'
          + '  let v = normalize(g.eye.xyz - in.w);\n'
          + '  var albedo = texC * mdl.color.rgb;\n'
          + '  if (mdl.anim.w > 0.5) {\n'
          + '    /* 热带鱼重着色：用原贴图明度当细节，体长向双色条纹 */\n'
          + '    let lum = dot(texC, vec3f(0.299, 0.587, 0.114));\n'
          + '    let bands = 0.5 + 0.5 * sin(in.u * mdl.pat.w + in.ly * 5.0 + mdl.anim.y);\n'
          + '    let mask = smoothstep(0.35, 0.65, bands);\n'
          + '    let fishCol = mix(mdl.color.rgb, mdl.pat.rgb, mask);\n'
          + '    albedo = fishCol * (0.35 + 1.1 * lum);\n'
          + '    albedo = mix(albedo, vec3f(0.9, 0.92, 0.88), clamp(-in.ly * 3.0, 0.0, 1.0) * 0.3);\n'
          + '  }\n'
          + '  if (mdl.anim.z > 0.5) {\n'
          + '    albedo = mix(albedo, vec3f(0.85, 0.88, 0.82), clamp(-in.ly * 3.5, 0.0, 1.0) * 0.4);\n'
          + '    albedo *= 0.9 + 0.1 * sin(in.u * 30.0);\n'
          + '  }\n'
          + '  /* 水体吸收：越深红光越少 */\n'
          + '  let depth01 = clamp((2.2 - in.w.y) / 4.4, 0.0, 1.0);\n'
          + '  let absorb = exp(-vec3f(0.9, 0.35, 0.18) * depth01 * 1.1);\n'
          + '  let keyC = vec3f(1.0, 0.97, 0.9) * absorb * 2.4;\n'
          + '  let l = normalize(vec3f(0.25, 0.9, 0.2));\n'
          + '  let h = normalize(l + v);\n'
          + '  let ndl = max(dot(n, l), 0.0);\n'
          + '  let ndh = max(dot(n, h), 0.0);\n'
          + '  /* GGX-lite 高光 */\n'
          + '  let rough = select(0.62, 0.34, mdl.color.w < 0.5);\n'
          + '  let a2 = rough * rough * rough * rough;\n'
          + '  let dgg = a2 / (3.1416 * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));\n'
          + '  let fh = 0.04 + 0.96 * pow(1.0 - max(dot(h, v), 0.0), 5.0);\n'
          + '  let spec = min(dgg * fh, 4.0) * 0.55;\n'
          + '  /* 半球环境辐照（假 GI）+ 沙地反弹 */\n'
          + '  let tup = n.y * 0.5 + 0.5;\n'
          + '  var irr = mix(vec3f(0.045, 0.085, 0.11), vec3f(0.34, 0.52, 0.60), tup * tup) * (1.1 - depth01 * 0.55);\n'
          + '  irr += clamp(-n.y, 0.0, 1.0) * vec3f(0.30, 0.26, 0.18) * (1.0 - depth01 * 0.4) * 0.55;\n'
          + '  /* 菲涅尔加权环境反射 */\n'
          + '  let r = reflect(-v, n);\n'
          + '  let renv = mix(vec3f(0.03, 0.07, 0.10), vec3f(0.45, 0.70, 0.78), clamp(r.y * 0.5 + 0.5, 0.0, 1.0)) * absorb;\n'
          + '  let fresV = pow(1.0 - max(dot(n, v), 0.0), 4.0);\n'
          + '  var c = albedo * (irr + keyC * ndl * 0.85) + keyC * spec * ndl + renv * fresV * 0.6;\n'
          + '  let ca = caust(in.w.xz * 1.3 - in.w.y * 0.35, t) * max(n.y, 0.1);\n'
          + '  c += ca * vec3f(0.4, 0.6, 0.65) * absorb * 0.8;\n'
          + '  c = mix(c, g.fog.rgb, in.fog * 0.85);\n'
          + '  c = aces(c);\n'
          + '  c = pow(c, vec3f(1.0 / 2.2));\n'
          + '  return vec4f(c, 1.0);\n'
          + '}\n';
        var BG = ''
          + 'struct B { ta: vec4f, tb: vec4f };\n'
          + '@group(0) @binding(0) var<uniform> b: B;\n'
          + 'struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };\n'
          + '@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {\n'
          + '  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));\n'
          + '  var o: O;\n'
          + '  o.p = vec4f(q[vi], 0.0, 1.0);\n'
          + '  o.uv = q[vi] * vec2f(0.5, -0.5) + 0.5;\n'
          + '  return o;\n'
          + '}\n'
          + ACES
          + '@fragment fn fs(in: O) -> @location(0) vec4f {\n'
          + '  let t = b.ta.w;\n'
          + '  let y = 1.0 - in.uv.y;\n'
          + '  var c = mix(b.tb.rgb, b.ta.rgb, pow(y, 1.2));\n'
          + '  if (b.tb.w < 0.5) {\n'
          + '    let ca = sin(in.uv.x * 18.0 + t * 0.5) * sin(y * 13.0 - t * 0.7) * 0.5\n'
          + '           + sin(in.uv.x * 9.0 - t * 0.3) * 0.5;\n'
          + '    c += ca * 0.02 * y;\n'
          + '    let b1 = exp(-pow((in.uv.x - 0.32 + sin(t * 0.07) * 0.06) * 7.0, 2.0));\n'
          + '    let b2 = exp(-pow((in.uv.x - 0.66 + sin(t * 0.09 + 2.0) * 0.08) * 9.0, 2.0));\n'
          + '    c += (b1 * 0.14 + b2 * 0.10) * vec3f(0.8, 0.95, 1.0) * pow(y, 1.6);\n'
          + '    let d = in.uv - 0.5;\n'
          + '    c *= 1.0 - dot(d, d) * 0.55;\n'
          + '    c = aces(c);\n'
          + '    c = pow(c, vec3f(1.0 / 2.2));\n'
          + '  }\n'
          + '  return vec4f(c, 1.0);\n'
          + '}\n';
        var SPR = ''
          + 'struct S { vp: mat4x4f, color: vec4f, misc: vec4f };\n'
          + '@group(0) @binding(0) var<uniform> s: S;\n'
          + '@group(0) @binding(1) var<storage, read> pts: array<vec4f>;\n'
          + 'struct O { @builtin(position) p: vec4f, @location(0) uv: vec2f };\n'
          + '@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {\n'
          + '  var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),\n'
          + '    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));\n'
          + '  let pt = pts[vi / 6u];\n'
          + '  let c = q[vi % 6u];\n'
          + '  var clip = s.vp * vec4f(pt.xyz, 1.0);\n'
          + '  clip = vec4f(clip.xy + c * pt.w * s.misc.y * vec2f(1.0, s.misc.x), clip.zw);\n'
          + '  var o: O;\n'
          + '  o.p = clip;\n'
          + '  o.uv = c;\n'
          + '  return o;\n'
          + '}\n'
          + '@fragment fn fs(in: O) -> @location(0) vec4f {\n'
          + '  let r = dot(in.uv, in.uv);\n'
          + '  if (r > 1.0) { discard; }\n'
          + '  let a = (1.0 - smoothstep(0.35, 1.0, r)) * s.color.a;\n'
          + '  return vec4f(s.color.rgb, a);\n'
          + '}\n';

        var meshMod = device.createShaderModule({ code: MESH });
        var bgMod = device.createShaderModule({ code: BG });
        var sprMod = device.createShaderModule({ code: SPR });

        var gBGL = device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
        });
        var mBGL = device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 112 } }]
        });
        var tBGL = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ]
        });
        var meshLayout = device.createPipelineLayout({ bindGroupLayouts: [gBGL, mBGL, tBGL] });
        function meshPipe(topology) {
          return device.createRenderPipeline({
            layout: meshLayout,
            vertex: {
              module: meshMod, entryPoint: 'vs',
              buffers: [{
                arrayStride: 36,
                attributes: [
                  { shaderLocation: 0, offset: 0, format: 'float32x3' },
                  { shaderLocation: 1, offset: 12, format: 'float32x3' },
                  { shaderLocation: 2, offset: 24, format: 'float32' },
                  { shaderLocation: 3, offset: 28, format: 'float32x2' },
                ],
              }],
            },
            fragment: { module: meshMod, entryPoint: 'fs', targets: [{ format: format }] },
            primitive: { topology: topology, cullMode: 'none' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
          });
        }
        var pipeTri = meshPipe('triangle-list');
        var pipeLine = meshPipe('line-list');
        var bgPipe = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: bgMod, entryPoint: 'vs' },
          fragment: { module: bgMod, entryPoint: 'fs', targets: [{ format: format }] },
          primitive: { topology: 'triangle-list' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
        });
        var sprPipe = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: sprMod, entryPoint: 'vs' },
          fragment: {
            module: sprMod, entryPoint: 'fs',
            targets: [{
              format: format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              },
            }],
          },
          primitive: { topology: 'triangle-list' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
        });

        /* ---- 纹理 ---- */
        var sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        var whiteTex = device.createTexture({
          size: [1, 1], format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        device.queue.writeTexture({ texture: whiteTex }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
        function texBG(tex) {
          return device.createBindGroup({
            layout: tBGL,
            entries: [
              { binding: 0, resource: sampler },
              { binding: 1, resource: tex.createView() },
            ]
          });
        }
        var whiteBG = texBG(whiteTex);
        var fishBG = whiteBG;
        try {
          var blob = await (await fetch('/models/fish-albedo.jpg')).blob();
          var bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
          var aTex = device.createTexture({
            size: [bmp.width, bmp.height], format: 'rgba8unorm-srgb',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
          });
          device.queue.copyExternalImageToTexture({ source: bmp }, { texture: aTex }, [bmp.width, bmp.height]);
          fishBG = texBG(aTex);
        } catch (err) { fishBG = whiteBG; }

        /* ---- 几何 ---- */
        function mesh(pos, nrm, us, uvs, idx) {
          var n = us.length, inter = new Float32Array(n * 9);
          for (var i = 0; i < n; i++) {
            inter[i * 9] = pos[i * 3]; inter[i * 9 + 1] = pos[i * 3 + 1]; inter[i * 9 + 2] = pos[i * 3 + 2];
            inter[i * 9 + 3] = nrm[i * 3]; inter[i * 9 + 4] = nrm[i * 3 + 1]; inter[i * 9 + 5] = nrm[i * 3 + 2];
            inter[i * 9 + 6] = us[i];
            inter[i * 9 + 7] = uvs ? uvs[i * 2] : 0; inter[i * 9 + 8] = uvs ? uvs[i * 2 + 1] : 0;
          }
          var edges = {}, lines = [];
          for (var e = 0; e < idx.length; e += 3) {
            var tri = [[idx[e], idx[e + 1]], [idx[e + 1], idx[e + 2]], [idx[e + 2], idx[e]]];
            for (var k = 0; k < 3; k++) {
              var key = Math.min(tri[k][0], tri[k][1]) + '_' + Math.max(tri[k][0], tri[k][1]);
              if (!edges[key]) { edges[key] = 1; lines.push(tri[k][0], tri[k][1]); }
            }
          }
          function ib(arr) {
            var padded = arr.length % 2 ? Array.prototype.slice.call(arr).concat([0]) : arr;
            var b = device.createBuffer({ size: padded.length * 2, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(b, 0, new Uint16Array(padded));
            return b;
          }
          var vb = device.createBuffer({ size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(vb, 0, inter);
          return { vb: vb, ti: ib(idx), li: ib(lines), nT: idx.length, nL: lines.length, bg2: whiteBG };
        }
        function norm3(x, y, z) { var l = Math.sqrt(x * x + y * y + z * z) || 1; return [x / l, y / l, z / l]; }
        function buildFishProc() {
          var SEG = 12, RING = 10, pos = [], nrm = [], us = [], idx = [];
          for (var i = 0; i <= SEG; i++) {
            var u = i / SEG, x = 0.55 - u * 1.1;
            var r = Math.sin(Math.min(u * 1.25, 1) * Math.PI);
            var ry = 0.02 + 0.20 * r, rz = 0.02 + 0.085 * r;
            for (var j2 = 0; j2 < RING; j2++) {
              var a = j2 / RING * Math.PI * 2, cy = Math.cos(a), sz = Math.sin(a);
              pos.push(x, cy * ry, sz * rz);
              var nn = norm3(0, cy / Math.max(ry, 0.02), sz / Math.max(rz, 0.02));
              nrm.push(nn[0], nn[1], nn[2]);
              us.push(u);
            }
          }
          for (var i2 = 0; i2 < SEG; i2++) for (var j3 = 0; j3 < RING; j3++) {
            var a0 = i2 * RING + j3, b0 = i2 * RING + (j3 + 1) % RING;
            idx.push(a0, a0 + RING, b0, b0, a0 + RING, b0 + RING);
          }
          var base = pos.length / 3;
          [[-0.55, 0, 0, 1.0], [-0.88, 0.24, 0, 1.35], [-0.88, -0.24, 0, 1.35], [-0.72, 0, 0, 1.15]].forEach(function (t2) {
            pos.push(t2[0], t2[1], t2[2]); nrm.push(0, 0, 1); us.push(t2[3]);
          });
          idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
          return mesh(pos, nrm, us, null, idx);
        }
        async function loadFishGLB() {
          var buf = await (await fetch('/models/fish.glb')).arrayBuffer();
          var dv = new DataView(buf);
          if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('bad glb');
          var total = dv.getUint32(8, true), off = 12, json = null, bin = null;
          while (off < total) {
            var clen = dv.getUint32(off, true), ctype = dv.getUint32(off + 4, true);
            var chunk = buf.slice(off + 8, off + 8 + clen);
            if (ctype === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(chunk));
            else if (ctype === 0x004E4942) bin = chunk;
            off += 8 + clen;
          }
          function acc(ai) {
            var a = json.accessors[ai], bv = json.bufferViews[a.bufferView];
            var comp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
            var Ctor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
            return new Ctor(bin, (bv.byteOffset || 0) + (a.byteOffset || 0), a.count * comp);
          }
          var prim = json.meshes[0].primitives[0];
          var p0 = acc(prim.attributes.POSITION);
          var n0 = acc(prim.attributes.NORMAL);
          var uv0 = acc(prim.attributes.TEXCOORD_0);
          var idx0 = acc(prim.indices);
          /* 重定向：体长轴(z)→x，居中，统一到长度 1.15 */
          var nV = p0.length / 3;
          var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
          for (var i = 0; i < nV; i++) for (var k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], p0[i * 3 + k]);
            mx[k] = Math.max(mx[k], p0[i * 3 + k]);
          }
          var HEAD = -1;
          var cx = (mn[0] + mx[0]) / 2, cyc = (mn[1] + mx[1]) / 2, cz = (mn[2] + mx[2]) / 2;
          var scale = 1.15 / Math.max(mx[2] - mn[2], 0.001);
          var pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3), us = new Float32Array(nV);
          for (var i2 = 0; i2 < nV; i2++) {
            var ox = p0[i2 * 3] - cx, oy = p0[i2 * 3 + 1] - cyc, oz = p0[i2 * 3 + 2] - cz;
            pos[i2 * 3] = oz * scale * HEAD;
            pos[i2 * 3 + 1] = oy * scale;
            pos[i2 * 3 + 2] = ox * scale * HEAD;
            nrm[i2 * 3] = n0[i2 * 3 + 2] * HEAD;
            nrm[i2 * 3 + 1] = n0[i2 * 3 + 1];
            nrm[i2 * 3 + 2] = n0[i2 * 3] * HEAD;
            us[i2] = (0.575 - pos[i2 * 3]) / 1.15;
          }
          var m = mesh(pos, nrm, us, uv0, Array.prototype.slice.call(idx0));
          m.bg2 = fishBG;
          return m;
        }
        var fishMesh = null;
        try { fishMesh = await loadFishGLB(); } catch (err) { fishMesh = null; }
        var procFish = !fishMesh;
        if (!fishMesh) fishMesh = buildFishProc();
        if (dead) return;

        function buildRibbon() {
          var SEG = 9, w = 0.09, pos = [], nrm = [], us = [], idx = [];
          for (var i = 0; i <= SEG; i++) {
            var u = i / SEG;
            pos.push(-w * (1 - u * 0.6), u, 0, w * (1 - u * 0.6), u, 0);
            nrm.push(0, 0, 1, 0, 0, 1);
            us.push(u, u);
          }
          for (var s2 = 0; s2 < SEG; s2++) {
            var o = s2 * 2;
            idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
          }
          return mesh(pos, nrm, us, null, idx);
        }
        var asp = W / H;
        var TANK = { x: Math.max(3.4, 2.6 * asp), y: 2.2, z: 2.1 };
        function buildFloor() {
          var tx = TANK.x + 1.6, tz = TANK.z + 1.3;
          return mesh(
            [-tx, 0, -tz, tx, 0, -tz, tx, 0, tz, -tx, 0, tz],
            [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
            [0, 0, 0, 0], null, [0, 2, 1, 0, 3, 2]);
        }
        var weedMesh = buildRibbon(), floorMesh = buildFloor();

        /* ---- uniform / 场景 ---- */
        var gUB = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var gBG = device.createBindGroup({ layout: gBGL, entries: [{ binding: 0, resource: { buffer: gUB } }] });
        var SLOTS = 1 + 9 + 14;
        var mUB = device.createBuffer({ size: SLOTS * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var mBG = device.createBindGroup({
          layout: mBGL,
          entries: [{ binding: 0, resource: { buffer: mUB, size: 112 } }]
        });
        var mData = new Float32Array(SLOTS * 64);
        var bgUB = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        var bgBG = device.createBindGroup({ layout: bgPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bgUB } }] });
        function sprSet(maxN) {
          var ub = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          var sb = device.createBuffer({ size: maxN * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
          return {
            ub: ub, sb: sb, max: maxN,
            bg: device.createBindGroup({
              layout: sprPipe.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: ub } },
                { binding: 1, resource: { buffer: sb } },
              ],
            }),
          };
        }
        var sprSh = sprSet(16), sprMote = sprSet(80), sprFood = sprSet(20), sprBub = sprSet(80);
        var sprU = new Float32Array(24);

        var palette = [
          cssRGB('--c-render', '#d96a60'), cssRGB('--c-tool', '#cfa23a'),
          cssRGB('--c-char', '#6b99d8'), cssRGB('--c-ai', '#9d86d9'),
          cssRGB('--c-life', '#cf7fa0'), cssRGB('--accent', '#ff8a1e')
        ];
        /* 热带配色：[主色, 副色, 条纹频率] */
        var TROP = [
          [[1.0, 0.42, 0.05], [0.98, 0.96, 0.9], 9.0],
          [[0.05, 0.35, 1.0], [1.0, 0.85, 0.1], 5.0],
          [[1.0, 0.83, 0.0], [1.0, 0.55, 0.0], 4.0],
          [[0.62, 0.1, 0.9], [0.1, 0.9, 0.9], 7.0],
          [[0.95, 0.12, 0.15], [0.98, 0.95, 0.9], 11.0],
          [[0.1, 0.85, 0.4], [0.05, 0.3, 0.8], 6.0]
        ];
        var fishes = [];
        for (var fi = 0; fi < 14; fi++) {
          var isTrop = fi >= 3;
          var tp = isTrop ? TROP[(fi - 3) % TROP.length] : null;
          fishes.push({
            p: [(Math.random() * 2 - 1) * TANK.x * 0.7, (Math.random() * 2 - 1) * TANK.y * 0.6, (Math.random() * 2 - 1) * TANK.z * 0.6],
            yaw: Math.random() * 6.28, pitch: 0,
            spd: isTrop ? 0.7 + Math.random() * 0.7 : 0.55 + Math.random() * 0.4,
            s: isTrop ? 0.34 + Math.random() * 0.3 : 0.75 + Math.random() * 0.35,
            c: isTrop ? lin3(tp[0]) : lin3([0.96, 0.96, 0.94]),
            patC: isTrop ? lin3(tp[1]) : null,
            patF: isTrop ? tp[2] : 0,
            trop: isTrop ? 1 : 0,
            ph: Math.random() * 6.28, burst: 0
          });
        }
        var weeds = [];
        for (var wi = 0; wi < 9; wi++) {
          weeds.push({
            x: (Math.random() * 2 - 1) * TANK.x * 0.9,
            z: -TANK.z * 0.3 - Math.random() * TANK.z * 0.6,
            h: 1.1 + Math.random() * 1.6, ph: Math.random() * 6.28
          });
        }
        var motes = [];
        for (var mo = 0; mo < 70; mo++) {
          motes.push({
            p: [(Math.random() * 2 - 1) * TANK.x, (Math.random() * 2 - 1) * TANK.y, (Math.random() * 2 - 1) * TANK.z],
            ph: Math.random() * 6.28, s: 0.012 + Math.random() * 0.018
          });
        }
        var foods = [], bubbles = [];
        var camYaw = 0, camPitch = 0.10, camDist = 8.6, FOV = 0.8;
        var target = [0, 0.35, 0];
        var lastEye = [0, 0.35, 8.6];
        function resetCam() { camYaw = 0; camPitch = 0.10; camDist = 8.6; target = [0, 0.35, 0]; }
        function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
        function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
        function vCross(a, b) {
          return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        }
        function vNorm(a) {
          var l = Math.hypot(a[0], a[1], a[2]) || 1;
          return [a[0] / l, a[1] / l, a[2] / l];
        }
        var projM = mPerspG(FOV, asp, 0.5, 40);
        var viewM = null, vpM = null;
        var wire = false, wireCol = [0.32, 0.78, 0.9];
        var water = null;
        function refreshTheme() {
          wire = document.body.classList.contains('vm-wire');
          wireCol = cssRGB('--wire', '#52c8e6');
          var bgc = cssRGB('--bg', '#101418');
          var lum = bgc[0] * 0.3 + bgc[1] * 0.6 + bgc[2] * 0.1;
          water = lum < 0.5
            ? { top: lin3([0.16, 0.40, 0.50]), bot: lin3([0.02, 0.09, 0.14]), fog: lin3([0.05, 0.15, 0.22]),
                floor: lin3([0.55, 0.47, 0.34]), weed: lin3([0.18, 0.45, 0.26]) }
            : { top: lin3([0.60, 0.85, 0.94]), bot: lin3([0.22, 0.48, 0.62]), fog: lin3([0.40, 0.64, 0.75]),
                floor: lin3([0.76, 0.68, 0.52]), weed: lin3([0.24, 0.55, 0.32]) };
        }
        refreshTheme();
        function blendAngle(a, b, k) {
          var d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
          return a + d * Math.min(1, k);
        }

        /* ---- 交互：自由视口 + 点按撒食/摸鱼 ---- */
        function touch(i) {
          touched++;
          try { localStorage.setItem('yzzn-fish', String(touched)); } catch (err) {}
          hud();
          var f = fishes[i];
          f.burst = 1.4;
          f.yaw += Math.PI * (0.7 + Math.random() * 0.6);
          for (var b = 0; b < 5; b++) {
            bubbles.push({ p: [f.p[0], f.p[1], f.p[2]], v: 0.7 + Math.random() * 0.7, s: 0.03 + Math.random() * 0.04, ph: Math.random() * 6 });
          }
        }
        function tapAt(e) {
          var r0 = cvs.getBoundingClientRect();
          var nx = ((e.clientX - r0.left) / r0.width) * 2 - 1;
          var ny = -(((e.clientY - r0.top) / r0.height) * 2 - 1);
          if (vpM) {
            var best = -1, bd = 1e9;
            for (var i = 0; i < fishes.length; i++) {
              var f = fishes[i];
              var x = f.p[0], y = f.p[1], z = f.p[2];
              var cw = vpM[3] * x + vpM[7] * y + vpM[11] * z + vpM[15];
              if (cw <= 0.1) continue;
              var cx = (vpM[0] * x + vpM[4] * y + vpM[8] * z + vpM[12]) / cw;
              var cy = (vpM[1] * x + vpM[5] * y + vpM[9] * z + vpM[13]) / cw;
              var dx = cx - nx, dy = cy - ny;
              var rr = 1.1 * f.s / cw;
              if (dx * dx + dy * dy < rr * rr && cw < bd) { bd = cw; best = i; }
            }
            if (best >= 0) { touch(best); return; }
          }
          /* 相机射线与过 target 的视垂面求交 → 任意视角撒食都落点准确 */
          var fwd = vNorm(vSub(target, lastEye));
          var rgt = vNorm(vCross(fwd, [0, 1, 0]));
          var up2 = vCross(rgt, fwd);
          var th = Math.tan(FOV / 2);
          var dir = vNorm([
            fwd[0] + nx * th * asp * rgt[0] + ny * th * up2[0],
            fwd[1] + nx * th * asp * rgt[1] + ny * th * up2[1],
            fwd[2] + nx * th * asp * rgt[2] + ny * th * up2[2]
          ]);
          var tt = vDot(vSub(target, lastEye), fwd) / Math.max(vDot(dir, fwd), 0.05);
          var pt = [lastEye[0] + dir[0] * tt, lastEye[1] + dir[1] * tt, lastEye[2] + dir[2] * tt];
          pt[0] = Math.max(-TANK.x * 0.9, Math.min(TANK.x * 0.9, pt[0]));
          pt[1] = Math.max(-TANK.y * 0.6, Math.min(TANK.y - 0.15, pt[1]));
          pt[2] = Math.max(-TANK.z * 0.9, Math.min(TANK.z * 0.9, pt[2]));
          foods.push({ p: pt, vy: -0.55, life: 25 });
          if (foods.length > 14) foods.shift();
        }
        var drag = null, movedPx = 0;
        function onDown(e) {
          if (e.button > 2) return;
          drag = e.button;
          movedPx = 0;
          if (cvs.setPointerCapture) { try { cvs.setPointerCapture(e.pointerId); } catch (err) {} }
        }
        function onPMove(e) {
          if (drag === null) return;
          var dx = e.movementX || 0, dy = e.movementY || 0;
          movedPx += Math.abs(dx) + Math.abs(dy);
          if (drag === 0) {
            camYaw -= dx * 0.005;
            camPitch = Math.max(-1.2, Math.min(1.35, camPitch + dy * 0.005));
          } else {
            var fwd = vNorm(vSub(target, lastEye));
            var rgt = vNorm(vCross(fwd, [0, 1, 0]));
            var up2 = vCross(rgt, fwd);
            var k = camDist * 0.0016;
            target = [
              Math.max(-TANK.x, Math.min(TANK.x, target[0] - rgt[0] * dx * k + up2[0] * dy * k)),
              Math.max(-TANK.y, Math.min(TANK.y + 1, target[1] - rgt[1] * dx * k + up2[1] * dy * k)),
              Math.max(-TANK.z, Math.min(TANK.z, target[2] - rgt[2] * dx * k + up2[2] * dy * k))
            ];
          }
        }
        function onUp(e) {
          if (drag === 0 && movedPx < 6) tapAt(e);
          drag = null;
        }
        function onWheel(e) {
          e.preventDefault();
          camDist = Math.max(3.2, Math.min(18, camDist * Math.exp(e.deltaY * 0.0012)));
        }
        function onDbl() { resetCam(); }
        function onCtx(e) { e.preventDefault(); }
        cvs.addEventListener('pointerdown', onDown);
        cvs.addEventListener('pointermove', onPMove);
        cvs.addEventListener('pointerup', onUp);
        cvs.addEventListener('wheel', onWheel, { passive: false });
        cvs.addEventListener('dblclick', onDbl);
        cvs.addEventListener('contextmenu', onCtx);

        /* ---- 帧循环 ---- */
        function slot(i, model, color, matType, amp, ph, proc, trop, patC, patF) {
          var o = i * 64;
          mData.set(model, o);
          mData[o + 16] = color[0]; mData[o + 17] = color[1]; mData[o + 18] = color[2]; mData[o + 19] = matType;
          mData[o + 20] = amp; mData[o + 21] = ph; mData[o + 22] = proc || 0; mData[o + 23] = trop || 0;
          if (patC) { mData[o + 24] = patC[0]; mData[o + 25] = patC[1]; mData[o + 26] = patC[2]; mData[o + 27] = patF || 6; }
        }
        function mModel(x, y, z, yaw, pitch, s) {
          var cyw = Math.cos(-yaw), syw = Math.sin(-yaw);
          var cp = Math.cos(pitch), sp = Math.sin(pitch);
          return new Float32Array([
            cyw * cp * s, sp * s, -syw * cp * s, 0,
            -cyw * sp * s, cp * s, syw * sp * s, 0,
            syw * s, 0, cyw * s, 0,
            x, y, z, 1
          ]);
        }
        var prev = 0, frame = 0;
        function loop(ts) {
          if (dead || !cvs.isConnected) return;
          raf = requestAnimationFrame(loop);
          var dt = Math.min((ts - prev) / 1000, 0.05);
          prev = ts;
          var t = ts / 1000;
          if (++frame % 90 === 0) refreshTheme();

          var cp0 = Math.cos(camPitch), sp0 = Math.sin(camPitch);
          var eye = [
            target[0] + Math.sin(camYaw) * cp0 * camDist,
            target[1] + sp0 * camDist,
            target[2] + Math.cos(camYaw) * cp0 * camDist
          ];
          lastEye = eye;
          viewM = mLookG(eye, target);
          vpM = mMulG(projM, viewM);

          for (var i = 0; i < fishes.length; i++) {
            var f = fishes[i];
            f.burst = Math.max(0, f.burst - dt);
            var sp2 = f.spd * (1 + f.burst * 2.6);
            var tgt = null, td = 1e9;
            for (var fo = 0; fo < foods.length; fo++) {
              var fd = foods[fo];
              var ddx = fd.p[0] - f.p[0], ddy = fd.p[1] - f.p[1], ddz = fd.p[2] - f.p[2];
              var d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d2 < td) { td = d2; tgt = fd; }
            }
            if (tgt && f.burst <= 0) {
              f.yaw = blendAngle(f.yaw, Math.atan2(tgt.p[2] - f.p[2], tgt.p[0] - f.p[0]), 3 * dt);
              var horiz = Math.sqrt(Math.pow(tgt.p[0] - f.p[0], 2) + Math.pow(tgt.p[2] - f.p[2], 2));
              f.pitch += (Math.atan2(tgt.p[1] - f.p[1], horiz + 0.001) - f.pitch) * 3 * dt;
              if (td < 0.12) {
                foods.splice(foods.indexOf(tgt), 1);
                f.s = Math.min(f.s + 0.03, 1.4);
                bubbles.push({ p: [f.p[0], f.p[1], f.p[2]], v: 0.8, s: 0.04, ph: 0 });
              }
            } else {
              f.yaw += (Math.random() - 0.5) * 1.6 * dt;
              f.pitch += ((Math.random() - 0.5) * 0.5 - f.pitch * 0.4) * dt;
            }
            var mgn = 0.82;
            if (Math.abs(f.p[0]) > TANK.x * mgn || Math.abs(f.p[2]) > TANK.z * mgn) {
              f.yaw = blendAngle(f.yaw, Math.atan2(-f.p[2], -f.p[0]), 2.2 * dt);
            }
            if (Math.abs(f.p[1]) > TANK.y * mgn) {
              f.pitch += (-Math.sign(f.p[1]) * 0.5 - f.pitch) * 3 * dt;
            }
            f.pitch = Math.max(-0.6, Math.min(0.6, f.pitch));
            var cp2 = Math.cos(f.pitch);
            f.p[0] += Math.cos(f.yaw) * cp2 * sp2 * dt;
            f.p[1] += Math.sin(f.pitch) * sp2 * dt;
            f.p[2] += Math.sin(f.yaw) * cp2 * sp2 * dt;
            f.p[0] = Math.max(-TANK.x, Math.min(TANK.x, f.p[0]));
            f.p[1] = Math.max(-TANK.y + 0.15, Math.min(TANK.y, f.p[1]));
            f.p[2] = Math.max(-TANK.z, Math.min(TANK.z, f.p[2]));
          }
          for (var fo2 = foods.length - 1; fo2 >= 0; fo2--) {
            var fd2 = foods[fo2];
            fd2.life -= dt;
            if (fd2.p[1] > -TANK.y + 0.1) fd2.p[1] += fd2.vy * dt;
            if (fd2.life <= 0) foods.splice(fo2, 1);
          }
          if (Math.random() < dt * 0.7) {
            bubbles.push({ p: [(Math.random() * 2 - 1) * TANK.x * 0.8, -TANK.y + 0.2, (Math.random() * 2 - 1) * TANK.z * 0.7], v: 0.5 + Math.random() * 0.6, s: 0.02 + Math.random() * 0.04, ph: Math.random() * 6 });
          }
          for (var bb = bubbles.length - 1; bb >= 0; bb--) {
            var bub = bubbles[bb];
            bub.p[1] += bub.v * dt;
            bub.p[0] += Math.sin(t * 3 + bub.ph) * 0.15 * dt;
            if (bub.p[1] > TANK.y + 0.2) bubbles.splice(bb, 1);
          }
          for (var mo2 = 0; mo2 < motes.length; mo2++) {
            var mt = motes[mo2];
            mt.p[0] += Math.sin(t * 0.3 + mt.ph) * 0.03 * dt;
            mt.p[1] += Math.cos(t * 0.2 + mt.ph * 1.7) * 0.04 * dt + 0.01 * dt;
            if (mt.p[1] > TANK.y) mt.p[1] = -TANK.y + 0.2;
          }

          var gArr = new Float32Array(24);
          gArr.set(vpM, 0);
          gArr[16] = eye[0]; gArr[17] = eye[1]; gArr[18] = eye[2]; gArr[19] = t;
          gArr[20] = water.fog[0]; gArr[21] = water.fog[1]; gArr[22] = water.fog[2]; gArr[23] = wire ? 1 : 0;
          device.queue.writeBuffer(gUB, 0, gArr);

          slot(0, mModel(0, -TANK.y, 0, 0, 0, 1), wire ? wireCol : water.floor, 1, 0, 0, 0, 0, null, 0);
          for (var wv = 0; wv < weeds.length; wv++) {
            var wd = weeds[wv];
            slot(1 + wv, mModel(wd.x, -TANK.y, wd.z, -wd.ph, 0, wd.h),
              wire ? wireCol : water.weed, 2, 0.35, wd.ph + t * 0.15, 0, 0, null, 0);
          }
          for (var df = 0; df < fishes.length; df++) {
            var ff = fishes[df];
            slot(10 + df, mModel(ff.p[0], ff.p[1], ff.p[2], ff.yaw, ff.pitch, ff.s),
              wire ? wireCol : ff.c, 0, 0.10 + ff.burst * 0.10, ff.ph, procFish ? 1 : 0,
              wire ? 0 : ff.trop, ff.patC, ff.patF);
          }
          device.queue.writeBuffer(mUB, 0, mData);

          var bgArr = new Float32Array(8);
          var topC = wire ? [0.02, 0.03, 0.04] : water.top;
          var botC = wire ? [0.02, 0.03, 0.04] : water.bot;
          bgArr[0] = topC[0]; bgArr[1] = topC[1]; bgArr[2] = topC[2]; bgArr[3] = t;
          bgArr[4] = botC[0]; bgArr[5] = botC[1]; bgArr[6] = botC[2]; bgArr[7] = wire ? 1 : 0;
          device.queue.writeBuffer(bgUB, 0, bgArr);

          function fillSpr(set, list, color) {
            var n = Math.min(list.length / 4, set.max);
            if (n > 0) device.queue.writeBuffer(set.sb, 0, new Float32Array(list.slice(0, n * 4)));
            sprU.set(vpM, 0);
            sprU[16] = color[0]; sprU[17] = color[1]; sprU[18] = color[2]; sprU[19] = color[3];
            sprU[20] = asp; sprU[21] = 1.0;
            device.queue.writeBuffer(set.ub, 0, sprU);
            return n;
          }
          var shL = [];
          for (var sf = 0; sf < fishes.length; sf++) {
            var fsh = fishes[sf];
            var hgt2 = (fsh.p[1] + TANK.y) / (TANK.y * 2);
            shL.push(fsh.p[0], -TANK.y + 0.03, fsh.p[2], fsh.s * (0.5 - hgt2 * 0.25));
          }
          var moL = [];
          for (var m3 = 0; m3 < motes.length; m3++) moL.push(motes[m3].p[0], motes[m3].p[1], motes[m3].p[2], motes[m3].s);
          var foL = [];
          for (var f3 = 0; f3 < foods.length; f3++) foL.push(foods[f3].p[0], foods[f3].p[1], foods[f3].p[2], 0.05);
          var buL = [];
          for (var b3 = 0; b3 < bubbles.length; b3++) buL.push(bubbles[b3].p[0], bubbles[b3].p[1], bubbles[b3].p[2], bubbles[b3].s);
          var nSh = fillSpr(sprSh, shL, wire ? [0, 0, 0, 0] : [0.0, 0.02, 0.03, 0.32]);
          var nMo = fillSpr(sprMote, moL, wire ? [wireCol[0], wireCol[1], wireCol[2], 0.15] : [0.85, 0.92, 0.95, 0.10]);
          var nFo = fillSpr(sprFood, foL, wire ? [wireCol[0], wireCol[1], wireCol[2], 0.9] : [0.92, 0.82, 0.55, 0.95]);
          var nBu = fillSpr(sprBub, buL, wire ? [wireCol[0], wireCol[1], wireCol[2], 0.5] : [0.85, 0.95, 1.0, 0.4]);

          var enc = device.createCommandEncoder();
          var rp = enc.beginRenderPass({
            colorAttachments: [{
              view: ctx.getCurrentTexture().createView(),
              loadOp: 'clear', clearValue: { r: botC[0], g: botC[1], b: botC[2], a: 1 }, storeOp: 'store',
            }],
            depthStencilAttachment: {
              view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
            },
          });
          rp.setPipeline(bgPipe);
          rp.setBindGroup(0, bgBG);
          rp.draw(3);

          rp.setPipeline(wire ? pipeLine : pipeTri);
          rp.setBindGroup(0, gBG);
          function drawSlot(m2, i3) {
            rp.setBindGroup(1, mBG, [i3 * 256]);
            rp.setBindGroup(2, m2.bg2);
            rp.setVertexBuffer(0, m2.vb);
            if (wire) { rp.setIndexBuffer(m2.li, 'uint16'); rp.drawIndexed(m2.nL); }
            else { rp.setIndexBuffer(m2.ti, 'uint16'); rp.drawIndexed(m2.nT); }
          }
          drawSlot(floorMesh, 0);
          for (var w2 = 0; w2 < weeds.length; w2++) drawSlot(weedMesh, 1 + w2);
          for (var f2 = 0; f2 < fishes.length; f2++) drawSlot(fishMesh, 10 + f2);

          rp.setPipeline(sprPipe);
          if (nSh) { rp.setBindGroup(0, sprSh.bg); rp.draw(nSh * 6); }
          if (nMo) { rp.setBindGroup(0, sprMote.bg); rp.draw(nMo * 6); }
          if (nFo) { rp.setBindGroup(0, sprFood.bg); rp.draw(nFo * 6); }
          if (nBu) { rp.setBindGroup(0, sprBub.bg); rp.draw(nBu * 6); }
          rp.end();
          device.queue.submit([enc.finish()]);
        }
        raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });

        innerCleanup = function () {
          if (raf) cancelAnimationFrame(raf);
          cvs.removeEventListener('pointerdown', onDown);
          cvs.removeEventListener('pointermove', onPMove);
          cvs.removeEventListener('pointerup', onUp);
          cvs.removeEventListener('wheel', onWheel);
          cvs.removeEventListener('dblclick', onDbl);
          cvs.removeEventListener('contextmenu', onCtx);
          try { depthTex.destroy(); } catch (err) {}
        };
        } catch (err) { fallback(); }
      })();

      return function cleanup() {
        dead = true;
        if (innerCleanup) innerCleanup();
      };
    }

    GM.idle = {
      bp: 'Idle', zh: '摸鱼 · 3D 鱼缸',
      start: function (stage) {
        hudSuspend = true;
        return fishTankGPU(stage);
      }
    };

    /* ---------- 游戏厅 · 通用工具 ---------- */
    function hiGet(k) { try { return parseInt(localStorage.getItem(k) || '0', 10); } catch (err) { return 0; } }
    function hiSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (err) {} }
    function pal() {
      var cs = getComputedStyle(document.body), o = {};
      ['--ink', '--ink2', '--line', '--surface', '--surface2', '--accent', '--play',
       '--c-render', '--c-engine', '--c-char', '--c-tool', '--c-ai', '--c-life'].forEach(function (k) {
        o[k.slice(2)] = cs.getPropertyValue(k).trim();
      });
      return o;
    }
    function arcUI(stage, w, h, hint) {
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:' + w + 'px; max-width:94vw; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span data-a="s"></span><span data-a="m"></span><span data-a="h"></span>' +
          '</div>' +
          '<canvas></canvas>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">' + hint + '</div>' +
          '<div class="mono" data-a="msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var cvs = stage.querySelector('canvas');
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = w * dpr; cvs.height = h * dpr;
      cvs.style.cssText = 'width:' + w + 'px; height:' + h + 'px; max-width:94vw; border:1px solid var(--line); background:var(--surface);';
      var g = cvs.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return {
        cvs: cvs, g: g,
        s: stage.querySelector('[data-a="s"]'),
        m: stage.querySelector('[data-a="m"]'),
        hb: stage.querySelector('[data-a="h"]'),
        msg: stage.querySelector('[data-a="msg"]')
      };
    }

    /* ---------- 街机 · 贪吃蛇 ---------- */
    function snakeGame(stage) {
      var N = 20, px = Math.min(400, window.innerWidth - 60);
      var cell = Math.floor(px / N); px = cell * N;
      var u = arcUI(stage, px, px, '方向键 / WASD 移动 · 吃方块变长 · 撞墙撞自己结束 · 空格重开');
      var C = pal(), K = 'yzzn-arc-snake', hi = hiGet(K);
      var snake, dir, ndir, food, score, dead, iv = null;
      function place() {
        do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; }
        while (snake.some(function (s) { return s[0] === food[0] && s[1] === food[1]; }));
      }
      function draw() {
        var g = u.g;
        g.clearRect(0, 0, px, px);
        g.fillStyle = C['c-tool'];
        g.fillRect(food[0] * cell + 2, food[1] * cell + 2, cell - 4, cell - 4);
        snake.forEach(function (s, i) {
          g.fillStyle = i ? C.play : C.accent;
          g.globalAlpha = i ? 0.8 : 1;
          g.fillRect(s[0] * cell + 1, s[1] * cell + 1, cell - 2, cell - 2);
        });
        g.globalAlpha = 1;
        u.s.textContent = 'SCORE ' + score;
        u.hb.textContent = 'HI ' + hi;
      }
      function step() {
        dir = ndir;
        var h = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
        if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N ||
            snake.some(function (s) { return s[0] === h[0] && s[1] === h[1]; })) {
          dead = true;
          clearInterval(iv);
          if (score > hi) { hi = score; hiSet(K, hi); }
          u.msg.textContent = '寄了！长度 ' + snake.length + ' — 空格重开';
          return;
        }
        snake.unshift(h);
        if (h[0] === food[0] && h[1] === food[1]) {
          score++;
          place();
          clearInterval(iv);
          iv = setInterval(step, Math.max(60, 110 - score * 2));
        } else snake.pop();
        draw();
      }
      function reset() {
        snake = [[10, 10], [9, 10], [8, 10]];
        dir = [1, 0]; ndir = dir; score = 0; dead = false;
        place();
        u.msg.textContent = '';
        clearInterval(iv);
        iv = setInterval(step, 110);
        draw();
      }
      function key(e) {
        var k = e.key.toLowerCase();
        var m = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
        if (m[k]) {
          e.preventDefault();
          if (m[k][0] !== -dir[0] || m[k][1] !== -dir[1]) ndir = m[k];
        } else if (k === ' ' && dead) { e.preventDefault(); reset(); }
      }
      document.addEventListener('keydown', key);
      reset();
      return function () { clearInterval(iv); document.removeEventListener('keydown', key); };
    }

    /* ---------- 街机 · 俄罗斯方块 ---------- */
    function tetrisGame(stage) {
      var COLS = 10, ROWS = 20;
      var cell = Math.max(14, Math.min(22, Math.floor((window.innerHeight - 330) / ROWS)));
      var W = COLS * cell, H = ROWS * cell;
      var u = arcUI(stage, W, H, '←→ 移动 · ↑/W 旋转 · ↓ 软降 · 空格硬降 · R 重开');
      var C = pal(), K = 'yzzn-arc-tetris', hi = hiGet(K);
      var SHAPES = [[[1, 1, 1, 1]], [[1, 1], [1, 1]], [[0, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]], [[1, 1, 0], [0, 1, 1]], [[0, 1, 1], [1, 1, 0]]];
      var COLK = ['c-render', 'c-tool', 'c-ai', 'c-engine', 'c-char', 'c-life', 'accent'];
      var grid, cur, cx, cy, ci, score, lines, over, iv = null, dropMs;
      function hitTest(p, x, y) {
        for (var r = 0; r < p.length; r++) for (var c = 0; c < p[r].length; c++) {
          if (!p[r][c]) continue;
          var X = x + c, Y = y + r;
          if (X < 0 || X >= COLS || Y >= ROWS) return true;
          if (Y >= 0 && grid[Y][X]) return true;
        }
        return false;
      }
      function newPiece() {
        ci = Math.floor(Math.random() * 7);
        cur = SHAPES[ci].map(function (r) { return r.slice(); });
        cx = Math.floor((COLS - cur[0].length) / 2); cy = 0;
        if (hitTest(cur, cx, cy)) {
          over = true;
          clearInterval(iv);
          if (score > hi) { hi = score; hiSet(K, hi); }
          u.msg.textContent = '到顶了！' + score + ' 分 — R 重开';
        }
      }
      function draw() {
        var g = u.g;
        g.clearRect(0, 0, W, H);
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
          if (grid[r][c]) {
            g.fillStyle = C[COLK[grid[r][c] - 1]];
            g.fillRect(c * cell + 1, r * cell + 1, cell - 2, cell - 2);
          }
        }
        if (!over) {
          g.fillStyle = C[COLK[ci]];
          cur.forEach(function (row, r) {
            row.forEach(function (v, c) {
              if (v && cy + r >= 0) g.fillRect((cx + c) * cell + 1, (cy + r) * cell + 1, cell - 2, cell - 2);
            });
          });
        }
        u.s.textContent = 'SCORE ' + score;
        u.m.textContent = 'LINES ' + lines;
        u.hb.textContent = 'HI ' + hi;
      }
      function merge() {
        cur.forEach(function (row, r) {
          row.forEach(function (v, c) { if (v && cy + r >= 0) grid[cy + r][cx + c] = ci + 1; });
        });
        var cleared = 0;
        for (var r = ROWS - 1; r >= 0; r--) {
          if (grid[r].every(function (v) { return v; })) {
            grid.splice(r, 1);
            grid.unshift(new Array(COLS).fill(0));
            cleared++; r++;
          }
        }
        if (cleared) {
          lines += cleared;
          score += [0, 100, 300, 500, 800][cleared];
          dropMs = Math.max(120, 600 - lines * 15);
          clearInterval(iv);
          iv = setInterval(tick, dropMs);
        }
        newPiece();
      }
      function tick() {
        if (over) return;
        if (!hitTest(cur, cx, cy + 1)) cy++;
        else merge();
        draw();
      }
      function reset() {
        grid = [];
        for (var r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(0));
        score = 0; lines = 0; over = false; dropMs = 600;
        u.msg.textContent = '';
        newPiece();
        clearInterval(iv);
        iv = setInterval(tick, dropMs);
        draw();
      }
      function key(e) {
        var k = e.key.toLowerCase();
        if (over) { if (k === 'r') reset(); return; }
        if (k === 'arrowleft' || k === 'a') { if (!hitTest(cur, cx - 1, cy)) cx--; }
        else if (k === 'arrowright' || k === 'd') { if (!hitTest(cur, cx + 1, cy)) cx++; }
        else if (k === 'arrowdown' || k === 's') { if (!hitTest(cur, cx, cy + 1)) cy++; }
        else if (k === 'arrowup' || k === 'w') {
          var R = cur[0].map(function (_, i) { return cur.map(function (row) { return row[i]; }).reverse(); });
          if (!hitTest(R, cx, cy)) cur = R;
        }
        else if (k === ' ') { while (!hitTest(cur, cx, cy + 1)) cy++; merge(); }
        else return;
        e.preventDefault();
        draw();
      }
      document.addEventListener('keydown', key);
      reset();
      return function () { clearInterval(iv); document.removeEventListener('keydown', key); };
    }

    /* ---------- 街机 · 打砖块 ---------- */
    function breakoutGame(stage) {
      var W = Math.min(460, window.innerWidth - 60), H = 360;
      var u = arcUI(stage, W, H, '鼠标 / ←→ 移动挡板 · 清光砖块过关 · 3 条命');
      var C = pal(), K = 'yzzn-arc-breakout', hi = hiGet(K);
      var padW = 72, padX, ball, bricks, score, lives, lvl, over, raf = null, keys = {}, prev = 0;
      var BC = Math.max(6, Math.floor((W - 20) / 50)), BROWS = 5;
      var RC = ['c-render', 'c-tool', 'c-engine', 'c-char', 'c-ai'];
      function newBall() {
        ball = { x: W / 2, y: H - 70, vx: (Math.random() < 0.5 ? -1 : 1) * (120 + lvl * 20), vy: -(190 + lvl * 25) };
      }
      function newLevel() {
        bricks = [];
        var bw = (W - 20) / BC;
        for (var r = 0; r < BROWS; r++) for (var c = 0; c < BC; c++)
          bricks.push({ x: 10 + c * bw + 2, y: 32 + r * 20, w: bw - 4, h: 14, k: RC[r] });
        newBall();
      }
      function reset() {
        score = 0; lives = 3; lvl = 1; over = false; padX = W / 2;
        u.msg.textContent = '';
        newLevel();
      }
      function onMouse(e) {
        var r = u.cvs.getBoundingClientRect();
        padX = (e.clientX - r.left) / r.width * W;
      }
      function onClick() { if (over) reset(); }
      function key(e) { keys[e.key.toLowerCase()] = e.type === 'keydown'; }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (!over) {
          if (keys.arrowleft || keys.a) padX -= 380 * dt;
          if (keys.arrowright || keys.d) padX += 380 * dt;
          padX = Math.max(padW / 2, Math.min(W - padW / 2, padX));
          ball.x += ball.vx * dt; ball.y += ball.vy * dt;
          if (ball.x < 6 || ball.x > W - 6) ball.vx *= -1;
          if (ball.y < 6) ball.vy *= -1;
          if (ball.vy > 0 && ball.y > H - 26 && ball.y < H - 14 && Math.abs(ball.x - padX) < padW / 2 + 6) {
            ball.vy = -Math.abs(ball.vy);
            ball.vx += (ball.x - padX) * 4;
          }
          for (var i = bricks.length - 1; i >= 0; i--) {
            var b = bricks[i];
            if (ball.x > b.x - 5 && ball.x < b.x + b.w + 5 && ball.y > b.y - 5 && ball.y < b.y + b.h + 5) {
              bricks.splice(i, 1);
              score += 10;
              ball.vy *= -1;
              break;
            }
          }
          if (!bricks.length) { lvl++; newLevel(); }
          if (ball.y > H + 10) {
            lives--;
            if (lives <= 0) {
              over = true;
              if (score > hi) { hi = score; hiSet(K, hi); }
              u.msg.textContent = 'GAME OVER · ' + score + ' 分 — 点击重开';
            } else newBall();
          }
        }
        g.clearRect(0, 0, W, H);
        bricks.forEach(function (b) { g.fillStyle = C[b.k]; g.fillRect(b.x, b.y, b.w, b.h); });
        g.fillStyle = C.ink;
        g.fillRect(padX - padW / 2, H - 20, padW, 7);
        g.beginPath();
        g.arc(ball.x, ball.y, 5, 0, 6.2832);
        g.fillStyle = C.accent;
        g.fill();
        u.s.textContent = 'SCORE ' + score;
        u.m.textContent = 'LV ' + lvl + ' · LIVES ' + lives;
        u.hb.textContent = 'HI ' + hi;
      }
      u.cvs.addEventListener('mousemove', onMouse);
      u.cvs.addEventListener('click', onClick);
      document.addEventListener('keydown', key);
      document.addEventListener('keyup', key);
      reset();
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        u.cvs.removeEventListener('mousemove', onMouse);
        u.cvs.removeEventListener('click', onClick);
        document.removeEventListener('keydown', key);
        document.removeEventListener('keyup', key);
      };
    }

    /* ---------- 街机 · PONG ---------- */
    function pongGame(stage) {
      var W = Math.min(460, window.innerWidth - 60), H = 300, PH = 56;
      var u = arcUI(stage, W, H, '鼠标 / W S 控制左侧挡板 · 先得 7 分获胜');
      var C = pal();
      var py = H / 2, ay = H / 2, ball, ps = 0, as = 0, over = false, raf = null, keys = {}, prev = 0;
      function serve(d) {
        ball = { x: W / 2, y: H / 2, vx: d * 210, vy: (Math.random() * 2 - 1) * 150 };
      }
      function key(e) { keys[e.key.toLowerCase()] = e.type === 'keydown'; }
      function onMouse(e) {
        var r = u.cvs.getBoundingClientRect();
        py = (e.clientY - r.top) / r.height * H;
      }
      function onClick() { if (over) { ps = 0; as = 0; over = false; u.msg.textContent = ''; serve(1); } }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (!over) {
          if (keys.w) py -= 320 * dt;
          if (keys.s) py += 320 * dt;
          py = Math.max(PH / 2, Math.min(H - PH / 2, py));
          var chase = ball.y - ay;
          ay += Math.max(-175 * dt, Math.min(175 * dt, chase));
          ball.x += ball.vx * dt; ball.y += ball.vy * dt;
          if (ball.y < 6 || ball.y > H - 6) ball.vy *= -1;
          if (ball.vx < 0 && ball.x < 22 && Math.abs(ball.y - py) < PH / 2 + 6) {
            ball.vx = Math.abs(ball.vx) * 1.04;
            ball.vy += (ball.y - py) * 5;
          }
          if (ball.vx > 0 && ball.x > W - 22 && Math.abs(ball.y - ay) < PH / 2 + 6) {
            ball.vx = -Math.abs(ball.vx) * 1.04;
            ball.vy += (ball.y - ay) * 5;
          }
          if (ball.x < -10) { as++; serve(1); }
          if (ball.x > W + 10) { ps++; serve(-1); }
          if (ps >= 7 || as >= 7) {
            over = true;
            u.msg.textContent = (ps >= 7 ? '你赢了！' : 'AI 获胜。') + ' ' + ps + ' : ' + as + ' — 点击重开';
          }
        }
        g.clearRect(0, 0, W, H);
        g.strokeStyle = C.line;
        g.setLineDash([5, 7]);
        g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
        g.setLineDash([]);
        g.fillStyle = C.ink;
        g.fillRect(14, py - PH / 2, 6, PH);
        g.fillRect(W - 20, ay - PH / 2, 6, PH);
        g.fillStyle = C.accent;
        g.fillRect(ball.x - 4, ball.y - 4, 8, 8);
        u.s.textContent = 'YOU ' + ps;
        u.hb.textContent = 'AI ' + as;
      }
      u.cvs.addEventListener('mousemove', onMouse);
      u.cvs.addEventListener('click', onClick);
      document.addEventListener('keydown', key);
      document.addEventListener('keyup', key);
      serve(1);
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        u.cvs.removeEventListener('mousemove', onMouse);
        u.cvs.removeEventListener('click', onClick);
        document.removeEventListener('keydown', key);
        document.removeEventListener('keyup', key);
      };
    }

    /* ---------- 街机 · 太空侵略者 ---------- */
    function invadersGame(stage) {
      var W = Math.min(460, window.innerWidth - 60), H = 380;
      var u = arcUI(stage, W, H, '←→ 移动 · 空格射击 · 别让它们降落');
      var C = pal(), K = 'yzzn-arc-invaders', hi = hiGet(K);
      var px, shots, eShots, aliens, adir, score, lives, wave, over, raf = null, keys = {}, prev = 0, cool = 0;
      function newWave() {
        aliens = [];
        for (var r = 0; r < 4; r++) for (var c = 0; c < 8; c++)
          aliens.push({ x: 36 + c * 48, y: 36 + r * 30 });
        adir = 1;
      }
      function reset() {
        px = W / 2; shots = []; eShots = []; score = 0; lives = 3; wave = 1; over = false;
        u.msg.textContent = '';
        newWave();
      }
      function key(e) {
        keys[e.key.toLowerCase()] = e.type === 'keydown';
        if (e.key === ' ') {
          e.preventDefault();
          if (e.type === 'keydown') {
            if (over) reset();
            else if (cool <= 0 && shots.length < 2) { shots.push({ x: px, y: H - 34 }); cool = 0.25; }
          }
        }
      }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (!over) {
          cool -= dt;
          if (keys.arrowleft || keys.a) px -= 300 * dt;
          if (keys.arrowright || keys.d) px += 300 * dt;
          px = Math.max(16, Math.min(W - 16, px));
          var spd = (16 + wave * 7 + (32 - aliens.length)) * dt * adir;
          var minX = 1e9, maxX = -1e9, maxY = -1e9;
          aliens.forEach(function (a) {
            a.x += spd;
            minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
          });
          if (minX < 16 || maxX > W - 16) {
            adir *= -1;
            aliens.forEach(function (a) { a.y += 14; });
          }
          if (maxY > H - 70) {
            over = true;
            if (score > hi) { hi = score; hiSet(K, hi); }
            u.msg.textContent = '防线失守！' + score + ' 分 — 空格重开';
          }
          if (aliens.length && Math.random() < dt * (0.5 + wave * 0.15)) {
            var sh = aliens[Math.floor(Math.random() * aliens.length)];
            eShots.push({ x: sh.x, y: sh.y + 8 });
          }
          for (var i = shots.length - 1; i >= 0; i--) {
            shots[i].y -= 420 * dt;
            if (shots[i].y < -10) { shots.splice(i, 1); continue; }
            for (var j = aliens.length - 1; j >= 0; j--) {
              if (Math.abs(shots[i].x - aliens[j].x) < 14 && Math.abs(shots[i].y - aliens[j].y) < 10) {
                aliens.splice(j, 1);
                shots.splice(i, 1);
                score += 10;
                break;
              }
            }
          }
          for (var k2 = eShots.length - 1; k2 >= 0; k2--) {
            eShots[k2].y += (150 + wave * 20) * dt;
            if (eShots[k2].y > H) { eShots.splice(k2, 1); continue; }
            if (Math.abs(eShots[k2].x - px) < 12 && eShots[k2].y > H - 34 && eShots[k2].y < H - 14) {
              eShots.splice(k2, 1);
              lives--;
              if (lives <= 0) {
                over = true;
                if (score > hi) { hi = score; hiSet(K, hi); }
                u.msg.textContent = '战机被击毁！' + score + ' 分 — 空格重开';
              }
            }
          }
          if (!aliens.length) { wave++; newWave(); }
        }
        g.clearRect(0, 0, W, H);
        g.fillStyle = C['c-engine'];
        aliens.forEach(function (a) {
          g.fillRect(a.x - 10, a.y - 6, 20, 12);
          g.fillRect(a.x - 14, a.y - 2, 4, 4);
          g.fillRect(a.x + 10, a.y - 2, 4, 4);
        });
        g.fillStyle = C.accent;
        g.beginPath();
        g.moveTo(px, H - 34);
        g.lineTo(px - 13, H - 14);
        g.lineTo(px + 13, H - 14);
        g.closePath();
        g.fill();
        g.fillStyle = C.ink;
        shots.forEach(function (s) { g.fillRect(s.x - 1.5, s.y - 6, 3, 8); });
        g.fillStyle = C['c-render'];
        eShots.forEach(function (s) { g.fillRect(s.x - 1.5, s.y, 3, 8); });
        u.s.textContent = 'SCORE ' + score;
        u.m.textContent = 'WAVE ' + wave + ' · LIVES ' + lives;
        u.hb.textContent = 'HI ' + hi;
      }
      document.addEventListener('keydown', key);
      document.addEventListener('keyup', key);
      reset();
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', key);
        document.removeEventListener('keyup', key);
      };
    }

    /* ---------- 街机 · 小行星 ---------- */
    function asteroidsGame(stage) {
      var W = Math.min(460, window.innerWidth - 60), H = 380;
      var u = arcUI(stage, W, H, '←→ 转向 · ↑ 推进 · 空格射击 · 大石头会碎成小石头');
      var C = pal(), K = 'yzzn-arc-asteroids', hi = hiGet(K);
      var ship, rocks, shots, score, lives, over, raf = null, keys = {}, prev = 0, cool = 0, wave;
      function mkRock(x, y, r) {
        var verts = [];
        for (var i = 0; i < 9; i++) verts.push(r * (0.7 + Math.random() * 0.5));
        var a = Math.random() * 6.28;
        return { x: x, y: y, r: r, vx: Math.cos(a) * (30 + Math.random() * 40), vy: Math.sin(a) * (30 + Math.random() * 40), verts: verts, rot: 0, vr: (Math.random() - 0.5) * 1.5 };
      }
      function newWave() {
        rocks = [];
        for (var i = 0; i < 4 + wave; i++) {
          var a = Math.random() * 6.28;
          rocks.push(mkRock(W / 2 + Math.cos(a) * 150, H / 2 + Math.sin(a) * 130, 26));
        }
      }
      function reset() {
        ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0, inv: 2 };
        shots = []; score = 0; lives = 3; wave = 1; over = false;
        u.msg.textContent = '';
        newWave();
      }
      function key(e) {
        keys[e.key.toLowerCase()] = e.type === 'keydown';
        if (e.key === ' ') {
          e.preventDefault();
          if (e.type === 'keydown') {
            if (over) reset();
            else if (cool <= 0) {
              shots.push({ x: ship.x + Math.cos(ship.a) * 12, y: ship.y + Math.sin(ship.a) * 12, vx: Math.cos(ship.a) * 380 + ship.vx, vy: Math.sin(ship.a) * 380 + ship.vy, t: 0 });
              cool = 0.22;
            }
          }
        }
      }
      function wrap(o) {
        if (o.x < -20) o.x = W + 20; if (o.x > W + 20) o.x = -20;
        if (o.y < -20) o.y = H + 20; if (o.y > H + 20) o.y = -20;
      }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (!over) {
          cool -= dt;
          if (keys.arrowleft || keys.a) ship.a -= 3.6 * dt;
          if (keys.arrowright || keys.d) ship.a += 3.6 * dt;
          if (keys.arrowup || keys.w) { ship.vx += Math.cos(ship.a) * 260 * dt; ship.vy += Math.sin(ship.a) * 260 * dt; }
          ship.vx *= 0.995; ship.vy *= 0.995;
          ship.x += ship.vx * dt; ship.y += ship.vy * dt;
          if (ship.inv > 0) ship.inv -= dt;
          wrap(ship);
          rocks.forEach(function (r) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.vr * dt; wrap(r); });
          for (var i = shots.length - 1; i >= 0; i--) {
            var s = shots[i];
            s.x += s.vx * dt; s.y += s.vy * dt; s.t += dt;
            wrap(s);
            if (s.t > 1) { shots.splice(i, 1); continue; }
            for (var j = rocks.length - 1; j >= 0; j--) {
              var r = rocks[j];
              var dx = s.x - r.x, dy = s.y - r.y;
              if (dx * dx + dy * dy < r.r * r.r) {
                shots.splice(i, 1);
                score += Math.round(40 - r.r);
                if (r.r > 12) { rocks.push(mkRock(r.x, r.y, r.r / 1.7)); rocks.push(mkRock(r.x, r.y, r.r / 1.7)); }
                rocks.splice(j, 1);
                break;
              }
            }
          }
          if (ship.inv <= 0) {
            for (var k3 = 0; k3 < rocks.length; k3++) {
              var rr = rocks[k3];
              var ddx = ship.x - rr.x, ddy = ship.y - rr.y;
              if (ddx * ddx + ddy * ddy < (rr.r + 8) * (rr.r + 8)) {
                lives--;
                ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.inv = 2;
                if (lives <= 0) {
                  over = true;
                  if (score > hi) { hi = score; hiSet(K, hi); }
                  u.msg.textContent = '船毁了！' + score + ' 分 — 空格重开';
                }
                break;
              }
            }
          }
          if (!rocks.length) { wave++; newWave(); }
        }
        g.clearRect(0, 0, W, H);
        g.strokeStyle = C.ink2;
        g.lineWidth = 1.5;
        rocks.forEach(function (r) {
          g.save();
          g.translate(r.x, r.y);
          g.rotate(r.rot);
          g.beginPath();
          r.verts.forEach(function (v, i) {
            var a = i / r.verts.length * 6.2832;
            if (i) g.lineTo(Math.cos(a) * v, Math.sin(a) * v);
            else g.moveTo(Math.cos(a) * v, Math.sin(a) * v);
          });
          g.closePath();
          g.stroke();
          g.restore();
        });
        if (!over && (ship.inv <= 0 || Math.floor(ship.inv * 8) % 2 === 0)) {
          g.save();
          g.translate(ship.x, ship.y);
          g.rotate(ship.a);
          g.strokeStyle = C.accent;
          g.beginPath();
          g.moveTo(14, 0); g.lineTo(-10, -8); g.lineTo(-6, 0); g.lineTo(-10, 8);
          g.closePath();
          g.stroke();
          g.restore();
        }
        g.fillStyle = C.ink;
        shots.forEach(function (s) { g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); });
        u.s.textContent = 'SCORE ' + score;
        u.m.textContent = 'WAVE ' + wave + ' · LIVES ' + lives;
        u.hb.textContent = 'HI ' + hi;
      }
      document.addEventListener('keydown', key);
      document.addEventListener('keyup', key);
      reset();
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', key);
        document.removeEventListener('keyup', key);
      };
    }

    /* ---------- 街机 · 像素小鸟 ---------- */
    function flappyGame(stage) {
      var W = Math.min(380, window.innerWidth - 60), H = 440;
      var u = arcUI(stage, W, H, '点击 / 空格 拍翅膀 · 穿过缺口');
      var C = pal(), K = 'yzzn-arc-flappy', hi = hiGet(K);
      var bird, pipes, score, over, started, raf = null, prev = 0, spawnT;
      var GAP = 132;
      function reset() {
        bird = { y: H / 2, vy: 0 };
        pipes = []; score = 0; over = false; started = false; spawnT = 0;
        u.msg.textContent = '点击开始';
      }
      function flap() {
        if (over) { reset(); return; }
        if (!started) { started = true; u.msg.textContent = ''; }
        bird.vy = -265;
      }
      function key(e) { if (e.key === ' ') { e.preventDefault(); flap(); } }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (started && !over) {
          bird.vy += 760 * dt;
          bird.y += bird.vy * dt;
          spawnT -= dt;
          if (spawnT <= 0) {
            pipes.push({ x: W + 30, gy: 70 + Math.random() * (H - 140 - GAP), passed: false });
            spawnT = 1.55;
          }
          var spd = 135 + score * 1.5;
          for (var i = pipes.length - 1; i >= 0; i--) {
            var p = pipes[i];
            p.x -= spd * dt;
            if (p.x < -40) { pipes.splice(i, 1); continue; }
            if (!p.passed && p.x < W * 0.28 - 14) { p.passed = true; score++; }
            if (Math.abs(p.x - W * 0.28) < 26 && (bird.y < p.gy || bird.y > p.gy + GAP)) over = true;
          }
          if (bird.y > H - 8 || bird.y < 4) over = true;
          if (over) {
            if (score > hi) { hi = score; hiSet(K, hi); }
            u.msg.textContent = '坠机！' + score + ' 分 — 点击重开';
          }
        }
        g.clearRect(0, 0, W, H);
        g.fillStyle = C['c-engine'];
        pipes.forEach(function (p) {
          g.fillRect(p.x - 24, 0, 48, p.gy);
          g.fillRect(p.x - 24, p.gy + GAP, 48, H - p.gy - GAP);
        });
        g.fillStyle = C.accent;
        g.beginPath();
        g.arc(W * 0.28, bird.y, 10, 0, 6.2832);
        g.fill();
        g.fillStyle = C.ink;
        g.beginPath();
        g.arc(W * 0.28 + 4, bird.y - 3, 2, 0, 6.2832);
        g.fill();
        u.s.textContent = 'SCORE ' + score;
        u.hb.textContent = 'HI ' + hi;
      }
      u.cvs.addEventListener('click', flap);
      document.addEventListener('keydown', key);
      reset();
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        u.cvs.removeEventListener('click', flap);
        document.removeEventListener('keydown', key);
      };
    }

    /* ---------- 街机 · 恐龙跑酷 ---------- */
    function dinoGame(stage) {
      var W = Math.min(500, window.innerWidth - 60), H = 200;
      var u = arcUI(stage, W, H, '空格 / 点击 跳跃 · 越跑越快');
      var C = pal(), K = 'yzzn-arc-dino', hi = hiGet(K);
      var y, vy, obs, t, score, over, raf = null, prev = 0, spawnT;
      var GY = H - 30;
      function reset() {
        y = 0; vy = 0; obs = []; t = 0; score = 0; over = false; spawnT = 1;
        u.msg.textContent = '';
      }
      function jump() {
        if (over) { reset(); return; }
        if (y === 0) vy = -430;
      }
      function key(e) { if (e.key === ' ') { e.preventDefault(); jump(); } }
      function loop(ts) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min((ts - prev) / 1000, 0.03);
        prev = ts;
        var g = u.g;
        if (!over) {
          t += dt;
          score = Math.floor(t * 10);
          vy += 1300 * dt;
          y = Math.min(0, y + vy * dt);
          if (y === 0) vy = 0;
          var spd = 250 + t * 9;
          spawnT -= dt;
          if (spawnT <= 0) {
            var hgt = 22 + Math.random() * 22;
            obs.push({ x: W + 20, w: 12 + Math.random() * 14, h: hgt });
            spawnT = 0.9 + Math.random() * 0.9;
          }
          for (var i = obs.length - 1; i >= 0; i--) {
            var o = obs[i];
            o.x -= spd * dt;
            if (o.x < -30) { obs.splice(i, 1); continue; }
            if (o.x < 54 && o.x + o.w > 30 && GY + y > GY - o.h - 2) {
              over = true;
              if (score > hi) { hi = score; hiSet(K, hi); }
              u.msg.textContent = '绊倒了！' + score + ' 分 — 空格重开';
            }
          }
        }
        g.clearRect(0, 0, W, H);
        g.strokeStyle = C.line;
        g.beginPath(); g.moveTo(0, GY + 14); g.lineTo(W, GY + 14); g.stroke();
        g.fillStyle = C.accent;
        g.fillRect(30, GY + y - 24, 22, 24);
        g.fillRect(46, GY + y - 32, 12, 12);
        g.fillStyle = C['c-engine'];
        obs.forEach(function (o) { g.fillRect(o.x, GY + 14 - o.h, o.w, o.h); });
        u.s.textContent = 'SCORE ' + score;
        u.hb.textContent = 'HI ' + hi;
      }
      u.cvs.addEventListener('click', jump);
      document.addEventListener('keydown', key);
      reset();
      raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
      return function () {
        cancelAnimationFrame(raf);
        u.cvs.removeEventListener('click', jump);
        document.removeEventListener('keydown', key);
      };
    }

    /* ---------- 益智 · 扫雷 ---------- */
    function minesGame(stage) {
      var N = 9, MINES = 10, K = 'yzzn-arc-mines';
      var best = hiGet(K);
      var mines, opened, flagged, count, started, over, sec, iv = null;
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:306px; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="mw-m"></span><span id="mw-t">0 s</span><span>' + (best ? 'BEST ' + best + 's' : '') + '</span>' +
          '</div>' +
          '<div id="mw" style="display:grid; grid-template-columns:repeat(9,34px); gap:2px; justify-content:center;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">左键翻开 · 右键插旗 · 首翻必安全</div>' +
          '<div class="mono" id="mw-msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var grid = stage.querySelector('#mw');
      var cells = [];
      function idx(r, c) { return r * N + c; }
      function nbs(i) {
        var r = Math.floor(i / N), c = i % N, out = [];
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var R = r + dr, Cc = c + dc;
          if (R >= 0 && R < N && Cc >= 0 && Cc < N) out.push(idx(R, Cc));
        }
        return out;
      }
      function reset() {
        mines = []; opened = []; flagged = []; count = []; started = false; over = false; sec = 0;
        clearInterval(iv);
        stage.querySelector('#mw-t').textContent = '0 s';
        stage.querySelector('#mw-msg').textContent = '';
        for (var i = 0; i < N * N; i++) { mines[i] = false; opened[i] = false; flagged[i] = false; count[i] = 0; }
        render();
      }
      function plant(safe) {
        var banned = [safe].concat(nbs(safe));
        var placed = 0;
        while (placed < MINES) {
          var i = Math.floor(Math.random() * N * N);
          if (mines[i] || banned.indexOf(i) >= 0) continue;
          mines[i] = true; placed++;
        }
        for (var j = 0; j < N * N; j++) {
          count[j] = nbs(j).filter(function (n) { return mines[n]; }).length;
        }
      }
      function reveal(i) {
        if (opened[i] || flagged[i]) return;
        opened[i] = true;
        if (count[i] === 0 && !mines[i]) nbs(i).forEach(reveal);
      }
      function checkWin() {
        var ok = 0;
        for (var i = 0; i < N * N; i++) if (opened[i]) ok++;
        if (ok === N * N - MINES) {
          over = true;
          clearInterval(iv);
          if (!best || sec < best) { best = sec; hiSet(K, best); }
          stage.querySelector('#mw-msg').textContent = '✓ 扫完了！' + sec + ' 秒 — 点任意格重开';
        }
      }
      function click(i, flag) {
        if (over) { reset(); return; }
        if (flag) {
          if (!opened[i]) flagged[i] = !flagged[i];
          render();
          return;
        }
        if (flagged[i]) return;
        if (!started) {
          started = true;
          plant(i);
          iv = setInterval(function () { sec++; stage.querySelector('#mw-t').textContent = sec + ' s'; }, 1000);
        }
        if (mines[i]) {
          over = true;
          clearInterval(iv);
          for (var j = 0; j < N * N; j++) if (mines[j]) opened[j] = true;
          stage.querySelector('#mw-msg').textContent = '💥 踩雷 — 点任意格重开';
        } else {
          reveal(i);
          checkWin();
        }
        render();
      }
      function render() {
        var NUMC = ['', 'var(--c-char)', 'var(--c-engine)', 'var(--c-render)', 'var(--c-ai)', 'var(--c-tool)', 'var(--c-life)', 'var(--ink)', 'var(--ink)'];
        if (!cells.length) {
          for (var i = 0; i < N * N; i++) {
            (function (i2) {
              var b = document.createElement('button');
              b.style.cssText = 'width:34px; height:34px; border:1px solid var(--line); background:var(--surface2); font:700 14px Consolas,monospace; cursor:pointer; color:var(--ink); padding:0;';
              b.addEventListener('click', function () { click(i2, false); });
              b.addEventListener('contextmenu', function (e) { e.preventDefault(); click(i2, true); });
              grid.appendChild(b);
              cells.push(b);
            })(i);
          }
        }
        var flags = 0;
        for (var j = 0; j < N * N; j++) {
          var b2 = cells[j];
          if (opened[j]) {
            b2.style.background = 'var(--surface)';
            if (mines[j]) { b2.textContent = '✱'; b2.style.color = 'var(--c-render)'; }
            else {
              b2.textContent = count[j] || '';
              b2.style.color = NUMC[count[j]] || 'var(--ink)';
            }
          } else {
            b2.style.background = 'var(--surface2)';
            b2.textContent = flagged[j] ? '⚑' : '';
            b2.style.color = 'var(--accent)';
            if (flagged[j]) flags++;
          }
        }
        stage.querySelector('#mw-m').textContent = 'MINES ' + (MINES - flags);
      }
      reset();
      return function () { clearInterval(iv); };
    }

    /* ---------- 益智 · 翻牌记忆 ---------- */
    function memoryGame(stage) {
      var K = 'yzzn-arc-memory';
      var best = hiGet(K);
      var GLYPHS = ['λ', '∇', '∑', 'π', 'Δ', 'θ', '∞', 'ƒ'];
      var deck = GLYPHS.concat(GLYPHS);
      for (var i = deck.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:296px; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="mm-mv">0 步</span><span>' + (best ? 'BEST ' + best + ' 步' : '') + '</span>' +
          '</div>' +
          '<div id="mm" style="display:grid; grid-template-columns:repeat(4,70px); gap:6px; justify-content:center;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">翻出所有配对 · 越少步越好</div>' +
          '<div class="mono" id="mm-msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var grid = stage.querySelector('#mm');
      var open = [], matched = [], lock = false, moves = 0, to = null;
      var btns = deck.map(function (gl, i2) {
        var b = document.createElement('button');
        b.style.cssText = 'width:70px; height:70px; border:1px solid var(--line); background:var(--surface2); font:700 26px Consolas,monospace; cursor:pointer; color:var(--accent); padding:0;';
        b.addEventListener('click', function () {
          if (lock || matched[i2] || open.indexOf(i2) >= 0 || open.length === 2) return;
          open.push(i2);
          render();
          if (open.length === 2) {
            moves++;
            stage.querySelector('#mm-mv').textContent = moves + ' 步';
            if (deck[open[0]] === deck[open[1]]) {
              matched[open[0]] = matched[open[1]] = true;
              open = [];
              render();
              if (matched.filter(Boolean).length === deck.length) {
                if (!best || moves < best) { best = moves; hiSet(K, best); }
                stage.querySelector('#mm-msg').textContent = '✓ 全部配对！' + moves + ' 步';
              }
            } else {
              lock = true;
              to = setTimeout(function () { open = []; lock = false; render(); }, 700);
            }
          }
        });
        grid.appendChild(b);
        return b;
      });
      function render() {
        deck.forEach(function (gl, i2) {
          var show = matched[i2] || open.indexOf(i2) >= 0;
          btns[i2].textContent = show ? gl : '';
          btns[i2].style.background = matched[i2] ? 'var(--surface)' : 'var(--surface2)';
          btns[i2].style.borderColor = matched[i2] ? 'var(--play)' : 'var(--line)';
        });
      }
      render();
      return function () { clearTimeout(to); };
    }

    /* ---------- 益智 · 数字华容道 ---------- */
    function slide15Game(stage) {
      var K = 'yzzn-arc-slide15';
      var best = hiGet(K);
      var cells, gap, moves, sec, iv = null, done;
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:296px; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="s5-mv">0 步</span><span id="s5-t">0 s</span><span>' + (best ? 'BEST ' + best + 's' : '') + '</span>' +
          '</div>' +
          '<div id="s5" style="display:grid; grid-template-columns:repeat(4,70px); gap:6px; justify-content:center;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">点击空格旁的数字滑动 · 方向键也行 · 排成 1~15</div>' +
          '<div class="mono" id="s5-msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var grid = stage.querySelector('#s5');
      var btns = [];
      function reset() {
        cells = [];
        for (var i = 1; i <= 15; i++) cells.push(i);
        cells.push(0);
        gap = 15; moves = 0; sec = 0; done = false;
        /* 从终态随机走 250 步，保证有解 */
        for (var s = 0; s < 250; s++) {
          var opts = [];
          var r = Math.floor(gap / 4), c = gap % 4;
          if (r > 0) opts.push(gap - 4);
          if (r < 3) opts.push(gap + 4);
          if (c > 0) opts.push(gap - 1);
          if (c < 3) opts.push(gap + 1);
          var pick = opts[Math.floor(Math.random() * opts.length)];
          cells[gap] = cells[pick]; cells[pick] = 0; gap = pick;
        }
        clearInterval(iv);
        iv = setInterval(function () {
          if (!done) { sec++; stage.querySelector('#s5-t').textContent = sec + ' s'; }
        }, 1000);
        stage.querySelector('#s5-mv').textContent = '0 步';
        stage.querySelector('#s5-t').textContent = '0 s';
        stage.querySelector('#s5-msg').textContent = '';
        render();
      }
      function tryMove(i) {
        if (done) { reset(); return; }
        var r = Math.floor(i / 4), c = i % 4, gr = Math.floor(gap / 4), gc = gap % 4;
        if (Math.abs(r - gr) + Math.abs(c - gc) !== 1) return;
        cells[gap] = cells[i]; cells[i] = 0; gap = i;
        moves++;
        stage.querySelector('#s5-mv').textContent = moves + ' 步';
        render();
        var ok = true;
        for (var j = 0; j < 15; j++) if (cells[j] !== j + 1) { ok = false; break; }
        if (ok) {
          done = true;
          clearInterval(iv);
          if (!best || sec < best) { best = sec; hiSet(K, best); }
          stage.querySelector('#s5-msg').textContent = '✓ 复原！' + sec + ' 秒 · ' + moves + ' 步 — 点任意块重开';
        }
      }
      function key(e) {
        var k = e.key;
        var gr = Math.floor(gap / 4), gc = gap % 4, i = -1;
        if (k === 'ArrowUp' && gr < 3) i = gap + 4;
        else if (k === 'ArrowDown' && gr > 0) i = gap - 4;
        else if (k === 'ArrowLeft' && gc < 3) i = gap + 1;
        else if (k === 'ArrowRight' && gc > 0) i = gap - 1;
        if (i >= 0) { e.preventDefault(); tryMove(i); }
      }
      function render() {
        if (!btns.length) {
          for (var i = 0; i < 16; i++) {
            (function (i2) {
              var b = document.createElement('button');
              b.style.cssText = 'width:70px; height:70px; border:1px solid var(--line); font:700 22px Consolas,monospace; cursor:pointer; padding:0;';
              b.addEventListener('click', function () { tryMove(i2); });
              grid.appendChild(b);
              btns.push(b);
            })(i);
          }
        }
        cells.forEach(function (v, i2) {
          btns[i2].textContent = v || '';
          btns[i2].style.background = v ? 'var(--surface2)' : 'var(--surface)';
          btns[i2].style.color = v === i2 + 1 ? 'var(--play)' : 'var(--ink)';
          btns[i2].style.borderColor = v ? 'var(--line)' : 'transparent';
        });
      }
      document.addEventListener('keydown', key);
      reset();
      return function () {
        clearInterval(iv);
        document.removeEventListener('keydown', key);
      };
    }

    /* ---------- 棋盘 · 井字棋 ---------- */
    function tttGame(stage) {
      var board, myTurn, over, w = 0, l = 0, d = 0;
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" id="tt-s" style="font-size:12px; color:var(--ink2); margin-bottom:10px;"></div>' +
          '<div id="tt" style="display:grid; grid-template-columns:repeat(3,84px); gap:6px; justify-content:center;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">你执 X 先手 · 对面是不会失误的 Minimax</div>' +
          '<div class="mono" id="tt-msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);"></div>' +
        '</div>';
      var grid = stage.querySelector('#tt'), btns = [];
      var LINES3 = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      function winner(b) {
        for (var i = 0; i < LINES3.length; i++) {
          var L = LINES3[i];
          if (b[L[0]] && b[L[0]] === b[L[1]] && b[L[1]] === b[L[2]]) return b[L[0]];
        }
        return b.indexOf('') < 0 ? 'D' : null;
      }
      function minimax(b, isAI) {
        var wnr = winner(b);
        if (wnr === 'O') return { v: 1 };
        if (wnr === 'X') return { v: -1 };
        if (wnr === 'D') return { v: 0 };
        var bestV = isAI ? -2 : 2, bestI = -1;
        for (var i = 0; i < 9; i++) {
          if (b[i]) continue;
          b[i] = isAI ? 'O' : 'X';
          var v = minimax(b, !isAI).v;
          b[i] = '';
          if (isAI ? v > bestV : v < bestV) { bestV = v; bestI = i; }
        }
        return { v: bestV, i: bestI };
      }
      function stat() {
        stage.querySelector('#tt-s').textContent = '胜 ' + w + ' · 负 ' + l + ' · 平 ' + d;
      }
      function finish(wnr) {
        over = true;
        if (wnr === 'X') { w++; stage.querySelector('#tt-msg').textContent = '你赢了？！请检查 AI 实现 — 点棋盘再来'; }
        else if (wnr === 'O') { l++; stage.querySelector('#tt-msg').textContent = 'AI 获胜 — 点棋盘再来'; }
        else { d++; stage.querySelector('#tt-msg').textContent = '平局（对 Minimax 而言这就是你的胜利）— 点棋盘再来'; }
        stat();
      }
      function reset() {
        board = ['', '', '', '', '', '', '', '', ''];
        myTurn = true; over = false;
        stage.querySelector('#tt-msg').textContent = '';
        render();
      }
      function play(i) {
        if (over) { reset(); return; }
        if (!myTurn || board[i]) return;
        board[i] = 'X';
        var wnr = winner(board);
        if (wnr) { render(); finish(wnr); return; }
        myTurn = false;
        render();
        setTimeout(function () {
          var mv = minimax(board.slice(), true);
          board[mv.i] = 'O';
          myTurn = true;
          render();
          var w2 = winner(board);
          if (w2) finish(w2);
        }, 250);
      }
      function render() {
        if (!btns.length) {
          for (var i = 0; i < 9; i++) {
            (function (i2) {
              var b = document.createElement('button');
              b.style.cssText = 'width:84px; height:84px; border:1px solid var(--line); background:var(--surface2); font:700 34px Consolas,monospace; cursor:pointer; padding:0;';
              b.addEventListener('click', function () { play(i2); });
              grid.appendChild(b);
              btns.push(b);
            })(i);
          }
        }
        board.forEach(function (v, i2) {
          btns[i2].textContent = v;
          btns[i2].style.color = v === 'X' ? 'var(--accent)' : 'var(--c-char)';
        });
      }
      stat();
      reset();
      return null;
    }

    /* ---------- 棋盘 · 五子棋 ---------- */
    function gomokuGame(stage) {
      var N = 13, cell = 26, PAD = 18;
      var W = PAD * 2 + (N - 1) * cell;
      var u = arcUI(stage, W, W, '你执黑先手 · 连成五子获胜 · 点击落子');
      var C = pal();
      var board, over, thinking;
      var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
      function at(r, c) { return (r < 0 || c < 0 || r >= N || c >= N) ? -1 : board[r * N + c]; }
      function runLen(r, c, dr, dc, who) {
        var n = 0;
        while (at(r + dr * (n + 1), c + dc * (n + 1)) === who) n++;
        return n;
      }
      function winAt(r, c, who) {
        for (var i = 0; i < 4; i++) {
          var d = DIRS[i];
          if (1 + runLen(r, c, d[0], d[1], who) + runLen(r, c, -d[0], -d[1], who) >= 5) return true;
        }
        return false;
      }
      function scoreCell(r, c, who) {
        var s = 0;
        for (var i = 0; i < 4; i++) {
          var d = DIRS[i];
          var a = runLen(r, c, d[0], d[1], who), b = runLen(r, c, -d[0], -d[1], who);
          var n = 1 + a + b;
          var openA = at(r + d[0] * (a + 1), c + d[1] * (a + 1)) === 0;
          var openB = at(r - d[0] * (b + 1), c - d[1] * (b + 1)) === 0;
          var open = (openA ? 1 : 0) + (openB ? 1 : 0);
          if (n >= 5) s += 1e6;
          else if (n === 4) s += open === 2 ? 50000 : (open === 1 ? 5000 : 0);
          else if (n === 3) s += open === 2 ? 3000 : (open === 1 ? 300 : 0);
          else if (n === 2) s += open === 2 ? 100 : (open === 1 ? 20 : 0);
        }
        return s;
      }
      function aiMove() {
        var bestI = -1, bestS = -1;
        for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
          if (board[r * N + c]) continue;
          /* 只考虑已有棋子附近的点 */
          var near = false;
          for (var dr = -2; dr <= 2 && !near; dr++) for (var dc = -2; dc <= 2; dc++) {
            if (at(r + dr, c + dc) > 0) { near = true; break; }
          }
          if (!near) continue;
          var s = scoreCell(r, c, 2) + scoreCell(r, c, 1) * 0.9;
          if (s > bestS) { bestS = s; bestI = r * N + c; }
        }
        if (bestI < 0) bestI = Math.floor(N / 2) * N + Math.floor(N / 2);
        return bestI;
      }
      function draw() {
        var g = u.g;
        g.clearRect(0, 0, W, W);
        g.strokeStyle = C.line;
        g.lineWidth = 1;
        for (var i = 0; i < N; i++) {
          g.beginPath();
          g.moveTo(PAD, PAD + i * cell); g.lineTo(W - PAD, PAD + i * cell);
          g.moveTo(PAD + i * cell, PAD); g.lineTo(PAD + i * cell, W - PAD);
          g.stroke();
        }
        for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
          var v = board[r * N + c];
          if (!v) continue;
          g.beginPath();
          g.arc(PAD + c * cell, PAD + r * cell, 10, 0, 6.2832);
          g.fillStyle = v === 1 ? C.ink : C.accent;
          g.fill();
        }
      }
      function reset() {
        board = [];
        for (var i = 0; i < N * N; i++) board.push(0);
        over = false; thinking = false;
        u.msg.textContent = '';
        draw();
      }
      function onClick(e) {
        if (over) { reset(); return; }
        if (thinking) return;
        var rect = u.cvs.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width * W;
        var y = (e.clientY - rect.top) / rect.height * W;
        var c = Math.round((x - PAD) / cell), r = Math.round((y - PAD) / cell);
        if (r < 0 || c < 0 || r >= N || c >= N || board[r * N + c]) return;
        board[r * N + c] = 1;
        draw();
        if (winAt(r, c, 1)) { over = true; u.msg.textContent = '⚫ 你赢了！— 点击再来'; return; }
        thinking = true;
        setTimeout(function () {
          var i = aiMove();
          board[i] = 2;
          thinking = false;
          draw();
          if (winAt(Math.floor(i / N), i % N, 2)) { over = true; u.msg.textContent = '🟠 AI 五连 — 点击再来'; }
        }, 200);
      }
      u.cvs.addEventListener('click', onClick);
      u.s.textContent = '⚫ 你'; u.hb.textContent = 'AI 🟠';
      reset();
      return function () { u.cvs.removeEventListener('click', onClick); };
    }

    /* ---------- 益智 · 迷宫 ---------- */
    function mazeGame(stage) {
      var N = 15, cell = Math.min(26, Math.floor((Math.min(440, window.innerWidth - 60)) / N));
      var W = N * cell, K = 'yzzn-arc-maze';
      var best = hiGet(K);
      var u = arcUI(stage, W, W, '方向键 / WASD 走到右下角出口 · R 换一张图');
      var C = pal();
      var walls, px2, py2, sec, iv = null, done;
      /* walls[i] 位掩码: 1上 2右 4下 8左 */
      function carve() {
        walls = [];
        var seen = [];
        for (var i = 0; i < N * N; i++) { walls.push(15); seen.push(false); }
        var stack = [0];
        seen[0] = true;
        while (stack.length) {
          var cur = stack[stack.length - 1];
          var r = Math.floor(cur / N), c = cur % N;
          var opts = [];
          if (r > 0 && !seen[cur - N]) opts.push([cur - N, 1, 4]);
          if (c < N - 1 && !seen[cur + 1]) opts.push([cur + 1, 2, 8]);
          if (r < N - 1 && !seen[cur + N]) opts.push([cur + N, 4, 1]);
          if (c > 0 && !seen[cur - 1]) opts.push([cur - 1, 8, 2]);
          if (!opts.length) { stack.pop(); continue; }
          var pick = opts[Math.floor(Math.random() * opts.length)];
          walls[cur] &= ~pick[1];
          walls[pick[0]] &= ~pick[2];
          seen[pick[0]] = true;
          stack.push(pick[0]);
        }
      }
      function draw() {
        var g = u.g;
        g.clearRect(0, 0, W, W);
        g.strokeStyle = C.ink2;
        g.lineWidth = 1.5;
        g.beginPath();
        for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
          var w2 = walls[r * N + c], x = c * cell, y = r * cell;
          if (w2 & 1) { g.moveTo(x, y); g.lineTo(x + cell, y); }
          if (w2 & 2) { g.moveTo(x + cell, y); g.lineTo(x + cell, y + cell); }
          if (w2 & 4) { g.moveTo(x, y + cell); g.lineTo(x + cell, y + cell); }
          if (w2 & 8) { g.moveTo(x, y); g.lineTo(x, y + cell); }
        }
        g.stroke();
        g.fillStyle = C.play;
        g.fillRect((N - 1) * cell + 5, (N - 1) * cell + 5, cell - 10, cell - 10);
        g.fillStyle = C.accent;
        g.beginPath();
        g.arc(px2 * cell + cell / 2, py2 * cell + cell / 2, cell * 0.28, 0, 6.2832);
        g.fill();
      }
      function reset() {
        carve();
        px2 = 0; py2 = 0; sec = 0; done = false;
        u.msg.textContent = '';
        clearInterval(iv);
        iv = setInterval(function () { if (!done) { sec++; u.m.textContent = sec + ' s'; } }, 1000);
        u.m.textContent = '0 s';
        u.hb.textContent = best ? 'BEST ' + best + 's' : '';
        draw();
      }
      function key(e) {
        var k = e.key.toLowerCase();
        if (k === 'r') { reset(); return; }
        if (done) return;
        var i = py2 * N + px2, moved = false;
        if ((k === 'arrowup' || k === 'w') && !(walls[i] & 1)) { py2--; moved = true; }
        else if ((k === 'arrowright' || k === 'd') && !(walls[i] & 2)) { px2++; moved = true; }
        else if ((k === 'arrowdown' || k === 's') && !(walls[i] & 4)) { py2++; moved = true; }
        else if ((k === 'arrowleft' || k === 'a') && !(walls[i] & 8)) { px2--; moved = true; }
        if (moved) {
          e.preventDefault();
          draw();
          if (px2 === N - 1 && py2 === N - 1) {
            done = true;
            clearInterval(iv);
            if (!best || sec < best) { best = sec; hiSet(K, best); }
            u.msg.textContent = '✓ 出来了！' + sec + ' 秒 — R 换一张图';
          }
        }
      }
      document.addEventListener('keydown', key);
      reset();
      return function () {
        clearInterval(iv);
        document.removeEventListener('keydown', key);
      };
    }

    /* ---------- 认知 · 反应力测试 ---------- */
    function reactionGame(stage) {
      var K = 'yzzn-arc-reaction';
      var best = hiGet(K);
      var ROUNDS = 5;
      var results, state, to = null, t0 = 0;
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:min(440px,90vw); margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="rt-r"></span><span>' + (best ? 'BEST ' + best + 'ms' : '') + '</span>' +
          '</div>' +
          '<div id="rt" style="width:min(440px,90vw); height:260px; margin:0 auto; border:1px solid var(--line); display:flex; align-items:center; justify-content:center; cursor:pointer; font:600 17px Consolas,monospace; user-select:none;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">变绿的瞬间点击 · 共 5 轮取平均 · 抢跑重来本轮</div>' +
        '</div>';
      var box = stage.querySelector('#rt');
      function setBox(bg, txt, col) {
        box.style.background = bg;
        box.style.color = col || 'var(--ink)';
        box.textContent = txt;
      }
      function idle() {
        state = 'idle';
        stage.querySelector('#rt-r').textContent = 'ROUND ' + (results.length + 1) + ' / ' + ROUNDS;
        setBox('var(--surface2)', '点击开始第 ' + (results.length + 1) + ' 轮');
      }
      function arm() {
        state = 'wait';
        setBox('color-mix(in srgb, var(--c-render) 30%, var(--surface2))', '等它变绿……');
        to = setTimeout(function () {
          state = 'go';
          t0 = performance.now();
          setBox('color-mix(in srgb, var(--play) 45%, var(--surface2))', '点！');
        }, 900 + Math.random() * 2200);
      }
      function click() {
        if (state === 'idle') { arm(); return; }
        if (state === 'wait') {
          clearTimeout(to);
          setBox('var(--surface2)', '抢跑了！点击重来本轮');
          state = 'idle';
          return;
        }
        if (state === 'go') {
          var ms = Math.round(performance.now() - t0);
          results.push(ms);
          if (results.length >= ROUNDS) {
            var avg = Math.round(results.reduce(function (a, b) { return a + b; }, 0) / ROUNDS);
            if (!best || avg < best) { best = avg; hiSet(K, best); }
            state = 'done';
            setBox('var(--surface2)', '平均 ' + avg + ' ms（' + results.join(' / ') + '）— 点击再来');
            stage.querySelector('#rt-r').textContent = 'DONE';
          } else {
            setBox('var(--surface2)', ms + ' ms！点击继续');
            state = 'idle';
            stage.querySelector('#rt-r').textContent = 'ROUND ' + (results.length + 1) + ' / ' + ROUNDS;
          }
          return;
        }
        if (state === 'done') { results = []; idle(); }
      }
      box.addEventListener('click', click);
      results = [];
      idle();
      return function () { clearTimeout(to); };
    }

    /* ---------- 认知 · Simon 记忆序列 ---------- */
    function simonGame(stage) {
      var K = 'yzzn-arc-simon';
      var best = hiGet(K);
      var COLS4 = ['var(--c-render)', 'var(--c-engine)', 'var(--c-char)', 'var(--c-tool)'];
      var FREQ = [261.6, 329.6, 392.0, 523.3];
      var seq, pos, phase, timers = [], actx = null;
      stage.innerHTML =
        '<div style="text-align:center;">' +
          '<div class="mono" style="display:flex; justify-content:space-between; width:296px; margin:0 auto 10px; font-size:12px; color:var(--ink2);">' +
            '<span id="sm-l">LEN 0</span><span>' + (best ? 'BEST ' + best : '') + '</span>' +
          '</div>' +
          '<div id="sm" style="display:grid; grid-template-columns:repeat(2,142px); gap:8px; justify-content:center;"></div>' +
          '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">记住闪烁顺序并复现 · 每轮加一步 · 带音高提示</div>' +
          '<div class="mono" id="sm-msg" style="font-size:13px; margin-top:8px; min-height:1.4em; color:var(--play);">点任意色块开始</div>' +
        '</div>';
      var grid = stage.querySelector('#sm');
      var pads = COLS4.map(function (col, i2) {
        var b = document.createElement('button');
        b.style.cssText = 'width:142px; height:100px; border:1px solid var(--line); cursor:pointer; padding:0; background:color-mix(in srgb, ' + col + ' 35%, var(--surface2)); transition:filter 0.1s;';
        b.addEventListener('click', function () { tap(i2); });
        grid.appendChild(b);
        return b;
      });
      function tone(i2) {
        try {
          if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
          var o = actx.createOscillator(), g2 = actx.createGain();
          o.frequency.value = FREQ[i2];
          o.type = 'triangle';
          g2.gain.setValueAtTime(0.12, actx.currentTime);
          g2.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.35);
          o.connect(g2); g2.connect(actx.destination);
          o.start();
          o.stop(actx.currentTime + 0.4);
        } catch (err) {}
      }
      function flash(i2) {
        pads[i2].style.filter = 'brightness(1.7)';
        tone(i2);
        timers.push(setTimeout(function () { pads[i2].style.filter = ''; }, 260));
      }
      function playback() {
        phase = 'watch';
        stage.querySelector('#sm-msg').textContent = '看好了……';
        seq.forEach(function (v, i2) {
          timers.push(setTimeout(function () {
            flash(v);
            if (i2 === seq.length - 1) {
              timers.push(setTimeout(function () {
                phase = 'input';
                pos = 0;
                stage.querySelector('#sm-msg').textContent = '轮到你（' + seq.length + ' 步）';
              }, 400));
            }
          }, 500 + i2 * 480));
        });
      }
      function next() {
        seq.push(Math.floor(Math.random() * 4));
        stage.querySelector('#sm-l').textContent = 'LEN ' + seq.length;
        playback();
      }
      function tap(i2) {
        if (phase === 'idle') { seq = []; next(); return; }
        if (phase !== 'input') return;
        flash(i2);
        if (i2 !== seq[pos]) {
          phase = 'idle';
          var len = seq.length - 1;
          if (len > best) { best = len; hiSet(K, best); }
          stage.querySelector('#sm-msg').textContent = '断了！记住 ' + len + ' 步 — 点任意色块再来';
          return;
        }
        pos++;
        if (pos >= seq.length) {
          phase = 'watch';
          timers.push(setTimeout(next, 700));
        }
      }
      phase = 'idle';
      seq = [];
      return function () {
        timers.forEach(clearTimeout);
        if (actx) { try { actx.close(); } catch (err) {} }
      };
    }

    /* ---------- 游戏厅 · 游戏 1：帧预算保卫战 ---------- */
    /* 彩纸庆祝：从宿主元素底部两角向上喷彩纸 */
    function confettiBurst(host) {
      var rect = host.getBoundingClientRect();
      var PAD = 90;
      var w = rect.width + PAD * 2, h = rect.height + PAD * 2;
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.style.cssText = 'position:fixed; left:' + (rect.left - PAD) + 'px; top:' + (rect.top - PAD) +
        'px; width:' + w + 'px; height:' + h + 'px; pointer-events:none; z-index:90;';
      document.body.appendChild(cv);
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
        if (!host.isConnected) { cv.remove(); return; }
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
          if (!reduced) b.parentNode.classList.add('win');
          confettiBurst(b.parentNode);
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

    /* ---------- 程序员 · 梯度下降 ---------- */
    function gradientGame(stage) {
      var K = 'yzzn-arc-grad';
      var best = hiGet(K);
      var W = 460, H = 220;
      var ui = arcUI(stage, W, H, '把小球滚进小旗所在的全局最小值 · lr 太小卡局部谷，太大直接发散');
      var ctl = document.createElement('div');
      ctl.className = 'mono';
      ctl.style.cssText = 'display:flex; gap:10px; align-items:center; justify-content:center; margin-top:10px; flex-wrap:wrap; font-size:12px;';
      ctl.innerHTML =
        '<span>lr <b id="gd-lrv" style="display:inline-block; min-width:52px; text-align:left;"></b></span>' +
        '<input id="gd-lr" type="range" min="-30" max="2" value="-14" style="width:150px;" />' +
        '<button type="button" class="pie-btn" id="gd-step">单步 ∇</button>' +
        '<button type="button" class="pie-btn primary" id="gd-run">自动跑</button>' +
        '<button type="button" class="pie-btn" id="gd-new">新地形</button>';
      stage.firstChild.appendChild(ctl);
      var wells, x0, bx, steps, trail, timer = null, xStar, fLo, fHi, done;
      function f(x) {
        var v = 1.6 * (x - 0.5) * (x - 0.5) + 0.35;
        for (var i2 = 0; i2 < wells.length; i2++) {
          var d2 = (x - wells[i2].c) / wells[i2].s;
          v -= wells[i2].d * Math.exp(-0.5 * d2 * d2);
        }
        return v;
      }
      function grad(x) { return (f(x + 1e-4) - f(x - 1e-4)) / 2e-4; }
      function lr() { return Math.pow(10, parseInt(ctl.querySelector('#gd-lr').value, 10) / 10); }
      function px(x) { return 16 + x * (W - 32); }
      function py(fv) { return H - 22 - (fv - fLo) / (fHi - fLo) * (H - 54); }
      function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        ctl.querySelector('#gd-run').textContent = '自动跑';
      }
      function newLand() {
        wells = [];
        var n = 3 + Math.floor(Math.random() * 2);
        for (var i2 = 0; i2 < n; i2++) {
          wells.push({
            c: 0.1 + 0.8 * (i2 + 0.15 + Math.random() * 0.7) / n,
            d: 0.3 + Math.random() * 0.55,
            s: 0.035 + Math.random() * 0.04
          });
        }
        xStar = 0; fLo = 1e9; fHi = -1e9;
        for (var j2 = 0; j2 <= 600; j2++) {
          var fv = f(j2 / 600);
          if (fv < fLo) { fLo = fv; xStar = j2 / 600; }
          if (fv > fHi) fHi = fv;
        }
        x0 = Math.random() < 0.5 ? 0.03 + Math.random() * 0.05 : 0.92 + Math.random() * 0.05;
        reset();
      }
      function reset() {
        bx = x0; steps = 0; trail = []; done = false;
        stop();
        ui.msg.textContent = '';
        draw();
      }
      function draw() {
        var P = pal(), g = ui.g;
        g.clearRect(0, 0, W, H);
        /* 损失曲面 */
        g.strokeStyle = P.ink2; g.lineWidth = 1.5; g.beginPath();
        for (var i2 = 0; i2 <= 300; i2++) {
          var xx = i2 / 300;
          if (i2 === 0) g.moveTo(px(xx), py(f(xx))); else g.lineTo(px(xx), py(f(xx)));
        }
        g.stroke();
        /* 全局最小值小旗 */
        var fx = px(xStar), fy = py(f(xStar));
        g.strokeStyle = P.play; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(fx, fy - 2); g.lineTo(fx, fy - 20); g.stroke();
        g.fillStyle = P.play;
        g.beginPath(); g.moveTo(fx, fy - 20); g.lineTo(fx + 11, fy - 16); g.lineTo(fx, fy - 12); g.closePath(); g.fill();
        /* 轨迹 */
        for (var t2 = 0; t2 < trail.length; t2++) {
          g.globalAlpha = 0.12 + 0.5 * (t2 / trail.length);
          g.fillStyle = P.accent;
          g.beginPath(); g.arc(px(trail[t2]), py(f(trail[t2])), 2.5, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        /* 小球 */
        g.fillStyle = P.accent;
        g.beginPath(); g.arc(px(bx), py(f(bx)) - 5, 6, 0, Math.PI * 2); g.fill();
        ui.s.textContent = 'STEP ' + steps;
        ui.m.textContent = 'loss ' + f(bx).toFixed(3);
        ui.hb.textContent = best ? 'BEST ' + best + ' 步' : '';
        ctl.querySelector('#gd-lrv').textContent = lr() < 0.01 ? lr().toExponential(1) : lr().toFixed(lr() < 0.1 ? 3 : 2);
      }
      function step() {
        if (done) return;
        bx = bx - lr() * grad(bx);
        steps++;
        trail.push(bx);
        if (trail.length > 48) trail.shift();
        if (!isFinite(bx) || bx < -0.25 || bx > 1.25) {
          ui.msg.textContent = '💥 发散了！lr 调小点（本次步数作废）';
          bx = x0; steps = 0; trail = [];
          stop();
        } else if (steps > 1 && Math.abs(lr() * grad(bx)) < 5e-4) {
          if (f(bx) - f(xStar) < 0.02) {
            done = true;
            stop();
            ui.msg.textContent = '🎉 收敛到全局最小值！共 ' + steps + ' 步 — 点「新地形」再来';
            if (!best || steps < best) { best = steps; hiSet(K, best); }
          } else {
            ui.msg.textContent = '卡在局部极小值了 — 调大 lr 冲出去，或换新地形';
          }
        }
        draw();
      }
      ctl.querySelector('#gd-step').addEventListener('click', step);
      ctl.querySelector('#gd-new').addEventListener('click', newLand);
      ctl.querySelector('#gd-lr').addEventListener('input', draw);
      ctl.querySelector('#gd-run').addEventListener('click', function () {
        if (timer) { stop(); return; }
        if (done) return;
        ctl.querySelector('#gd-run').textContent = '停止';
        timer = setInterval(step, 80);
      });
      newLand();
      return function () { stop(); };
    }

    /* ---------- 程序员 · 过拟合警察 ---------- */
    function overfitGame(stage) {
      var K = 'yzzn-arc-overfit';
      var best = hiGet(K);
      var W = 460, H = 210, ROUNDS = 10;
      var ui = arcUI(stage, W, H, '灰点是训练数据，彩线是模型 · 判断它学得怎么样 · 共 10 题');
      var ctl = document.createElement('div');
      ctl.className = 'mono';
      ctl.style.cssText = 'display:flex; gap:10px; justify-content:center; margin-top:10px; flex-wrap:wrap;';
      var LABELS = ['欠拟合', '恰到好处', '过拟合'];
      ctl.innerHTML = LABELS.map(function (t2, i2) {
        return '<button type="button" class="pie-btn" data-a="' + i2 + '">' + t2 + '</button>';
      }).join('');
      stage.firstChild.appendChild(ctl);
      var pts, ans, round, score, lock, over, timers = [];
      var s1, k1, p1, s2, k2, p2;
      function truth(x) { return 0.5 + s1 * Math.sin(k1 * x + p1) + s2 * Math.sin(k2 * x + p2); }
      function px(x) { return 16 + x * (W - 32); }
      function py(y) { return H - 16 - y * (H - 32); }
      function gen() {
        s1 = 0.16 + Math.random() * 0.1; k1 = 5 + Math.random() * 4; p1 = Math.random() * 6.28;
        s2 = 0.05 + Math.random() * 0.05; k2 = 11 + Math.random() * 5; p2 = Math.random() * 6.28;
        pts = [];
        var m = 14;
        for (var i2 = 0; i2 < m; i2++) {
          var x = (i2 + 0.2 + Math.random() * 0.6) / m;
          var n2 = (Math.random() + Math.random() + Math.random() - 1.5) * 0.075;
          pts.push({ x: x, y: Math.max(0.04, Math.min(0.96, truth(x) + n2)) });
        }
        ans = Math.floor(Math.random() * 3);
        lock = false;
        draw(false);
        ui.msg.textContent = '';
      }
      /* 线性最小二乘（欠拟合用） */
      function linFit() {
        var sx = 0, sy = 0, sxx = 0, sxy = 0, n2 = pts.length;
        pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
        var b2 = (n2 * sxy - sx * sy) / (n2 * sxx - sx * sx);
        var a2 = (sy - b2 * sx) / n2;
        return function (x) { return a2 + b2 * x; };
      }
      /* Catmull-Rom 过每个样本点（过拟合用） */
      function splineY(x) {
        var ps = pts;
        if (x <= ps[0].x) return ps[0].y;
        if (x >= ps[ps.length - 1].x) return ps[ps.length - 1].y;
        var i2 = 0;
        while (i2 < ps.length - 2 && ps[i2 + 1].x < x) i2++;
        var p0 = ps[Math.max(0, i2 - 1)], pA = ps[i2], pB = ps[i2 + 1], p3 = ps[Math.min(ps.length - 1, i2 + 2)];
        var t2 = (x - pA.x) / (pB.x - pA.x), tt = t2 * t2, ttt = tt * t2;
        return 0.5 * ((2 * pA.y) + (-p0.y + pB.y) * t2 +
          (2 * p0.y - 5 * pA.y + 4 * pB.y - p3.y) * tt +
          (-p0.y + 3 * pA.y - 3 * pB.y + p3.y) * ttt);
      }
      function modelY(x) {
        if (ans === 0) return linFit()(x);
        if (ans === 1) return truth(x);
        return splineY(x);
      }
      function draw(reveal) {
        var P = pal(), g = ui.g;
        g.clearRect(0, 0, W, H);
        if (reveal && ans !== 1) {
          g.strokeStyle = P.ink2; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath();
          for (var r2 = 0; r2 <= 200; r2++) {
            var xr = r2 / 200;
            if (r2 === 0) g.moveTo(px(xr), py(truth(xr))); else g.lineTo(px(xr), py(truth(xr)));
          }
          g.stroke(); g.setLineDash([]);
        }
        g.strokeStyle = ans === 0 ? P['c-tool'] : ans === 1 ? P.play : P['c-render'];
        g.lineWidth = 2; g.beginPath();
        var first = true;
        for (var i2 = 0; i2 <= 240; i2++) {
          var x = i2 / 240, y = modelY(x);
          if (y < -0.3 || y > 1.3) { first = true; continue; }
          if (first) { g.moveTo(px(x), py(y)); first = false; } else g.lineTo(px(x), py(y));
        }
        g.stroke();
        g.fillStyle = P.ink2;
        pts.forEach(function (p) {
          g.beginPath(); g.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2); g.fill();
        });
        ui.s.textContent = over ? 'DONE' : 'Q ' + round + ' / ' + ROUNDS;
        ui.m.textContent = 'SCORE ' + score;
        ui.hb.textContent = best ? 'HI ' + best + ' 分' : '';
      }
      function answer(i2) {
        if (lock) return;
        if (over) { round = 1; score = 0; over = false; gen(); return; }
        lock = true;
        var okAns = i2 === ans;
        if (okAns) score++;
        draw(true);
        ui.msg.textContent = (okAns ? '✓ 答对了' : '✗ 是「' + LABELS[ans] + '」') + '（虚线为真实规律）';
        timers.push(setTimeout(function () {
          if (round >= ROUNDS) {
            over = true;
            if (score > best) { best = score; hiSet(K, best); }
            ui.msg.textContent = '答对 ' + score + ' / ' + ROUNDS + ' — 点任意按钮再来一轮';
            draw(true);
          } else {
            round++;
            gen();
          }
        }, 1100));
      }
      ctl.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () { answer(parseInt(b.getAttribute('data-a'), 10)); });
      });
      round = 1; score = 0; over = false;
      gen();
      return function () { timers.forEach(clearTimeout); };
    }

    /* ---------- 程序员 · 视锥体剔除 ---------- */
    function frustumGame(stage) {
      var K = 'yzzn-arc-frustum';
      var best = hiGet(K);
      var W = 460, H = 290;
      var ui = arcUI(stage, W, H, '俯视图：把落在视锥内（会被渲染）的物体全部点掉 · 点错 −15 · 60 秒');
      var cam, objs, remain, score, wave, tLeft, tick = null, playing = false;
      function inside(o) {
        var dx = o.x - cam.x, dy = o.y - cam.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < cam.near || d > cam.far) return false;
        var a = Math.atan2(dy, dx) - cam.ang;
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return Math.abs(a) <= cam.fov / 2;
      }
      function newWave() {
        wave++;
        var n = 12 + Math.min(10, wave * 2);
        for (var tries = 0; tries < 60; tries++) {
          cam = {
            x: 70 + Math.random() * (W - 140), y: 70 + Math.random() * (H - 140),
            ang: Math.random() * Math.PI * 2,
            fov: (36 + Math.random() * 36) * Math.PI / 180,
            near: 24 + Math.random() * 18, far: 120 + Math.random() * 85
          };
          objs = [];
          for (var i2 = 0; i2 < n; i2++) {
            objs.push({ x: 12 + Math.random() * (W - 24), y: 12 + Math.random() * (H - 24), st: 0 });
          }
          remain = 0;
          objs.forEach(function (o) { if (inside(o)) remain++; });
          if (remain >= 3 && remain <= n - 4) break;
        }
        while (remain < 3) {
          var d2 = cam.near + (cam.far - cam.near) * (0.2 + Math.random() * 0.6);
          var a2 = cam.ang + (Math.random() - 0.5) * cam.fov * 0.85;
          var ox = cam.x + Math.cos(a2) * d2, oy = cam.y + Math.sin(a2) * d2;
          if (ox > 10 && ox < W - 10 && oy > 10 && oy < H - 10) {
            objs.push({ x: ox, y: oy, st: 0 });
            remain++;
          }
        }
        draw();
      }
      function draw() {
        var P = pal(), g = ui.g;
        g.clearRect(0, 0, W, H);
        if (playing || tLeft <= 0) {
          /* 视锥（近平面到远平面的扇环） */
          var a1 = cam.ang - cam.fov / 2, a2 = cam.ang + cam.fov / 2;
          g.beginPath();
          g.arc(cam.x, cam.y, cam.far, a1, a2);
          g.arc(cam.x, cam.y, cam.near, a2, a1, true);
          g.closePath();
          g.globalAlpha = 0.1; g.fillStyle = P.accent; g.fill();
          g.globalAlpha = 1; g.strokeStyle = P.accent; g.lineWidth = 1.2; g.stroke();
          /* 相机本体 */
          g.fillStyle = P.ink;
          g.save();
          g.translate(cam.x, cam.y); g.rotate(cam.ang);
          g.beginPath(); g.moveTo(8, 0); g.lineTo(-6, -6); g.lineTo(-6, 6); g.closePath(); g.fill();
          g.restore();
          /* 物体 */
          objs.forEach(function (o) {
            if (o.st === 1) {
              g.strokeStyle = P.play; g.lineWidth = 1.5;
              g.strokeRect(o.x - 4, o.y - 4, 8, 8);
              g.beginPath(); g.moveTo(o.x - 3, o.y); g.lineTo(o.x - 1, o.y + 3); g.lineTo(o.x + 4, o.y - 3); g.stroke();
            } else if (o.st === 2) {
              g.strokeStyle = P['c-render']; g.lineWidth = 1.5;
              g.beginPath();
              g.moveTo(o.x - 4, o.y - 4); g.lineTo(o.x + 4, o.y + 4);
              g.moveTo(o.x + 4, o.y - 4); g.lineTo(o.x - 4, o.y + 4);
              g.stroke();
            } else {
              g.fillStyle = P.ink;
              g.fillRect(o.x - 4, o.y - 4, 8, 8);
            }
          });
        } else {
          g.fillStyle = P.ink;
          g.font = '600 16px Consolas,monospace';
          g.textAlign = 'center';
          g.fillText(tLeft === undefined ? '点击开始' : '时间到！得分 ' + score + ' — 点击再来', W / 2, H / 2);
          g.textAlign = 'left';
        }
        ui.s.textContent = 'SCORE ' + (score || 0);
        ui.m.textContent = playing ? 'WAVE ' + wave + ' · 剩 ' + remain + ' · ' + tLeft + 's' : '';
        ui.hb.textContent = best ? 'HI ' + best : '';
      }
      function start() {
        score = 0; wave = 0; tLeft = 60; playing = true;
        newWave();
        tick = setInterval(function () {
          tLeft--;
          if (tLeft <= 0) {
            playing = false;
            clearInterval(tick); tick = null;
            if (score > best) { best = score; hiSet(K, best); }
            ui.msg.textContent = '';
          }
          draw();
        }, 1000);
      }
      ui.cvs.addEventListener('click', function (e) {
        if (!playing) { start(); return; }
        var r2 = ui.cvs.getBoundingClientRect();
        var mx = (e.clientX - r2.left) * (W / r2.width);
        var my = (e.clientY - r2.top) * (H / r2.height);
        var hit = null, hd = 14;
        objs.forEach(function (o) {
          if (o.st) return;
          var d2 = Math.max(Math.abs(o.x - mx), Math.abs(o.y - my));
          if (d2 < hd) { hd = d2; hit = o; }
        });
        if (!hit) return;
        if (inside(hit)) {
          hit.st = 1; score += 10; remain--;
          if (remain <= 0) {
            score += 20;
            ui.msg.textContent = '✓ 本波清空 +20';
            setTimeout(function () { if (playing) { ui.msg.textContent = ''; newWave(); } }, 500);
          }
        } else {
          hit.st = 2;
          score = Math.max(0, score - 15);
          ui.msg.textContent = '✗ 它在视锥外，本来就会被剔除 −15';
          setTimeout(function () { ui.msg.textContent = ''; }, 900);
        }
        draw();
      });
      draw();
      return function () { if (tick) clearInterval(tick); };
    }

    /* ---------- 音乐 · 调音师 ---------- */
    function tunerGame(stage) {
      var K = 'yzzn-arc-tuner';
      var best = hiGet(K);
      var W = 460, H = 110, ROUNDS = 5;
      var ui = arcUI(stage, W, H, '你的弦跑调了 · 「同时播」能听到拍频，拍越慢越准 · 5 轮平均误差');
      var ctl = document.createElement('div');
      ctl.className = 'mono';
      ctl.style.cssText = 'display:flex; gap:10px; align-items:center; justify-content:center; margin-top:10px; flex-wrap:wrap; font-size:12px;';
      ctl.innerHTML =
        '<input id="tn-adj" type="range" min="-600" max="600" value="0" step="5" style="width:230px;" />' +
        '<button type="button" class="pie-btn" id="tn-ref">▶ 标准音</button>' +
        '<button type="button" class="pie-btn" id="tn-you">▶ 你的弦</button>' +
        '<button type="button" class="pie-btn" id="tn-both">▶ 同时播</button>' +
        '<button type="button" class="pie-btn primary" id="tn-ok">调好了</button>';
      stage.firstChild.appendChild(ctl);
      var actx = null, f0, D, round, errs, revealed, over, timers = [];
      function adj() { return parseInt(ctl.querySelector('#tn-adj').value, 10) / 10; }
      function tone(freq, when, dur) {
        try {
          if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
          var o = actx.createOscillator(), g2 = actx.createGain();
          o.type = 'sine';
          o.frequency.value = freq;
          var t2 = actx.currentTime + (when || 0);
          g2.gain.setValueAtTime(0.0001, t2);
          g2.gain.exponentialRampToValueAtTime(0.14, t2 + 0.02);
          g2.gain.exponentialRampToValueAtTime(0.001, t2 + dur);
          o.connect(g2); g2.connect(actx.destination);
          o.start(t2); o.stop(t2 + dur + 0.05);
        } catch (err) {}
      }
      function yourFreq() { return f0 * Math.pow(2, (D + adj()) / 1200); }
      function draw() {
        var P = pal(), g = ui.g;
        g.clearRect(0, 0, W, H);
        var cx = W / 2, y0 = H - 34;
        g.strokeStyle = P.line; g.lineWidth = 1;
        g.beginPath(); g.moveTo(24, y0); g.lineTo(W - 24, y0); g.stroke();
        g.font = '10px Consolas,monospace'; g.textAlign = 'center'; g.fillStyle = P.ink2;
        for (var c2 = -60; c2 <= 60; c2 += 10) {
          var x = cx + c2 / 60 * (W / 2 - 24);
          g.strokeStyle = c2 === 0 ? P.ink : P.line;
          g.beginPath(); g.moveTo(x, y0 - (c2 === 0 ? 12 : c2 % 20 === 0 ? 8 : 5)); g.lineTo(x, y0); g.stroke();
          if (c2 % 20 === 0) g.fillText((c2 > 0 ? '+' : '') + c2, x, y0 + 14);
        }
        /* 完美位置（提交后揭示） */
        if (revealed) {
          var tx = cx + Math.max(-60, Math.min(60, -D)) / 60 * (W / 2 - 24);
          g.fillStyle = P.play;
          g.beginPath(); g.moveTo(tx, y0 - 24); g.lineTo(tx - 5, y0 - 32); g.lineTo(tx + 5, y0 - 32); g.closePath(); g.fill();
        }
        /* 指针 = 你的微调旋钮 */
        var nx = cx + adj() / 60 * (W / 2 - 24);
        g.strokeStyle = P.accent; g.lineWidth = 2;
        g.beginPath(); g.moveTo(nx, y0 - 22); g.lineTo(nx, y0); g.stroke();
        g.fillStyle = P.accent;
        g.fillText((adj() > 0 ? '+' : '') + adj().toFixed(1) + 'c', nx, y0 - 28);
        g.textAlign = 'left';
        ui.s.textContent = over ? 'DONE' : 'ROUND ' + round + ' / ' + ROUNDS;
        ui.m.textContent = f0 ? '基准 ' + f0.toFixed(1) + ' Hz' : '';
        ui.hb.textContent = best ? 'BEST ' + best + ' 音分' : '';
      }
      function newRound() {
        f0 = 220 * Math.pow(2, Math.floor(Math.random() * 25) / 12);
        D = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 47);
        ctl.querySelector('#tn-adj').value = '0';
        revealed = false;
        ui.msg.textContent = '';
        draw();
      }
      function submit() {
        if (over) {
          round = 1; errs = []; over = false;
          newRound();
          return;
        }
        if (revealed) return;
        revealed = true;
        var err = Math.abs(D + adj());
        errs.push(err);
        draw();
        ui.msg.textContent = '本轮误差 ' + err.toFixed(1) + ' 音分' + (err < 3 ? ' — 金耳朵！' : err < 10 ? ' — 很稳' : '');
        timers.push(setTimeout(function () {
          if (round >= ROUNDS) {
            over = true;
            var avg = Math.round(errs.reduce(function (a, b) { return a + b; }, 0) / ROUNDS);
            if (!best || avg < best) { best = avg; hiSet(K, best); }
            ui.msg.textContent = '平均误差 ' + avg + ' 音分（' + errs.map(function (e2) { return e2.toFixed(0); }).join(' / ') + '）— 点「调好了」再来';
            draw();
          } else {
            round++;
            newRound();
          }
        }, 1600));
      }
      ctl.querySelector('#tn-ref').addEventListener('click', function () { tone(f0, 0, 1.2); });
      ctl.querySelector('#tn-you').addEventListener('click', function () { tone(yourFreq(), 0, 1.2); });
      ctl.querySelector('#tn-both').addEventListener('click', function () { tone(f0, 0, 1.8); tone(yourFreq(), 0, 1.8); });
      ctl.querySelector('#tn-ok').addEventListener('click', submit);
      ctl.querySelector('#tn-adj').addEventListener('input', draw);
      round = 1; errs = []; over = false;
      newRound();
      return function () {
        timers.forEach(clearTimeout);
        if (actx) { try { actx.close(); } catch (err) {} }
      };
    }

    /* ---------- 音乐 · 节奏机 ---------- */
    function rhythmGame(stage) {
      var K = 'yzzn-arc-rhythm';
      var best = hiGet(K);
      var W = 460, H = 330;
      var ui = arcUI(stage, W, H, 'D F J K 对应四轨（也可点击轨道） · PERFECT ±55ms · 曲子每局现编');
      var KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'], KLAB = 'DFJK';
      var LANE_W = 74, FIELD = LANE_W * 4, X0 = (W - FIELD) / 2;
      var HITY = H - 46, SPEED = 190, LEAD = 2.2;
      var PENT = [0, 3, 5, 7, 10];
      var actx = null, raf = null, sched = null, noiseBuf = null;
      var notes, evts, evIdx, playing = false, over = false, t0 = 0;
      var score, combo, maxCombo, judges, laneFx, judgeFx, endT;
      function gen() {
        notes = []; evts = [];
        var bpm = 112, beat = 60 / bpm, bars = 28;
        var prog = [0, -4, -9, -2];   /* Am F C G */
        var mel = 3 + Math.floor(Math.random() * 3);
        for (var i2 = 0; i2 < 4; i2++) evts.push({ t: LEAD - (4 - i2) * beat + beat * 0, ty: 'hat', f: 0 });
        for (var b2 = 0; b2 < bars; b2++) {
          var rootF = 110 * Math.pow(2, prog[b2 % 4] / 12);
          for (var q = 0; q < 4; q++) {
            evts.push({ t: LEAD + (b2 * 4 + q) * beat, ty: 'bass', f: q === 0 ? rootF : rootF * (q === 2 ? 1.5 : 1) });
          }
          var dens = b2 < 4 ? 0.4 : b2 < 12 ? 0.55 : b2 < 20 ? 0.68 : 0.78;
          for (var e2 = 0; e2 < 8; e2++) {
            var t2 = LEAD + (b2 * 4 + e2 * 0.5) * beat;
            evts.push({ t: t2, ty: 'hat', f: 0 });
            var want = e2 % 2 === 0 ? dens : dens * 0.55;
            if (b2 >= 1 && Math.random() < want) {
              mel += Math.floor(Math.random() * 3) - 1;
              if (mel < 0) mel = 0;
              if (mel > 9) mel = 9;
              var f = 440 * Math.pow(2, (PENT[mel % 5] + 12 * Math.floor(mel / 5)) / 12);
              var lane = Math.min(3, Math.floor(mel * 4 / 10));
              evts.push({ t: t2, ty: 'mel', f: f });
              notes.push({ t: t2, lane: lane, st: 0 });
            }
          }
        }
        evts.sort(function (a, b) { return a.t - b.t; });
        notes.sort(function (a, b) { return a.t - b.t; });
        endT = notes[notes.length - 1].t + 1.2;
      }
      function synth(ev) {
        var t2 = t0 + ev.t;
        if (ev.ty === 'hat') {
          if (!noiseBuf) {
            noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.04, actx.sampleRate);
            var ch = noiseBuf.getChannelData(0);
            for (var i2 = 0; i2 < ch.length; i2++) ch[i2] = (Math.random() * 2 - 1) * (1 - i2 / ch.length);
          }
          var src = actx.createBufferSource(), hg = actx.createGain(), hp = actx.createBiquadFilter();
          src.buffer = noiseBuf;
          hp.type = 'highpass'; hp.frequency.value = 6000;
          hg.gain.value = 0.05;
          src.connect(hp); hp.connect(hg); hg.connect(actx.destination);
          src.start(t2);
          return;
        }
        var o = actx.createOscillator(), g2 = actx.createGain();
        o.type = ev.ty === 'bass' ? 'sine' : 'square';
        o.frequency.value = ev.f;
        var vol = ev.ty === 'bass' ? 0.1 : 0.045;
        var dur = ev.ty === 'bass' ? 0.32 : 0.22;
        g2.gain.setValueAtTime(0.0001, t2);
        g2.gain.exponentialRampToValueAtTime(vol, t2 + 0.01);
        g2.gain.exponentialRampToValueAtTime(0.001, t2 + dur);
        o.connect(g2); g2.connect(actx.destination);
        o.start(t2); o.stop(t2 + dur + 0.05);
      }
      function now() { return actx.currentTime - t0; }
      function judge(lane) {
        if (!playing) return;
        laneFx[lane] = now();
        var cand = null;
        for (var i2 = 0; i2 < notes.length; i2++) {
          var nt = notes[i2];
          if (nt.st || nt.lane !== lane) continue;
          if (nt.t - now() > 0.14) break;
          if (Math.abs(nt.t - now()) <= 0.14) { cand = nt; break; }
        }
        if (!cand) {
          combo = 0;
          judgeFx = { txt: '✕', col: 'ink2', t: now() };
          return;
        }
        cand.st = 1;
        var d2 = Math.abs(cand.t - now());
        if (d2 <= 0.055) { score += 300; judges.P++; judgeFx = { txt: 'PERFECT', col: 'play', t: now() }; }
        else { score += 100; judges.G++; judgeFx = { txt: 'GOOD', col: 'accent', t: now() }; }
        combo++;
        if (combo > maxCombo) maxCombo = combo;
      }
      function finish() {
        playing = false; over = true;
        if (sched) { clearInterval(sched); sched = null; }
        if (score > best) { best = score; hiSet(K, best); }
        ui.msg.textContent = 'PERFECT ' + judges.P + ' · GOOD ' + judges.G + ' · MISS ' + judges.M +
          ' · 最大连击 ' + maxCombo + ' — 点击再来一曲';
      }
      function draw() {
        var P = pal(), g = ui.g;
        g.clearRect(0, 0, W, H);
        var COLS4 = [P['c-render'], P['c-engine'], P['c-char'], P['c-tool']];
        g.strokeStyle = P.line; g.lineWidth = 1;
        for (var l2 = 0; l2 <= 4; l2++) {
          g.beginPath(); g.moveTo(X0 + l2 * LANE_W, 0); g.lineTo(X0 + l2 * LANE_W, H - 24); g.stroke();
        }
        g.font = '600 13px Consolas,monospace'; g.textAlign = 'center';
        for (var l3 = 0; l3 < 4; l3++) {
          g.fillStyle = P.ink2;
          g.fillText(KLAB[l3], X0 + (l3 + 0.5) * LANE_W, H - 8);
        }
        if (playing) {
          var nw = now();
          /* 按键闪光 */
          for (var l4 = 0; l4 < 4; l4++) {
            var dt2 = nw - laneFx[l4];
            if (dt2 >= 0 && dt2 < 0.16) {
              g.globalAlpha = 0.25 * (1 - dt2 / 0.16);
              g.fillStyle = COLS4[l4];
              g.fillRect(X0 + l4 * LANE_W, HITY - 60, LANE_W, 60);
              g.globalAlpha = 1;
            }
          }
          /* 判定线 */
          g.strokeStyle = P.accent; g.lineWidth = 2;
          g.beginPath(); g.moveTo(X0, HITY); g.lineTo(X0 + FIELD, HITY); g.stroke();
          /* 音符 + 漏接判定 */
          for (var i3 = 0; i3 < notes.length; i3++) {
            var nt = notes[i3];
            if (!nt.st && nw - nt.t > 0.14) { nt.st = 2; combo = 0; judges.M++; judgeFx = { txt: 'MISS', col: 'c-render', t: nw }; }
            if (nt.st) continue;
            var y = HITY - (nt.t - nw) * SPEED;
            if (y < -16 || y > HITY + 30) continue;
            g.fillStyle = COLS4[nt.lane];
            g.fillRect(X0 + nt.lane * LANE_W + 5, y - 6, LANE_W - 10, 12);
          }
          /* 判定文字 + 连击 */
          if (judgeFx && nw - judgeFx.t < 0.5) {
            g.globalAlpha = 1 - (nw - judgeFx.t) / 0.5;
            g.fillStyle = P[judgeFx.col] || P.ink2;
            g.font = '700 17px Consolas,monospace';
            g.fillText(judgeFx.txt, W / 2, HITY - 74);
            g.globalAlpha = 1;
          }
          if (combo >= 5) {
            g.fillStyle = P.ink; g.font = '700 22px Consolas,monospace';
            g.fillText(combo + ' COMBO', W / 2, 40);
          }
          if (nw > endT) finish();
        } else {
          g.fillStyle = P.ink; g.font = '600 15px Consolas,monospace';
          g.fillText(over ? 'FINISH · SCORE ' + score : '点击开始（会出声）', W / 2, H / 2 - 20);
        }
        g.textAlign = 'left';
        ui.s.textContent = 'SCORE ' + (score || 0);
        ui.m.textContent = playing && combo ? 'COMBO ' + combo : '';
        ui.hb.textContent = best ? 'HI ' + best : '';
        raf = requestAnimationFrame(draw);
      }
      function start() {
        try {
          if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
          if (actx.state === 'suspended') actx.resume();
        } catch (err) { ui.msg.textContent = '此环境不支持 WebAudio'; return; }
        gen();
        score = 0; combo = 0; maxCombo = 0;
        judges = { P: 0, G: 0, M: 0 };
        laneFx = [-9, -9, -9, -9]; judgeFx = null;
        evIdx = 0; t0 = actx.currentTime + 0.1;
        playing = true; over = false;
        ui.msg.textContent = '';
        sched = setInterval(function () {
          while (evIdx < evts.length && evts[evIdx].t < now() + 0.6) {
            synth(evts[evIdx]);
            evIdx++;
          }
        }, 120);
      }
      function onKey(e) {
        if (e.repeat) return;
        var lane = KEYS.indexOf(e.code);
        if (lane < 0) return;
        e.preventDefault();
        judge(lane);
      }
      document.addEventListener('keydown', onKey);
      ui.cvs.addEventListener('pointerdown', function (e) {
        if (!playing) { start(); return; }
        var r2 = ui.cvs.getBoundingClientRect();
        var mx = (e.clientX - r2.left) * (W / r2.width);
        var lane = Math.floor((mx - X0) / LANE_W);
        if (lane >= 0 && lane <= 3) judge(lane);
      });
      draw();
      return function () {
        cancelAnimationFrame(raf);
        if (sched) clearInterval(sched);
        document.removeEventListener('keydown', onKey);
        if (actx) { try { actx.close(); } catch (err) {} }
      };
    }

    /* ---------- GameMode: 游戏厅（合集大厅） ---------- */
    var ARC = [
      /* 程序员特供 */
      { id: 'budget',   name: '帧预算保卫战',  cat: 'dev', glyph: '16.7', desc: '接住 render pass，攒满一帧就提交', hiKey: 'yzzn-arcade-hi', start: budgetGame },
      { id: 'bugwhack', name: 'Bug 打地鼠',    cat: 'dev', glyph: 'BUG',  desc: '手起锤落修 bug，小心别打到需求', hiKey: 'yzzn-arc-bug', start: bugGame },
      { id: 'typer',    name: 'Shader 打字员', cat: 'dev', glyph: 'HLSL', desc: '关键字落地之前把它敲出来', hiKey: 'yzzn-arc-typer', start: typerGame },
      { id: 'gradient', name: '梯度下降',      cat: 'dev', glyph: '∇',    desc: '调好学习率，滚进全局最小值', hiKey: 'yzzn-arc-grad', hiLabel: 'BEST', hiSuf: ' 步', start: gradientGame },
      { id: 'overfit',  name: '过拟合警察',    cat: 'dev', glyph: 'FIT',  desc: '一眼识别欠拟合与过拟合', hiKey: 'yzzn-arc-overfit', hiSuf: ' 分', start: overfitGame },
      { id: 'frustum',  name: '视锥体剔除',    cat: 'dev', glyph: 'CULL', desc: '只点视锥内的，手要快', hiKey: 'yzzn-arc-frustum', start: frustumGame },
      /* 经典街机 */
      { id: 'snake',    name: '贪吃蛇',        cat: 'classic', glyph: 'SNK',  desc: '经典中的经典，吃到停不下来', hiKey: 'yzzn-arc-snake', start: snakeGame },
      { id: 'tetris',   name: '俄罗斯方块',    cat: 'classic', glyph: 'TET',  desc: '旋转、消行、心跳加速', hiKey: 'yzzn-arc-tetris', start: tetrisGame },
      { id: 'breakout', name: '打砖块',        cat: 'classic', glyph: 'BRK',  desc: '一球一板，清光五彩砖墙', hiKey: 'yzzn-arc-breakout', start: breakoutGame },
      { id: 'pong',     name: 'PONG',          cat: 'classic', glyph: 'PONG', desc: '1972 年的元祖电子游戏，对面是 AI', start: pongGame },
      { id: 'invaders', name: '太空侵略者',    cat: 'classic', glyph: 'INV',  desc: '一排排降落的外星人，守住底线', hiKey: 'yzzn-arc-invaders', start: invadersGame },
      { id: 'asteroids',name: '小行星',        cat: 'classic', glyph: 'AST',  desc: '惯性飞船 + 会分裂的陨石', hiKey: 'yzzn-arc-asteroids', start: asteroidsGame },
      { id: 'flappy',   name: '像素小鸟',      cat: 'classic', glyph: 'FLP',  desc: '一根手指的暴怒游戏', hiKey: 'yzzn-arc-flappy', start: flappyGame },
      { id: 'dino',     name: '恐龙跑酷',      cat: 'classic', glyph: 'DINO', desc: '断网页面的那只龙，越跑越快', hiKey: 'yzzn-arc-dino', start: dinoGame },
      /* 益智棋盘 */
      { id: 'tex2048',  name: '纹理 2048',     cat: 'puzzle', glyph: '8K',   desc: '合并贴图分辨率，目标合出 8K', hiKey: 'yzzn-arc-tex2048', start: tex2048Game },
      { id: 'jigsaw',   name: '拼图',          cat: 'puzzle', glyph: 'PZL',  desc: '实时抓取网络图片，切块复原', hiKey: 'yzzn-arc-jig4', hiLabel: 'BEST', hiSuf: 's', start: jigsawGame },
      { id: 'mines',    name: '扫雷',          cat: 'puzzle', glyph: 'MINE', desc: '9×9 · 10 雷，首翻必安全', hiKey: 'yzzn-arc-mines', hiLabel: 'BEST', hiSuf: 's', start: minesGame },
      { id: 'memory',   name: '翻牌记忆',      cat: 'puzzle', glyph: 'MEM',  desc: '翻出所有配对的数学符号', hiKey: 'yzzn-arc-memory', hiLabel: 'BEST', hiSuf: ' 步', start: memoryGame },
      { id: 'slide15',  name: '数字华容道',    cat: 'puzzle', glyph: '15',   desc: '滑动方块排成 1~15', hiKey: 'yzzn-arc-slide15', hiLabel: 'BEST', hiSuf: 's', start: slide15Game },
      { id: 'maze',     name: '迷宫',          cat: 'puzzle', glyph: 'MAZE', desc: '每局随机生成，走到右下角', hiKey: 'yzzn-arc-maze', hiLabel: 'BEST', hiSuf: 's', start: mazeGame },
      { id: 'ttt',      name: '井字棋',        cat: 'puzzle', glyph: 'XO',   desc: '对手是不会失误的 Minimax', start: tttGame },
      { id: 'gomoku',   name: '五子棋',        cat: 'puzzle', glyph: '五',   desc: '13 路棋盘，AI 会堵你的活三', start: gomokuGame },
      /* 反应记忆 */
      { id: 'nback',    name: 'N-back 训练',   cat: 'brain', glyph: 'N-bk', desc: '工作记忆测验，认知科学经典', hiKey: 'yzzn-arc-nback', hiSuf: '%', start: nbackGame },
      { id: 'reaction', name: '反应力测试',    cat: 'brain', glyph: 'MS',   desc: '变绿就点，5 轮取平均', hiKey: 'yzzn-arc-reaction', hiLabel: 'BEST', hiSuf: 'ms', start: reactionGame },
      { id: 'simon',    name: 'Simon 序列',    cat: 'brain', glyph: 'SIM',  desc: '记住闪烁与音高的顺序', hiKey: 'yzzn-arc-simon', start: simonGame },
      /* 音乐 */
      { id: 'tuner',    name: '调音师',        cat: 'music', glyph: '440',  desc: '凭耳朵把失谐的音调准', hiKey: 'yzzn-arc-tuner', hiLabel: 'BEST', hiSuf: ' 音分', start: tunerGame },
      { id: 'rhythm',   name: '节奏机',        cat: 'music', glyph: '4/4',  desc: '四轨下落式音游，曲子每局现编', hiKey: 'yzzn-arc-rhythm', start: rhythmGame }
    ];
    var ARC_CATS = {
      dev: ['程序员特供', '--c-render'],
      classic: ['经典街机', '--c-tool'],
      puzzle: ['益智棋盘', '--c-char'],
      brain: ['反应记忆', '--c-ai'],
      music: ['音乐', '--c-life']
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

    /* ---------- 阅读进度条（仅文章页） ---------- */
    if (document.querySelector('.md-body')) {
      var rpBar = document.createElement('div');
      rpBar.id = 'read-progress';
      document.body.appendChild(rpBar);
      var btt = document.createElement('button');
      btt.id = 'back-top';
      btt.className = 'mono';
      btt.type = 'button';
      btt.textContent = '↑ TOP';
      btt.setAttribute('aria-label', '返回顶部');
      btt.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      });
      document.body.appendChild(btt);
      var rpTick = false;
      window.addEventListener('scroll', function () {
        if (rpTick) return;
        rpTick = true;
        requestAnimationFrame(function () {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          rpBar.style.width = (max > 0 ? (window.scrollY / max * 100) : 0) + '%';
          btt.classList.toggle('show', window.scrollY > 600);
          rpTick = false;
        });
      }, { passive: true });

      /* 代码块复制按钮 */
      document.querySelectorAll('.md-body pre').forEach(function (pre) {
        var btn = document.createElement('button');
        btn.className = 'code-copy mono';
        btn.type = 'button';
        btn.textContent = '复制';
        btn.addEventListener('click', function () {
          var code = pre.querySelector('code');
          var txt = code ? code.textContent : pre.textContent;
          function ok() {
            btn.textContent = '✓ 已复制';
            setTimeout(function () { btn.textContent = '复制'; }, 1400);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(ok, ok);
          } else {
            var ta = document.createElement('textarea');
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (err) {}
            ta.remove();
            ok();
          }
        });
        pre.appendChild(btn);
      });

      /* 站外链接新窗口打开 */
      document.querySelectorAll('.md-body a[href^="http"]').forEach(function (a) {
        if (a.hostname !== location.hostname) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
      });
    }

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
