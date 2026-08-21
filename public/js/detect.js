/*
 * Work out which photo is which.
 *
 * Cues, in order of how reliable they are:
 *   - no face found at all        → the back of the head
 *   - a face with the nose centred → front
 *   - a face with the nose pushed to one side → that side's profile
 *
 * Left vs right is the whole difficulty, and it is the one that needs real
 * landmarks: a LEFT side view shows the left ear, which puts the nose on the
 * viewer's left. So the yaw proxy below is where the nose tip sits between
 * the two edges of the jaw.
 *
 * The detector (face-api.js, MIT, vendored under public/vendor) is fetched
 * only when someone actually adds photos in bulk, so the camera flow and the
 * request-link flow never pay for it.
 */
window.HairSelfieDetect = (function () {
  'use strict';

  var BASE = 'vendor/face-api';
  var loading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* Load once, and never twice even if two calls race. */
  function ready() {
    if (loading) return loading;
    loading = loadScript(BASE + '/face-api.js')
      .then(function () {
        if (!window.faceapi) throw new Error('face-api did not initialise');
        return Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(BASE + '/model'),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(BASE + '/model')
        ]);
      })
      .catch(function (err) {
        loading = null;          // let a later attempt retry
        throw err;
      });
    return loading;
  }

  /*
   * Measure one image. Returns { hasFace, score, noseRatio } where noseRatio
   * is 0 (nose at the left edge of the jaw) … 1 (right edge), so ~0.5 is
   * looking straight at the camera.
   */
  function measure(img) {
    var opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.25 });
    return faceapi.detectSingleFace(img, opts).withFaceLandmarks(true)
      .then(function (res) {
        if (!res || !res.landmarks) return { hasFace: false, score: 0, noseRatio: 0.5 };
        var pts = res.landmarks.positions || [];
        if (pts.length < 31) return { hasFace: false, score: 0, noseRatio: 0.5 };

        var minX = Infinity, maxX = -Infinity;
        for (var i = 0; i < 17; i++) {           // 0–16 is the jaw outline
          var x = pts[i].x != null ? pts[i].x : pts[i]._x;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        var noseX = pts[30].x != null ? pts[30].x : pts[30]._x;   // 30 is the nose tip
        var span = Math.max(1, maxX - minX);

        return {
          hasFace: true,
          score: (res.detection && res.detection.score) || 0.5,
          noseRatio: Math.min(1, Math.max(0, (noseX - minX) / span))
        };
      })
      .catch(function () {
        return { hasFace: false, score: 0, noseRatio: 0.5 };
      });
  }

  /* How well one measurement suits one position. Pure — unit tested. */
  function affinity(m, slot) {
    var TURN = 0.18;   // how far the nose shifts before we call it a profile

    if (!m.hasFace) {
      /* A hard profile can defeat the detector too, so profiles keep a
         little weight here rather than everything landing on "back". */
      return { back: 1, front: 0.02, left: 0.15, right: 0.15 }[slot];
    }

    var d = m.noseRatio - 0.5;                  // negative = nose toward frame-left
    var conf = Math.min(1, Math.max(0.2, m.score));
    var clamp = function (v) { return Math.min(1, Math.max(0, v)); };

    if (slot === 'front') return conf * clamp(1 - Math.abs(d) / TURN);
    if (slot === 'left')  return conf * clamp(-d / TURN);
    if (slot === 'right') return conf * clamp(d / TURN);
    return 0.05;                                 // back, given a face was found
  }

  var SLOTS = ['front', 'left', 'right', 'back'];

  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    var out = [];
    arr.forEach(function (item, i) {
      var rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permutations(rest).forEach(function (p) { out.push([item].concat(p)); });
    });
    return out;
  }

  /*
   * Assign photos to positions as a whole rather than one at a time. Each
   * position gets exactly one photo, and that constraint rescues cases where
   * an individual guess is shaky — 24 permutations, so just try them all.
   *
   * Returns { order: {front,left,right,back} → index, confidence 0..1 }.
   */
  function assign(measurements) {
    var idx = measurements.map(function (_, i) { return i; });
    var best = null, second = -Infinity;

    permutations(idx).forEach(function (perm) {
      var total = 0;
      for (var s = 0; s < SLOTS.length; s++) {
        var photo = measurements[perm[s]];
        total += photo ? affinity(photo, SLOTS[s]) : 0;
      }
      if (!best || total > best.total) {
        if (best) second = best.total;
        best = { perm: perm, total: total };
      } else if (total > second) {
        second = total;
      }
    });

    var order = {};
    SLOTS.forEach(function (slot, s) { order[slot] = best.perm[s]; });

    /* Confident when the winner clearly beats the runner-up and the scores
       are not all mush. */
    var margin = second === -Infinity ? 1 : Math.max(0, best.total - second);
    var confidence = Math.min(1, (best.total / SLOTS.length) * 0.6 + margin * 0.8);

    return { order: order, confidence: confidence, total: best.total };
  }

  /* Measure every image, then assign. Resolves null if it cannot run. */
  function classify(images) {
    return ready()
      .then(function () {
        return images.reduce(function (chain, img) {
          return chain.then(function (acc) {
            return measure(img).then(function (m) { return acc.concat([m]); });
          });
        }, Promise.resolve([]));
      })
      .then(function (measurements) {
        var res = assign(measurements);
        res.measurements = measurements;
        return res;
      })
      .catch(function (err) {
        console.warn('photo detection unavailable:', err.message);
        return null;
      });
  }

  return {
    SLOTS: SLOTS,
    ready: ready,
    measure: measure,
    affinity: affinity,
    assign: assign,
    classify: classify
  };
})();
