/*
 * Tripod mode (beta) — prop the phone up, press start, and it takes the
 * whole set on a timer with three seconds between shots.
 *
 * This is the one flow that cannot use <input capture>: handing off to the
 * camera app means a tap and a "Use Photo" for every shot. So it opens the
 * camera in the page with getUserMedia and grabs frames off the video.
 *
 * Two things shape the design:
 *
 *  - For three of the four shots you are turned away and cannot see the
 *    screen. The interface is therefore sound — a spoken cue, a tick per
 *    second, a shutter click — and the screen is only a repeat of it.
 *
 *  - The preview is NOT mirrored. A mirror is the friendlier way to show
 *    someone their own face, but here it would flip left and right: a
 *    left-side shot saved mirrored is a right-side shot. What you see is
 *    what gets saved, and it matches the dashed guide.
 */
window.HairSelfieTripod = (function () {
  'use strict';

  var SECONDS = 3;            // between shots

  /*
   * There is deliberately no lead-in countdown. Pressing the button is
   * how you say you are set, and the first angle's own countdown starts
   * straight away — counting down twice in a row before the first photo
   * just made people wait through the same three seconds twice.
   */

  /*
   * What to do, in two words, said and shown identically.
   *
   * Note which way each one turns: putting your LEFT ear to the camera
   * means turning to your RIGHT. So the left-side photo is "turn right".
   * It reads like a mistake and is not one — the slot name says what the
   * photo is, the instruction says what to do, and they are opposites by
   * definition.
   */
  /*
   * On screen: one word and a moving arrow, because in three seconds you
   * are glancing, not reading. Out loud: the direction as well, since the
   * whole point of the spoken cue is the shots where you cannot see the
   * screen at all.
   */
  var CUE = {
    front: { act: 'Front', say: 'Front',       arrow: null },
    left:  { act: 'Turn',  say: 'Turn right',  arrow: 'right' },
    right: { act: 'Turn',  say: 'Turn left',   arrow: 'left' },
    back:  { act: 'Turn',  say: 'Turn around', arrow: 'around' }
  };

  /*
   * The arrow points the way the words say. It is there to be read at a
   * glance from across the room, not to be worked out — so it never says
   * anything the text does not.
   */
  var ARROW = {
    right:  'M3 12h15M12.5 5.5 19 12l-6.5 6.5',
    left:   'M21 12H6M11.5 5.5 5 12l6.5 6.5',
    around: 'M4 20V12a7 7 0 0 1 14 0v8M13 15.5 18 20.5l5-5'
  };

  function arrowSvg(dir) {
    if (!dir || !ARROW[dir]) return '';
    return '<svg class="tripod-arrow is-' + dir + '" viewBox="0 0 24 24" aria-hidden="true">' +
           '<path d="' + ARROW[dir] + '" fill="none" stroke="currentColor" ' +
           'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function supported() {
    return !!(navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia &&
              window.isSecureContext !== false);
  }

  /* ── sound ───────────────────────────────────────────────────── */

  var actx = null;

  /* Must be called from a tap the first time, or iOS keeps it suspended. */
  function audio() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!actx && C) actx = new C();
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }

  function beep(freq, ms, level) {
    var a = actx;
    if (!a || !soundOn()) return;
    try {
      var osc = a.createOscillator();
      var gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = level;
      osc.connect(gain).connect(a.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + ms / 1000);
      osc.stop(a.currentTime + ms / 1000);
    } catch (e) { /* sound is a courtesy, never a blocker */ }
  }

  function tick() { beep(760, 80, 0.12); }
  function shutter() {
    beep(1600, 45, 0.18);
    setTimeout(function () { beep(950, 70, 0.14); }, 50);
  }

  var SOUND_KEY = 'hairselfie.tripod.sound';

  /*
   * One switch for everything audible — the cue, the per-second ticks and
   * the shutter — and off unless asked for. A phone that starts beeping
   * and talking on its own is a surprise, and the countdown is already on
   * the screen for anyone watching it.
   */
  function soundOn() {
    try { return localStorage.getItem(SOUND_KEY) === 'on'; } catch (e) { return false; }
  }

  function setSound(on) {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  }

  function say(text) {
    try {
      if (!soundOn()) return;
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ditto */ }
  }

  function hush() {
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  /* ── the screen ──────────────────────────────────────────────── */

  var ui = null;

  function build() {
    if (ui) return ui;
    var root = document.createElement('div');
    root.className = 'tripod';
    root.id = 'tripod';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Tripod mode');
    root.innerHTML =
      '<div class="tripod-card">' +
        '<div class="tripod-head">' +
          '<h3>Tripod mode <span class="beta">BETA</span></h3>' +
          '<button type="button" class="btn btn-small" data-act="close">Close</button>' +
        '</div>' +
        '<div class="tripod-stage">' +
          '<video class="tripod-video" playsinline autoplay muted></video>' +
          '<div class="tripod-guide" aria-hidden="true"></div>' +
          '<div class="tripod-label" aria-hidden="true" hidden></div>' +
          '<div class="tripod-count" aria-hidden="true"></div>' +
          '<div class="tripod-review" hidden></div>' +
          '<div class="tripod-flash" aria-hidden="true"></div>' +
        '</div>' +
        '<p class="tripod-cue" aria-live="polite"></p>' +
        /* directly under the picture: on a phone the thumbnails used to
           push this off the bottom of the screen */
        '<div class="tripod-actions">' +
          '<button type="button" class="btn btn-primary btn-big" data-act="use" hidden>Use these photos</button>' +
          '<button type="button" class="btn btn-primary btn-big" data-act="start">Start</button>' +
        '</div>' +
        '<label class="tripod-voice"><input type="checkbox" data-act="sound"> ' +
          'Say each one out loud</label>' +
      '</div>';
    document.body.appendChild(root);
    ui = {
      root: root,
      video: root.querySelector('.tripod-video'),
      guide: root.querySelector('.tripod-guide'),
      label: root.querySelector('.tripod-label'),
      count: root.querySelector('.tripod-count'),
      flash: root.querySelector('.tripod-flash'),
      cue: root.querySelector('.tripod-cue'),
      review: root.querySelector('.tripod-review'),
      start: root.querySelector('[data-act="start"]'),
      use: root.querySelector('[data-act="use"]'),
      voice: root.querySelector('[data-act="sound"]'),
      close: root.querySelector('[data-act="close"]')
    };
    ui.voice.checked = soundOn();
    ui.voice.addEventListener('change', function () {
      setSound(ui.voice.checked);
      if (!ui.voice.checked) hush();
    });
    return ui;
  }

  /* ── capture ─────────────────────────────────────────────────── */

  /*
   * Straight off the video, at whatever the camera is giving us, with no
   * transform of any kind — see the note at the top about mirroring.
   *
   * Taking the frame and encoding it are separate on purpose. The draw is
   * instant and happens the moment the countdown ends; the JPEG encode
   * takes a few hundred milliseconds and happens afterwards, off to one
   * side. If the encode sat in the way, every gap would be three seconds
   * plus however long it took, and the rhythm you are turning to would
   * drift. It is a metronome or it is nothing.
   */
  function snap(video) {
    var w = video.videoWidth || 720;
    var h = video.videoHeight || 960;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return canvas;
  }

  function encode(canvas, key) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(new File([blob], 'tripod-' + key + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    });
  }

  /* ── the run ─────────────────────────────────────────────────── */

  function run(opts) {
    opts = opts || {};
    var defs = opts.defs || [];
    var seconds = opts.seconds || SECONDS;
    var u = build();

    var stream = null;
    var wakeLock = null;
    var timer = null;
    var cancelled = false;
    var shots = {};       // key → File
    var thumbs = {};      // key → object URL
    var encoding = [];    // encodes still running behind the countdown
    var settle = null;

    function cueFor(def) {
      if (defs.length === 1) return { act: 'Front', say: 'Front', arrow: null };
      return CUE[def.key] || { act: def.label, say: def.label, arrow: null };
    }

    function setCue(title, detail) {
      u.cue.innerHTML = '<b>' + title + '</b>' + (detail ? '<span>' + detail + '</span>' : '');
    }

    /* What to do, over the picture and as large as it will go, and nothing
       else. Which photo it belongs to is on the thumbnail below; up here
       it was one more thing to read while trying to hold a pose. */
    function setLabel(cue) {
      if (!cue) { u.label.hidden = true; u.label.innerHTML = ''; return; }
      var arrow = arrowSvg(cue.arrow);
      /* a left arrow leads, the others follow — so the arrow sits on the
         side of the words it is pointing towards */
      var inner = cue.arrow === 'left' ? arrow + cue.act : cue.act + arrow;
      u.label.hidden = false;
      u.label.innerHTML = '<b data-arrow="' + (cue.arrow || 'none') + '">' + inner + '</b>';
    }

    function showGuide(def) {
      u.guide.innerHTML = def && window.Outlines
        ? Outlines.svgMarkup(def.outline, def.mirror)
        : '';
    }

    function flash() {
      u.flash.classList.remove('is-on');
      /* reading offsetWidth restarts the animation */
      void u.flash.offsetWidth;
      u.flash.classList.add('is-on');
    }

    /*
     * The finished set, laid out where the camera was. Once the last shot
     * is taken the live view has nothing left to show — you have walked
     * back to the phone and what you want to see is what you got.
     */
    function showReview() {
      u.review.className = 'tripod-review' + (defs.length > 1 ? '' : ' one');
      u.review.innerHTML = defs.map(function (d) {
        var url = thumbs[d.key];
        return '<button type="button" class="tripod-shot" data-key="' + d.key + '">' +
          (url ? '<img src="' + url + '" alt="' + d.label + '">' : '') +
          '<span>' + d.label + '</span><em>Retake</em></button>';
      }).join('');
      u.review.hidden = false;
    }

    function hideReview() {
      u.review.hidden = true;
      u.review.innerHTML = '';
    }

    /* Waiting for you to say you are set — where it starts, and where
       "take them again" comes back to. */
    function readyState() {
      u.start.hidden = false;
      u.start.textContent = "I'm ready";
      u.start.classList.add('btn-primary');
      u.use.hidden = true;
      u.count.textContent = '';
      setCue('Ready for your ' + (defs.length === 1 ? 'photo' : 'photos') + '?',
             defs.length === 1
               ? 'Prop the phone up, then press ready.'
               : 'Front, then turn, turn, and turn around.');
      setLabel(null);
      showGuide(defs[0]);
    }

    function now() {
      return window.performance && performance.now ? performance.now() : Date.now();
    }

    /*
     * Scheduled against a deadline rather than by sleeping a second at a
     * time: setTimeout runs late, and four shots of three chained sleeps
     * would each land a little further behind the one before.
     */
    function waitUntil(at) {
      return new Promise(function (resolve) {
        timer = setTimeout(resolve, Math.max(0, at - now()));
      });
    }

    /* One angle: cue, three ticks, shutter. The instruction is over the
       picture; the line underneath says where you are in the set, which is
       the one thing the big label cannot tell you. */
    function shoot(def, status) {
      if (cancelled) return Promise.resolve();
      var cue = cueFor(def);
      setLabel(cue);
      setCue(status || cue.act, '');
      showGuide(def);
      say(cue.say);

      var n = seconds;
      var t0 = now();
      var elapsed = 0;
      u.count.textContent = String(n);

      function step() {
        if (cancelled) return Promise.resolve();
        elapsed++;
        return waitUntil(t0 + elapsed * 1000).then(function () {
          if (cancelled) return;
          n--;
          if (n > 0) {
            u.count.textContent = String(n);
            tick();
            return step();
          }
          u.count.textContent = '';
          shutter();
          flash();
          /* the frame is taken here; the file is written a moment later */
          var canvas = snap(u.video);
          /* the exact moment of capture, for anything watching the rhythm */
          try {
            u.root.dispatchEvent(new CustomEvent('tripod:shot', { detail: { key: def.key } }));
          } catch (e) { /* older browsers just do not get the event */ }
          encoding.push(encode(canvas, def.key).then(function (file) {
            if (cancelled) return;
            shots[def.key] = file;
            if (thumbs[def.key]) URL.revokeObjectURL(thumbs[def.key]);
            thumbs[def.key] = URL.createObjectURL(file);
          }));
        });
      }
      return step();
    }

    function sequence(list) {
      var total = list.length;
      return list.reduce(function (chain, def, i) {
        return chain.then(function () {
          return shoot(def, total > 1 ? ('Photo ' + (i + 1) + ' of ' + total)
                                      : 'Taking your photo');
        });
      }, Promise.resolve()).then(function () {
        /* let the encodes that ran behind the countdown finish */
        return Promise.all(encoding);
      }).then(function () {
        if (cancelled) return;
        showGuide(null);
        setLabel(null);
        var done = defs.every(function (d) { return shots[d.key]; });
        showReview();
        setCue(done ? 'All done' : 'Stopped', 'Tap a photo to retake just that one.');
        say(done ? 'Done' : 'Stopped');
        u.start.hidden = false;
        u.start.textContent = 'Take them again';
        u.use.hidden = !Object.keys(shots).length;
        /* once there are photos, keeping them is the thing you came to do */
        u.start.classList.toggle('btn-primary', u.use.hidden);
      });
    }

    function begin(list) {
      audio();
      u.start.hidden = true;
      u.use.hidden = true;
      return sequence(list);
    }

    function cleanup() {
      cancelled = true;
      clearTimeout(timer);
      hush();
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
      wakeLock = null;
      u.root.hidden = true;
      u.video.srcObject = null;
      document.body.classList.remove('tripod-open');
    }

    function finish(result) {
      var pending = shots;
      cleanup();
      Object.keys(thumbs).forEach(function (k) { URL.revokeObjectURL(thumbs[k]); });
      thumbs = {};
      if (settle) settle(result ? pending : null);
      settle = null;
    }

    u.close.onclick = function () { finish(false); };
    u.use.onclick = function () { finish(true); };
    u.start.onclick = function () {
      cancelled = false;
      /* Taking them again means all of them: the old set goes, the camera
         comes back, and it waits for you to say you are set — you have to
         walk back into shot before it counts down. */
      if (Object.keys(shots).length) {
        Object.keys(thumbs).forEach(function (k) { URL.revokeObjectURL(thumbs[k]); });
        shots = {};
        thumbs = {};
        encoding = [];
        hideReview();
        readyState();
        return;
      }
      begin(defs);
    };
    u.review.onclick = function (e) {
      var btn = e.target.closest && e.target.closest('.tripod-shot');
      if (!btn) return;
      var def = defs.filter(function (d) { return d.key === btn.dataset.key; })[0];
      if (!def) return;
      cancelled = false;
      audio();
      hideReview();               // back to the live view for this one
      u.start.hidden = true;
      u.use.hidden = true;
      shoot(def, 'Retaking ' + def.label.toLowerCase()).then(function () {
        return sequence([]);
      });
    };

    return new Promise(function (resolve, reject) {
      settle = resolve;
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1440 }, height: { ideal: 1920 } },
        audio: false
      }).then(function (s) {
        stream = s;
        u.video.srcObject = s;
        u.video.play().catch(function () { /* autoplay attrs cover this */ });
        u.root.hidden = false;
        document.body.classList.add('tripod-open');
        shots = {};
        readyState();

        if (navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen')
            .then(function (l) { wakeLock = l; })
            .catch(function () { /* the screen may dim; not fatal */ });
        }
      }).catch(function (err) {
        settle = null;
        cleanup();
        reject(new Error(explain(err)));
      });
    });
  }

  /*
   * getUserMedia's error names are not something to show anybody, and the
   * likeliest cause here is the page being open inside another app rather
   * than in the browser, where iOS refuses the camera outright.
   */
  function explain(err) {
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'The camera was not allowed. If you opened this from inside another app, ' +
             'open it in Safari or Chrome instead — some in-app browsers block the camera ' +
             'entirely. Otherwise allow camera access and try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No camera was found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'The camera is busy — close anything else using it and try again.';
    }
    return 'The camera could not be started (' + (name || 'unknown error') + ').';
  }

  return {
    supported: supported,
    run: run,
    SECONDS: SECONDS
  };
})();
