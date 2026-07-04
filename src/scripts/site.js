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
    /* 雷声：跟随闪电触发，条数越多越响，延迟模拟距离 */
    function thunder(strikes) {
      if (!sndOn || !AC) return;
      var ctx = AC;
      setTimeout(function () {
        var src = ctx.createBufferSource();
        src.buffer = sndNoise;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.Q.value = 0.6;
        var g = ctx.createGain();
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        var t = ctx.currentTime;
        var peak = Math.min(0.16 + strikes * 0.05, 0.4);
        f.frequency.setValueAtTime(420, t);
        f.frequency.exponentialRampToValueAtTime(70, t + 2.4);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
        src.start(t);
        src.stop(t + 2.8);
      }, 250 + Math.random() * 1200);
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

    /* ---------- GameMode: 摸鱼 · 电子鱼缸 ---------- */
    GM.idle = {
      bp: 'Idle', zh: '摸鱼 · 电子鱼缸',
      start: function (stage) {
        hudSuspend = true;
        var W = Math.min(760, window.innerWidth - 60);
        var H = Math.min(430, window.innerHeight - 230);
        var touched = 0;
        try { touched = parseInt(localStorage.getItem('yzzn-fish') || '0', 10); } catch (err) {}
        stage.innerHTML =
          '<div style="text-align:center;">' +
            '<canvas id="fx-cv" style="border:1px solid var(--line); background:var(--surface); max-width:94vw;"></canvas>' +
            '<div class="mono" style="font-size:11.5px; color:var(--ink2); margin-top:10px;">点击水面撒饲料 · 点到鱼身上就是字面意义的摸鱼</div>' +
            '<div class="mono" id="fx-n" style="font-size:12.5px; margin-top:6px; color:var(--ink);"></div>' +
          '</div>';
        var cvs = stage.querySelector('#fx-cv');
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        cvs.width = W * dpr; cvs.height = H * dpr;
        cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
        var g = cvs.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var nEl = stage.querySelector('#fx-n');
        function hud() { nEl.textContent = '累计摸鱼 ' + touched + ' 次'; }
        hud();

        var cs = getComputedStyle(document.body);
        function tk(k) {
          var v = cs.getPropertyValue(k).trim();
          return (!v || v === 'transparent') ? cs.getPropertyValue('--accent').trim() : v;
        }
        var FCOLS = [tk('--c-render'), tk('--c-tool'), tk('--c-char'), tk('--c-ai'), tk('--c-life'), tk('--accent')];
        var INK = tk('--ink'), INK2 = tk('--ink2');

        var fishes = [], foods = [], bubbles = [], floats = [];
        for (var i = 0; i < 8; i++) {
          fishes.push({
            x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (H - 80),
            a: Math.random() * 6.28, spd: 34 + Math.random() * 30,
            size: 9 + Math.random() * 7, c: FCOLS[i % FCOLS.length],
            ph: Math.random() * 6.28, burst: 0
          });
        }
        function onClick(e) {
          var r = cvs.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width * W;
          var y = (e.clientY - r.top) / r.height * H;
          for (var i = 0; i < fishes.length; i++) {
            var f = fishes[i];
            var dx = f.x - x, dy = f.y - y;
            if (dx * dx + dy * dy < (f.size * 2.4) * (f.size * 2.4)) {
              touched++;
              try { localStorage.setItem('yzzn-fish', String(touched)); } catch (err) {}
              hud();
              f.burst = 1.2;
              f.a = Math.atan2(dy, dx);   /* 朝远离手指的方向窜 */
              floats.push({ x: x, y: y, t: 0, txt: '+1' });
              for (var b = 0; b < 4; b++) bubbles.push({ x: f.x, y: f.y, vy: 30 + Math.random() * 40, r: 1.5 + Math.random() * 2, ph: Math.random() * 6 });
              return;
            }
          }
          foods.push({ x: x, y: Math.min(y, 12), vy: 26, tx: x });
        }
        cvs.addEventListener('click', onClick);

        var raf = null, prev = 0;
        function loop(ts) {
          raf = requestAnimationFrame(loop);
          var dt = Math.min((ts - prev) / 1000, 0.05);
          prev = ts;
          var t = ts / 1000;
          g.clearRect(0, 0, W, H);
          /* 水草 */
          g.strokeStyle = INK2; g.globalAlpha = 0.25; g.lineWidth = 2;
          for (var w = 0; w < 5; w++) {
            var wx = 40 + w * (W - 80) / 4;
            g.beginPath();
            g.moveTo(wx, H);
            g.quadraticCurveTo(wx + Math.sin(t * 0.8 + w) * 10, H - 30, wx + Math.sin(t * 0.8 + w) * 20, H - 58 - w * 6);
            g.stroke();
          }
          g.globalAlpha = 1;
          /* 饲料 */
          for (var fi = foods.length - 1; fi >= 0; fi--) {
            var fd = foods[fi];
            fd.y += fd.vy * dt;
            fd.x = fd.tx + Math.sin(fd.y * 0.12) * 4;
            if (fd.y > H - 6) { foods.splice(fi, 1); continue; }
            g.fillStyle = INK;
            g.fillRect(fd.x - 1.5, fd.y - 1.5, 3, 3);
          }
          /* 鱼 */
          fishes.forEach(function (f) {
            var speed = f.spd * (1 + f.burst * 2.2);
            if (f.burst > 0) f.burst = Math.max(0, f.burst - dt);
            /* 追最近的饲料 */
            var tgt = null, td = 1e9;
            foods.forEach(function (fd) {
              var d = (fd.x - f.x) * (fd.x - f.x) + (fd.y - f.y) * (fd.y - f.y);
              if (d < td) { td = d; tgt = fd; }
            });
            if (tgt && f.burst <= 0) {
              var want = Math.atan2(tgt.y - f.y, tgt.x - f.x);
              var diff = Math.atan2(Math.sin(want - f.a), Math.cos(want - f.a));
              f.a += diff * Math.min(1, 3 * dt);
              if (td < 90) {
                foods.splice(foods.indexOf(tgt), 1);
                f.size = Math.min(f.size + 0.25, 22);
                bubbles.push({ x: f.x, y: f.y, vy: 35, r: 2, ph: 0 });
              }
            } else {
              f.a += (Math.random() - 0.5) * 1.4 * dt;
            }
            /* 靠边缘转向 */
            if (f.x < 30) f.a += (0 - Math.cos(f.a) < 0 ? 0.08 : -0.08) + 0.06 * (Math.sin(f.a) > 0 ? -1 : 1), f.a = Math.atan2(Math.sin(f.a), Math.abs(Math.cos(f.a)));
            if (f.x > W - 30) f.a = Math.atan2(Math.sin(f.a), -Math.abs(Math.cos(f.a)));
            if (f.y < 26) f.a = Math.atan2(Math.abs(Math.sin(f.a)), Math.cos(f.a));
            if (f.y > H - 26) f.a = Math.atan2(-Math.abs(Math.sin(f.a)), Math.cos(f.a));
            f.x += Math.cos(f.a) * speed * dt;
            f.y += Math.sin(f.a) * speed * dt;
            f.ph += dt * (6 + f.burst * 14);
            /* 绘制 */
            g.save();
            g.translate(f.x, f.y);
            g.rotate(f.a);
            g.fillStyle = f.c;
            g.globalAlpha = 0.9;
            g.beginPath();
            g.ellipse(0, 0, f.size * 1.5, f.size * 0.75, 0, 0, 6.2832);
            g.fill();
            var flap = Math.sin(f.ph) * f.size * 0.5;
            g.beginPath();
            g.moveTo(-f.size * 1.3, 0);
            g.lineTo(-f.size * 2.1, -f.size * 0.6 + flap);
            g.lineTo(-f.size * 2.1, f.size * 0.6 + flap);
            g.closePath();
            g.fill();
            g.globalAlpha = 1;
            g.fillStyle = INK;
            g.beginPath();
            g.arc(f.size * 0.9, -f.size * 0.18, Math.max(1.4, f.size * 0.12), 0, 6.2832);
            g.fill();
            g.restore();
          });
          /* 气泡 */
          if (Math.random() < dt * 0.8) bubbles.push({ x: Math.random() * W, y: H - 4, vy: 22 + Math.random() * 26, r: 1 + Math.random() * 2.5, ph: Math.random() * 6 });
          g.strokeStyle = INK2;
          for (var bi = bubbles.length - 1; bi >= 0; bi--) {
            var bb = bubbles[bi];
            bb.y -= bb.vy * dt;
            bb.ph += dt * 3;
            if (bb.y < -5) { bubbles.splice(bi, 1); continue; }
            g.globalAlpha = 0.4;
            g.beginPath();
            g.arc(bb.x + Math.sin(bb.ph) * 3, bb.y, bb.r, 0, 6.2832);
            g.stroke();
          }
          g.globalAlpha = 1;
          /* +1 漂字 */
          g.font = '600 13px Consolas, monospace';
          g.textAlign = 'center';
          for (var li = floats.length - 1; li >= 0; li--) {
            var fl = floats[li];
            fl.t += dt;
            if (fl.t > 1) { floats.splice(li, 1); continue; }
            g.fillStyle = INK;
            g.globalAlpha = 1 - fl.t;
            g.fillText(fl.txt, fl.x, fl.y - fl.t * 26);
          }
          g.globalAlpha = 1;
        }
        raf = requestAnimationFrame(function (ts) { prev = ts; loop(ts); });
        return function cleanup() {
          if (raf) cancelAnimationFrame(raf);
          cvs.removeEventListener('click', onClick);
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

    /* ---------- GameMode: 游戏厅（合集大厅） ---------- */
    var ARC = [
      /* 程序员特供 */
      { id: 'budget',   name: '帧预算保卫战',  cat: 'dev', glyph: '16.7', desc: '接住 render pass，攒满一帧就提交', hiKey: 'yzzn-arcade-hi', start: budgetGame },
      { id: 'bugwhack', name: 'Bug 打地鼠',    cat: 'dev', glyph: 'BUG',  desc: '手起锤落修 bug，小心别打到需求', hiKey: 'yzzn-arc-bug', start: bugGame },
      { id: 'typer',    name: 'Shader 打字员', cat: 'dev', glyph: 'HLSL', desc: '关键字落地之前把它敲出来', hiKey: 'yzzn-arc-typer', start: typerGame },
      { id: 'gradient', name: '梯度下降',      cat: 'dev', glyph: '∇',    desc: '调好学习率，滚进全局最小值', wip: true },
      { id: 'overfit',  name: '过拟合警察',    cat: 'dev', glyph: 'FIT',  desc: '一眼识别欠拟合与过拟合', wip: true },
      { id: 'frustum',  name: '视锥体剔除',    cat: 'dev', glyph: 'CULL', desc: '只点视锥内的，手要快', wip: true },
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
      { id: 'tuner',    name: '调音师',        cat: 'music', glyph: '440',  desc: '凭耳朵把失谐的音调准', wip: true },
      { id: 'rhythm',   name: '节奏机',        cat: 'music', glyph: '4/4',  desc: '四轨下落式音游', wip: true }
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
