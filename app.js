/* =========================================================
   东坡 · AI 对话
   - 建议问题轮换 / 自由提问关键词匹配
   - 逐字显示 + 语音同步
   - 播放器：播放暂停 / 进度 / 重播 / 倍速
   - 静音、全屏
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var D = (window.DIALOGUES || []).filter(function (d) { return d && d.id; });
  var greeting = D.filter(function (d) { return d.id === '00-greeting'; })[0];
  var fallback = D.filter(function (d) { return d.fallback; })[0] || D[D.length - 1];
  var pool = D.filter(function (d) {
    return !d.fallback && d.id !== '00-greeting';
  });

  var SPEEDS = [1, 1.25, 1.5];

  var state = {
    started: false,
    muted: false,
    speed: 1,
    chipIndex: 0,
    busy: false,
    current: null
  };

  var el = {
    scene: $('#scene'),
    log: $('#log'),
    chips: $('#chips'),
    shuffle: $('#btnShuffle'),
    start: $('#start'),
    btnStart: $('#btnStart'),
    composer: $('#composer'),
    input: $('#ask'),
    player: $('#player'),
    play: $('#btnPlay'),
    bar: $('#bar'),
    fill: $('#barFill'),
    time: $('#time'),
    replay: $('#btnReplay'),
    speed: $('#btnSpeed'),
    mute: $('#btnMute'),
    full: $('#btnFull')
  };

  var audio = new Audio();
  audio.preload = 'auto';

  /* ---------- 台词渲染 ---------- */

  function addMessage(kind, text) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + kind;
    if (kind === 'ai') {
      var who = document.createElement('div');
      who.className = 'who';
      who.textContent = '苏轼';
      wrap.appendChild(who);
    }
    var p = document.createElement('p');
    p.className = 'text';
    p.textContent = text || '';
    wrap.appendChild(p);
    el.log.appendChild(wrap);
    el.log.scrollTop = el.log.scrollHeight;
    return p;
  }

  function typeInto(node, text, done) {
    var i = 0;
    node.textContent = '';
    var caret = document.createElement('span');
    caret.className = 'caret';
    node.appendChild(caret);
    var timer = window.setInterval(function () {
      i += 1;
      node.firstChild && node.textContent; // noop guard
      node.textContent = text.slice(0, i);
      node.appendChild(caret);
      el.log.scrollTop = el.log.scrollHeight;
      if (i >= text.length) {
        window.clearInterval(timer);
        if (caret.parentNode) { caret.parentNode.removeChild(caret); }
        if (done) { done(); }
      }
    }, 30);
    return function cancel() {
      window.clearInterval(timer);
      node.textContent = text;
      if (caret.parentNode) { caret.parentNode.removeChild(caret); }
    };
  }

  /* ---------- 播放器 ---------- */

  function fmt(sec) {
    if (!isFinite(sec)) { return '0:00'; }
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function syncPlayer() {
    var d = audio.duration || 0;
    var t = audio.currentTime || 0;
    var pct = d ? (t / d) * 100 : 0;
    el.fill.style.width = pct + '%';
    el.time.textContent = fmt(t) + ' / ' + fmt(d);
    el.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    el.play.textContent = audio.paused ? '▶' : '❚❚';
    el.play.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
  }

  function showPlayer(on) {
    el.player.hidden = !on;
  }

  function playDialogue(d) {
    stopSpeaking();
    state.current = d;
    audio.src = (window.AUDIO_DATA && window.AUDIO_DATA[d.id]) || ('audio/' + d.id + '.mp3');
    audio.playbackRate = state.speed;
    audio.muted = state.muted;
    showPlayer(true);
    var p = audio.play();
    if (p && p.catch) { p.catch(function () { /* 自动播放被拒时保持暂停态 */ }); }
    syncPlayer();
  }

  function stopSpeaking() {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (e) { /* ignore */ }
  }

  audio.addEventListener('timeupdate', syncPlayer);
  audio.addEventListener('loadedmetadata', syncPlayer);
  audio.addEventListener('ended', function () {
    el.play.textContent = '▶';
    el.fill.style.width = '100%';
  });

  el.play.addEventListener('click', function () {
    if (audio.paused) {
      var p = audio.play();
      if (p && p.catch) { p.catch(function () {}); }
    } else {
      audio.pause();
    }
    syncPlayer();
  });

  el.replay.addEventListener('click', function () {
    audio.currentTime = 0;
    var p = audio.play();
    if (p && p.catch) { p.catch(function () {}); }
    syncPlayer();
  });

  el.speed.addEventListener('click', function () {
    var i = (SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length;
    state.speed = SPEEDS[i];
    audio.playbackRate = state.speed;
    el.speed.textContent = state.speed.toFixed(1).replace(/\.0$/, '.0') + '×';
  });

  el.bar.addEventListener('click', function (ev) {
    var rect = el.bar.getBoundingClientRect();
    var ratio = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
    if (audio.duration) { audio.currentTime = ratio * audio.duration; }
    syncPlayer();
  });

  el.bar.addEventListener('keydown', function (ev) {
    if (!audio.duration) { return; }
    if (ev.key === 'ArrowRight') { audio.currentTime = Math.min(audio.currentTime + 2, audio.duration); }
    if (ev.key === 'ArrowLeft') { audio.currentTime = Math.max(audio.currentTime - 2, 0); }
    syncPlayer();
  });

  /* ---------- 对话流程 ---------- */

  var cancelTyping = null;

  function answer(d, questionText) {
    if (state.busy) { return; }
    state.busy = true;
    el.composer.querySelector('button').disabled = true;

    if (questionText) { addMessage('me', questionText); }

    var thinking = addMessage('ai', '');
    thinking.parentNode.classList.add('thinking');

    window.setTimeout(function () {
      thinking.parentNode.classList.remove('thinking');
      if (cancelTyping) { cancelTyping(); }
      cancelTyping = typeInto(thinking, d.a, function () {
        state.busy = false;
        el.composer.querySelector('button').disabled = false;
      });
      playDialogue(d);
    }, 520);
  }

  function matchAnswer(text) {
    var q = String(text || '').toLowerCase();
    var best = null;
    var bestScore = 0;
    D.forEach(function (d) {
      if (!d.keywords || !d.keywords.length) { return; }
      var score = 0;
      d.keywords.forEach(function (k) {
        if (k && q.indexOf(k.toLowerCase()) !== -1) { score += k.length; }
      });
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best || fallback;
  }

  /* ---------- 推荐问题 ---------- */

  function renderChips() {
    el.chips.innerHTML = '';
    var total = pool.length;
    var count = Math.min(3, total);
    for (var i = 0; i < count; i += 1) {
      var d = pool[(state.chipIndex + i) % total];
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = d.q;
      b.style.animationDelay = (i * 60) + 'ms';
      (function (item) {
        b.addEventListener('click', function () {
          if (state.busy) { return; }
          answer(item, item.q);
        });
      })(d);
      el.chips.appendChild(b);
    }
  }

  el.shuffle.addEventListener('click', function () {
    state.chipIndex = (state.chipIndex + 3) % pool.length;
    renderChips();
  });

  /* ---------- 输入 ---------- */

  el.composer.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var text = el.input.value.trim();
    if (!text || state.busy) { return; }
    el.input.value = '';
    var d = matchAnswer(text);
    answer(d, text);
  });

  /* ---------- 开始 ---------- */

  function startExperience() {
    if (state.started) { return; }
    state.started = true;
    el.start.classList.add('is-hidden');
    window.setTimeout(function () {
      var d = greeting || pool[0];
      var p = addMessage('ai', '');
      var cancel = typeInto(p, d.a, null);
      cancelTyping = cancel;
      playDialogue(d);
    }, 260);
  }

  el.btnStart.addEventListener('click', startExperience);

  /* ---------- 静音 / 全屏 ---------- */

  el.mute.addEventListener('click', function () {
    state.muted = !state.muted;
    audio.muted = state.muted;
    el.mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
  });

  el.full.addEventListener('click', function () {
    var doc = document;
    var root = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (!root) {
      var target = el.scene;
      var req = target.requestFullscreen || target.webkitRequestFullscreen;
      if (req) { req.call(target); }
    } else {
      var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) { exit.call(doc); }
    }
  });

  /* ---------- 初始化 ---------- */

  renderChips();
  showPlayer(false);
  el.speed.textContent = '1.0×';

  // 视频在部分环境下可能暂停，兜底重播
  var figure = $('#figure');
  if (figure) {
    var kick = function () {
      var p = figure.play();
      if (p && p.catch) { p.catch(function () {}); }
    };
    figure.addEventListener('canplay', kick, { once: true });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { kick(); }
    });
  }
})();
