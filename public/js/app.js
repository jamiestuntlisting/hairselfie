/*
 * Hair Selfie — UI wiring.
 *
 * Photos are handled entirely in the browser: picked/captured files are
 * decoded locally, framed on canvas and exported as one JPEG. Nothing is
 * uploaded anywhere.
 */
(function () {
  'use strict';

  var Api = window.HairSelfieApi;
  var SLOT_DEFS = Composer.SLOT_DEFS;
  var SLOT_KEYS = SLOT_DEFS.map(function (d) { return d.key; });
  var defByKey = {};
  SLOT_DEFS.forEach(function (d) { defByKey[d.key] = d; });

  var LS_PREFS = 'hairselfie.prefs';
  var DRAG_HOLD_MS = 280;   // long-press before a touch drag starts
  var DRAG_SLOP = 8;        // px of movement that counts as a drag, not a tap

  /* Profile fields — driven by the session user or a coordinator's pick.
     The note and the cut/shave flags belong to the sheet, not the person,
     so they are kept out of this list and survive a performer switch. */
  var FIELDS = ['name', 'height', 'weight', 'phone', 'email'];
  var NOTE_MAX = 140;

  /* a touch device opens the camera on tap; a desktop browser ignores the
     capture attribute and opens the file dialog, so say what will happen */
  var EMPTY_CTA = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    ? 'Tap to take photo'
    : 'Click to add';

  var state = {
    slots: { front: null, left: null, right: null, back: null },
    me: {},
    selectedKey: null,   // cell picked for tap-to-swap
    requestFor: null     // performer this page was opened for, via a request link
  };

  /* ── tiny helpers ────────────────────────────────────────────── */

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* ── element refs ────────────────────────────────────────────── */

  var grid = $('#grid');
  var infoForm = $('#info-form');
  var createBtn = $('#create-btn');
  var createStatus = $('#create-status');
  var resultBox = $('#result');
  var resultImg = $('#result-img');
  var downloadLink = $('#download-link');
  var saveImageBtn = $('#save-image');
  var saveHint = $('#save-hint');
  var summaryBox = $('#details-summary');
  var summaryText = $('#summary-text');
  var editBtn = $('#edit-details');
  var noteInput = $('#f-note');
  var noteCount = $('#note-count');
  var cutBox = $('#f-cut');
  var shaveBox = $('#f-shave');

  var cells = {};
  var resultUrl = null;
  var resultBlob = null;
  var resultName = 'hair-selfie.jpg';
  var captureQueue = [];

  /*
   * Always hand the browser a brand-new <input type="file">. Reusing one
   * input (even after clearing .value) is unreliable on mobile Safari — the
   * second pick often never fires 'change', which made "Add photos" look
   * like it stopped working after the first use.
   */
  function pickFiles(opts) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.multiple) input.multiple = true;
    /* 'user' is the selfie camera. Everything here is a photo of yourself,
       so it is always the right one to open; desktop browsers ignore the
       attribute and show the file dialog as before. */
    if (opts.capture) input.setAttribute('capture', 'user');
    input.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0';
    document.body.appendChild(input);

    var done = false;
    function cleanup() {
      if (done) return;
      done = true;
      if (input.parentNode) input.parentNode.removeChild(input);
    }

    input.addEventListener('change', function () {
      if (input.files && input.files.length) opts.onFiles(input.files);
      cleanup();
    });
    /* the picker being cancelled fires no event — tidy up on the way back */
    window.addEventListener('focus', function later() {
      window.removeEventListener('focus', later);
      setTimeout(cleanup, 1200);
    });

    input.click();
  }

  /* ── photo grid ──────────────────────────────────────────────── */

  function buildGrid() {
    SLOT_DEFS.forEach(function (def) {
      var root = document.createElement('div');
      root.className = 'cell';
      root.dataset.slot = def.key;
      root.setAttribute('role', 'button');
      root.setAttribute('tabindex', '0');
      root.setAttribute('aria-label', def.label + ' photo position');
      root.innerHTML =
        '<canvas class="cell-canvas" aria-hidden="true"></canvas>' +
        '<div class="cell-empty">' +
          Outlines.svgMarkup(def.outline, def.mirror) +
          '<span class="cell-name">' + esc(def.label) + '</span>' +
          (def.facing ? '<span class="cell-facing">' + esc(def.facing) + '</span>' : '') +
          '<span class="cell-cta">' + esc(EMPTY_CTA) + '</span>' +
        '</div>' +
        '<div class="cell-guide">' + Outlines.svgMarkup(def.outline, def.mirror) + '</div>' +
        '<span class="cell-tag">' + esc(def.label) + '</span>' +
        '<div class="cell-tools">' +
          '<button type="button" data-act="adjust" title="Adjust framing" aria-label="Adjust ' + esc(def.label) + '">✎</button>' +
          '<button type="button" data-act="rotate" title="Rotate 90°" aria-label="Rotate ' + esc(def.label) + '">⟳</button>' +
          '<button type="button" data-act="remove" title="Remove photo" aria-label="Remove ' + esc(def.label) + '">✕</button>' +
        '</div>' +
        '<span class="cell-swapbadge">Tap another spot to swap</span>';

      grid.appendChild(root);
      cells[def.key] = { root: root, canvas: root.querySelector('.cell-canvas'), dragDepth: 0 };
      wireCell(def.key);
    });
  }

  function wireCell(key) {
    var c = cells[key];
    var root = c.root;

    root.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = btn.dataset.act;
        if (act === 'adjust') openAdjust(key);
        else if (act === 'rotate') rotateSlot(key);
        else if (act === 'remove') removeSlot(key);
      });
    });

    root.addEventListener('pointerdown', function (e) { beginPointer(key, e); });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cellClicked(key); }
    });

    /* dropping image files from a desktop file manager */
    root.addEventListener('dragenter', function (e) {
      e.preventDefault();
      c.dragDepth++;
      root.classList.add('dragover');
    });
    root.addEventListener('dragover', function (e) { e.preventDefault(); });
    root.addEventListener('dragleave', function () {
      if (--c.dragDepth <= 0) { c.dragDepth = 0; root.classList.remove('dragover'); }
    });
    root.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      c.dragDepth = 0;
      root.classList.remove('dragover');
      var files = e.dataTransfer.files;
      if (files && files.length) {
        /* one file onto a cell is a deliberate placement — leave it alone.
           A batch is a bulk add that happened to land on a cell. */
        assignFiles(files, key, files.length > 1 ? autoArrange : null);
      }
    });
  }

  /* ── drag to rearrange (mouse + touch) ───────────────────────── */

  var drag = null;

  function beginPointer(key, e) {
    if (e.button != null && e.button > 0) return;
    if (e.target.closest && e.target.closest('button[data-act]')) return;
    if (!state.slots[key]) { pendPick(key); return; }

    var isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    drag = {
      key: key, id: e.pointerId, x0: e.clientX, y0: e.clientY,
      x: e.clientX, y: e.clientY, active: false, moved: false,
      isTouch: isTouch, timer: null
    };

    if (isTouch) {
      drag.timer = setTimeout(function () {
        if (drag && !drag.moved) activateDrag();
      }, DRAG_HOLD_MS);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function activateDrag() {
    if (!drag || drag.active) return;
    drag.active = true;
    clearSelection();

    var src = cells[drag.key];
    var rect = src.root.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    var clone = src.canvas.cloneNode(false);
    clone.getContext('2d').drawImage(src.canvas, 0, 0);
    clone.style.width = '100%';
    clone.style.height = '100%';
    ghost.appendChild(clone);
    document.body.appendChild(ghost);

    drag.ghost = ghost;
    drag.offX = drag.x - rect.left;
    drag.offY = drag.y - rect.top;
    src.root.classList.add('dragging');
    document.body.classList.add('is-dragging');
    positionGhost();
  }

  function positionGhost() {
    if (!drag || !drag.ghost) return;
    drag.ghost.style.transform =
      'translate(' + (drag.x - drag.offX) + 'px,' + (drag.y - drag.offY) + 'px)';
  }

  function cellKeyUnder(x, y) {
    if (drag && drag.ghost) drag.ghost.style.display = 'none';
    var el = document.elementFromPoint(x, y);
    if (drag && drag.ghost) drag.ghost.style.display = '';
    var cell = el && el.closest ? el.closest('.cell') : null;
    return cell ? cell.dataset.slot : null;
  }

  function highlightTarget(key) {
    SLOT_KEYS.forEach(function (k) {
      cells[k].root.classList.toggle('droptarget', !!key && k === key && k !== drag.key);
    });
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    var dist = Math.hypot(drag.x - drag.x0, drag.y - drag.y0);

    if (!drag.active) {
      if (dist > DRAG_SLOP) {
        drag.moved = true;
        if (drag.isTouch) {
          clearTimeout(drag.timer);   // finger moved first → let the page scroll
          endDrag(false);
          return;
        }
        activateDrag();               // mouse drags start straight away
      } else {
        return;
      }
    }

    e.preventDefault();
    positionGhost();
    highlightTarget(cellKeyUnder(drag.x, drag.y));
  }

  function onPointerUp(e) {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    var wasActive = drag.active;
    var key = drag.key;
    var target = wasActive ? cellKeyUnder(drag.x, drag.y) : null;
    var tapped = !wasActive && !drag.moved;

    endDrag(true);

    if (wasActive && target && target !== key) swapSlots(key, target);
    else if (tapped) cellClicked(key);
  }

  function endDrag(clearAll) {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    cells[drag.key].root.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    if (clearAll) SLOT_KEYS.forEach(function (k) { cells[k].root.classList.remove('droptarget'); });
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    drag = null;
  }

  /*
   * Tapping an empty spot goes straight to the camera — that spot is the
   * missing angle, so shooting it is what you came to do. "Add photos" is
   * still there for anything already in the camera roll.
   */
  function pendPick(key) {
    pickFiles({
      multiple: false,
      capture: true,
      onFiles: function (files) { assignFiles(files, key); }
    });
  }

  function cellClicked(key) {
    if (state.selectedKey) {
      if (state.selectedKey === key) { clearSelection(); return; }
      swapSlots(state.selectedKey, key);
      return;
    }
    if (state.slots[key]) {
      state.selectedKey = key;
      cells[key].root.classList.add('selected');
    } else {
      pendPick(key);
    }
  }

  function clearSelection() {
    if (state.selectedKey) {
      cells[state.selectedKey].root.classList.remove('selected');
      state.selectedKey = null;
    }
  }

  function swapSlots(a, b) {
    var t = state.slots[a];
    state.slots[a] = state.slots[b];
    state.slots[b] = t;
    clearSelection();
    renderCell(a);
    renderCell(b);
    updateCreateStatus();
  }

  function rotateSlot(key) {
    var slot = state.slots[key];
    if (!slot) return;
    slot.rot = ((slot.rot || 0) + 90) % 360;
    Composer.clampPan(slot, cells[key].root.clientWidth || 4, cells[key].root.clientHeight || 5);
    renderCell(key);
  }

  function removeSlot(key) {
    var slot = state.slots[key];
    if (!slot) return;
    if (slot.url) URL.revokeObjectURL(slot.url);
    state.slots[key] = null;
    clearSelection();
    renderCell(key);
    updateCreateStatus();
  }

  function renderCell(key) {
    var c = cells[key];
    var slot = state.slots[key];
    c.root.classList.toggle('occupied', !!slot);
    if (slot) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var w = c.root.clientWidth, h = c.root.clientHeight;
      if (w && h) {
        c.canvas.width = Math.round(w * dpr);
        c.canvas.height = Math.round(h * dpr);
        Composer.drawSlot(c.canvas.getContext('2d'), slot, 0, 0, c.canvas.width, c.canvas.height);
      }
    }
  }

  function rerenderAll() {
    SLOT_KEYS.forEach(function (k) { if (state.slots[k]) renderCell(k); });
  }

  /* ── files in ────────────────────────────────────────────────── */

  function looksLikeImage(file) {
    return /^image\//i.test(file.type) ||
      /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');
  }

  function assignFiles(fileList, preferKey, done) {
    var files = Array.prototype.slice.call(fileList).filter(looksLikeImage);
    if (!files.length) { if (done) done(); return; }

    var targets = [];
    if (preferKey) targets.push(preferKey);
    SLOT_KEYS.forEach(function (k) {
      if (k !== preferKey && !state.slots[k]) targets.push(k);
    });
    /* everything full? start overwriting from the top so the button keeps working */
    SLOT_KEYS.forEach(function (k) {
      if (targets.indexOf(k) === -1 && targets.length < files.length) targets.push(k);
    });

    var chosen = files.slice(0, targets.length);
    var pending = chosen.length;
    chosen.forEach(function (f, i) {
      setSlotImage(targets[i], f, function () {
        if (--pending === 0 && done) done();
      });
    });
  }

  function setSlotImage(key, file, done) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var old = state.slots[key];
      if (old && old.url) URL.revokeObjectURL(old.url);
      state.slots[key] = { img: img, url: url, zoom: 1, panX: 0, panY: 0, rot: 0, fileName: file.name };
      clearSelection();
      renderCell(key);
      updateCreateStatus();
      advanceCapture(key);
      if (done) done();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert('Couldn’t read “' + (file.name || 'that file') + '”.\nIf it’s a HEIC photo, try exporting it as JPEG.');
      if (done) done();
    };
    img.src = url;
  }

  /* ── work out which photo is which ───────────────────────────── */

  var arrangeUndo = null;

  /*
   * Only ever runs after a bulk add — the camera flow already knows which
   * angle is which, so it never pays the download. Arranges, says so, and
   * leaves an undo: a wrong guess should cost one tap, not a re-upload.
   */
  function autoArrange() {
    if (!window.HairSelfieDetect) return;
    var filled = SLOT_KEYS.filter(function (k) { return state.slots[k]; });
    if (filled.length < 2) return;

    var before = {};
    SLOT_KEYS.forEach(function (k) { before[k] = state.slots[k]; });
    var photos = filled.map(function (k) { return state.slots[k]; });

    showArrangeBar('Checking which photo is which…', false);

    HairSelfieDetect.classify(photos.map(function (p) { return p.img; }))
      .then(function (res) {
        if (!res) { hideArrangeBar(); return; }

        var next = { front: null, left: null, right: null, back: null };
        HairSelfieDetect.SLOTS.forEach(function (slot) {
          var i = res.order[slot];
          if (i != null && photos[i]) next[slot] = photos[i];
        });

        var changed = SLOT_KEYS.some(function (k) { return next[k] !== before[k]; });
        if (res.confidence < 0.35 || !changed) {
          hideArrangeBar();
          return;
        }

        state.slots = next;
        arrangeUndo = before;
        SLOT_KEYS.forEach(renderCell);
        updateCreateStatus();
        showArrangeBar('Arranged these for you — worth a check.', true);
      })
      .catch(function () { hideArrangeBar(); });
  }

  function showArrangeBar(message, withUndo) {
    var bar = $('#arrange-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'arrange-bar';
      bar.className = 'arrange-bar';
      grid.parentNode.insertBefore(bar, grid.nextSibling);
    }
    bar.hidden = false;
    bar.innerHTML = '<span>' + esc(message) + '</span>' +
      (withUndo ? '<button type="button" class="btn btn-small" id="arrange-undo">Undo</button>' : '');
    if (withUndo) {
      $('#arrange-undo').addEventListener('click', function () {
        if (!arrangeUndo) return;
        state.slots = arrangeUndo;
        arrangeUndo = null;
        SLOT_KEYS.forEach(renderCell);
        updateCreateStatus();
        hideArrangeBar();
      });
    }
  }

  function hideArrangeBar() {
    var bar = $('#arrange-bar');
    if (bar) bar.hidden = true;
  }

  /* ── guided camera capture ───────────────────────────────────── */

  function captureBar() { return $('#capture-bar'); }

  function startCapture() {
    var empties = SLOT_KEYS.filter(function (k) { return !state.slots[k]; });
    captureQueue = empties.length ? empties : SLOT_KEYS.slice();
    shootNext();
  }

  function shootNext() {
    var key = captureQueue[0];
    if (!key) { hideCaptureBar(); return; }
    hideCaptureBar();
    pickFiles({
      multiple: false,
      capture: true,
      onFiles: function (files) { assignFiles(files, key); }
    });
  }

  function advanceCapture(justFilled) {
    if (!captureQueue.length) return;
    var i = captureQueue.indexOf(justFilled);
    if (i === -1) return;
    captureQueue.splice(i, 1);
    if (captureQueue.length) showCaptureBar(captureQueue[0]);
    else hideCaptureBar();
  }

  function showCaptureBar(key) {
    var def = defByKey[key];
    var bar = captureBar();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'capture-bar';
      bar.className = 'capture-bar';
      grid.parentNode.insertBefore(bar, grid);
    }
    bar.innerHTML =
      '<span class="capture-next">Next: <b>' + esc(def.label) + '</b>' +
      (def.facing ? ' — ' + esc(def.facing) : '') + '</span>' +
      '<button type="button" class="btn btn-primary btn-small" id="capture-go">Take photo</button>' +
      '<button type="button" class="btn btn-small" id="capture-stop">Done</button>';
    bar.hidden = false;
    $('#capture-go').addEventListener('click', shootNext);
    $('#capture-stop').addEventListener('click', function () {
      captureQueue = [];
      hideCaptureBar();
    });
  }

  function hideCaptureBar() {
    var bar = captureBar();
    if (bar) bar.hidden = true;
  }

  /* ── adjust modal ────────────────────────────────────────────── */

  var modal = $('#adjust-modal');
  var adjCanvas = $('#adjust-canvas');
  var adjGuide = $('#adjust-guide');
  var adjTitle = $('#adjust-title');
  var adjZoom = $('#adjust-zoom');
  var adjustKey = null;
  var adjustSlot = null;
  var adjustSnapshot = null;
  var pointers = new Map();
  var pinchStart = null;

  function openAdjust(key) {
    var slot = state.slots[key];
    if (!slot) return;
    clearSelection();
    adjustKey = key;
    adjustSlot = slot;
    adjustSnapshot = { zoom: slot.zoom, panX: slot.panX, panY: slot.panY, rot: slot.rot };
    var def = defByKey[key];
    adjTitle.textContent = 'Adjust — ' + def.label;
    adjGuide.innerHTML = Outlines.svgMarkup(def.outline, def.mirror);
    adjZoom.value = Math.round((slot.zoom || 1) * 100);
    modal.hidden = false;
    requestAnimationFrame(drawAdjust);
  }

  function closeAdjust(commit) {
    if (!adjustKey) return;
    if (!commit) Object.assign(adjustSlot, adjustSnapshot);
    modal.hidden = true;
    renderCell(adjustKey);
    adjustKey = null;
    adjustSlot = null;
    pointers.clear();
    pinchStart = null;
  }

  function drawAdjust() {
    if (!adjustSlot) return;
    var rect = adjCanvas.getBoundingClientRect();
    if (!rect.width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    adjCanvas.width = Math.round(rect.width * dpr);
    adjCanvas.height = Math.round(rect.height * dpr);
    Composer.drawSlot(adjCanvas.getContext('2d'), adjustSlot, 0, 0, adjCanvas.width, adjCanvas.height);
  }

  function setAdjustZoom(z) {
    if (!adjustSlot) return;
    adjustSlot.zoom = Math.min(4, Math.max(1, z));
    var rect = adjCanvas.getBoundingClientRect();
    Composer.clampPan(adjustSlot, rect.width || 4, rect.height || 5);
    adjZoom.value = Math.round(adjustSlot.zoom * 100);
    drawAdjust();
  }

  function wireAdjust() {
    adjZoom.addEventListener('input', function () { setAdjustZoom(adjZoom.value / 100); });

    $('#adjust-rotate').addEventListener('click', function () {
      if (!adjustSlot) return;
      adjustSlot.rot = ((adjustSlot.rot || 0) + 90) % 360;
      var rect = adjCanvas.getBoundingClientRect();
      Composer.clampPan(adjustSlot, rect.width || 4, rect.height || 5);
      drawAdjust();
    });

    $('#adjust-reset').addEventListener('click', function () {
      if (!adjustSlot) return;
      adjustSlot.zoom = 1; adjustSlot.panX = 0; adjustSlot.panY = 0; adjustSlot.rot = 0;
      adjZoom.value = 100;
      drawAdjust();
    });

    $('#adjust-done').addEventListener('click', function () { closeAdjust(true); });
    $('#adjust-cancel').addEventListener('click', function () { closeAdjust(false); });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeAdjust(false); });

    adjCanvas.addEventListener('pointerdown', function (e) {
      if (!adjustSlot) return;
      adjCanvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          zoom: adjustSlot.zoom || 1
        };
      }
      adjCanvas.classList.add('grabbing');
    });

    adjCanvas.addEventListener('pointermove', function (e) {
      if (!adjustSlot || !pointers.has(e.pointerId)) return;
      var prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var rect = adjCanvas.getBoundingClientRect();
      if (pointers.size === 2 && pinchStart && pinchStart.dist > 0) {
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (dist > 0) setAdjustZoom(pinchStart.zoom * dist / pinchStart.dist);
      } else if (pointers.size === 1 && rect.width) {
        adjustSlot.panX = (adjustSlot.panX || 0) + (e.clientX - prev.x) / rect.width;
        adjustSlot.panY = (adjustSlot.panY || 0) + (e.clientY - prev.y) / rect.height;
        Composer.clampPan(adjustSlot, rect.width, rect.height);
        drawAdjust();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) adjCanvas.classList.remove('grabbing');
    }
    adjCanvas.addEventListener('pointerup', endPointer);
    adjCanvas.addEventListener('pointercancel', endPointer);

    adjCanvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!adjustSlot) return;
      setAdjustZoom((adjustSlot.zoom || 1) * (1 - e.deltaY * 0.0012));
    }, { passive: false });
  }

  /* ── performer details ───────────────────────────────────────── */

  var Fmt = window.HairSelfieFormat || {};

  /* Phone and weight are shown the way they will print. */
  function tidy(key, value) {
    if (key === 'phone' && Fmt.phone) return Fmt.phone(value);
    if (key === 'weight' && Fmt.weight) return Fmt.weight(value);
    return value == null ? '' : value;
  }

  function fillForm(p) {
    FIELDS.forEach(function (k) {
      infoForm.elements[k].value = tidy(k, (p && p[k]) || '');
    });
  }

  function readForm() {
    var o = {};
    FIELDS.forEach(function (k) { o[k] = infoForm.elements[k].value.trim(); });
    return o;
  }

  /* Everything printed on the sheet: profile fields, note and flags. */
  function readSheet() {
    var o = readForm();
    o.note = noteInput.value.trim();
    o.canCut = cutBox.checked;
    o.canShave = shaveBox.checked;
    return o;
  }

  /* One-line identity summary, so the whole flow fits on a phone screen.
     The full form is one tap away and opens itself when there is nothing
     to summarise yet. */
  function renderSummary() {
    var p = readForm();
    var bits = [p.height, tidy('weight', p.weight), tidy('phone', p.phone), p.email]
      .filter(Boolean);
    if (!p.name && !bits.length) {
      summaryText.innerHTML = '<span class="summary-empty">No details yet — tap Edit</span>';
      return;
    }
    summaryText.innerHTML =
      '<b>' + esc(p.name || 'No name') + '</b>' +
      (bits.length ? '<span class="summary-rest">' + esc(bits.join('  ·  ')) + '</span>' : '');
  }

  function setDetailsOpen(open) {
    infoForm.hidden = !open;
    summaryBox.hidden = open;
    editBtn.textContent = open ? 'Done' : 'Edit';
    if (!open) renderSummary();
  }

  function updateNoteCount() {
    var used = noteInput.value.length;
    noteCount.textContent = used ? used + ' / ' + NOTE_MAX : '';
    noteCount.classList.toggle('near-limit', used > NOTE_MAX - 20);
  }

  var persistProfile = debounce(function () {
    if (Api.isDemo && !state.requestFor) {
      Api.saveLocalProfile(Object.assign({ id: 'demo-me' }, readForm()));
    }
  }, 350);

  function renderSessionChip(failed) {
    var chip = $('#session-chip');
    if (failed) { chip.textContent = 'Not signed in'; return; }
    chip.innerHTML = 'Signed in as <b>' + esc(state.me.name || 'Guest') + '</b>';
  }

  /* ── request links ───────────────────────────────────────────── */

  var REQ_PARAM = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.requestParam) || 'p';

  function requestedPerformerId() {
    try {
      return new URLSearchParams(window.location.search).get(REQ_PARAM);
    } catch (e) {
      return null;
    }
  }

  /* Opened from a request link: show who it is for and prefill their info. */
  function enterRequestMode(performer) {
    state.requestFor = performer;
    fillForm(performer);
    setDetailsOpen(false);

    var banner = $('#request-banner');
    banner.hidden = false;
    banner.innerHTML =
      '<b>Hair selfie requested for ' + esc(performer.name) + '</b>' +
      '<span>Take four photos of your hair — front, both sides and back — then hit Create.</span>';

    $('#session-chip').hidden = true;
  }

  /* ── create, save & download ─────────────────────────────────── */

  function updateCreateStatus() {
    var missing = SLOT_DEFS.filter(function (d) { return !state.slots[d.key]; });
    if (!missing.length) {
      createStatus.innerHTML = '<span class="ok">All four photos in place.</span> Check the details above, then create your sheet.';
    } else if (missing.length === 4) {
      createStatus.textContent = 'Add your four photos in step 1 to get started.';
    } else {
      createStatus.innerHTML = 'Still missing: <span class="warn">' +
        missing.map(function (d) { return esc(d.label); }).join(', ') +
        '</span>. You can create anyway — empty spots get a placeholder.';
    }
  }

  function canSharePhotos(file) {
    try {
      return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (e) {
      return false;
    }
  }

  function doCreate() {
    var person = readSheet();
    var missing = SLOT_DEFS.filter(function (d) { return !state.slots[d.key]; });

    if (missing.length === 4) {
      alert('Add at least one photo first — step 1.');
      return Promise.resolve(false);
    }
    if (missing.length && !confirm(
      'No photo yet for: ' + missing.map(function (d) { return d.label; }).join(', ') +
      '.\nCreate anyway with empty placeholders?')) {
      return Promise.resolve(false);
    }
    if (!person.name && !confirm('No name entered — the sheet will have no name line. Continue?')) {
      return Promise.resolve(false);
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';

    return new Promise(function (resolve) { setTimeout(resolve, 30); })
      .then(function () { return Composer.toBlob(Composer.compose(state.slots, person)); })
      .then(function (blob) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultBlob = blob;
        resultUrl = URL.createObjectURL(blob);
        resultImg.src = resultUrl;

        var date = new Date().toISOString().slice(0, 10);
        resultName = 'hair-selfie_' + (slugify(person.name) || 'performer') + '_' + date +
                     '.' + Composer.fileExtension();
        downloadLink.href = resultUrl;
        downloadLink.download = resultName;

        var file = new File([blob], resultName, { type: Composer.mimeType() });
        saveHint.textContent = canSharePhotos(file)
          ? 'Saves straight to your camera roll.'
          : 'Saves to your downloads folder.';

        resultBox.hidden = false;
        requestAnimationFrame(function () {
          resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return true;
      })
      .catch(function (err) {
        console.error(err);
        alert('Sorry — something went wrong while creating the image.\n' + err.message);
        return false;
      })
      .then(function (ok) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create my Hair Selfie';
        return ok;
      });
  }

  /*
   * One button. On a phone the share sheet offers "Save Image", which puts
   * the sheet in the camera roll rather than Files; everywhere else it is a
   * plain download.
   */
  function saveImage() {
    if (!resultBlob) return;
    var file = new File([resultBlob], resultName, { type: Composer.mimeType() });
    if (!canSharePhotos(file)) { downloadLink.click(); return; }
    navigator.share({ files: [file] }).catch(function (err) {
      if (err && err.name === 'AbortError') return;   // user dismissed the sheet
      console.error(err);
      saveHint.textContent = 'Share sheet unavailable — saving to downloads instead.';
      downloadLink.click();
    });
  }

  /* ── static wiring & init ────────────────────────────────────── */

  function loadPrefs() {
    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(LS_PREFS)) || {}; } catch (e) { /* ignore */ }
    var guides = prefs.guides !== false;
    $('#toggle-guides').checked = guides;
    grid.classList.toggle('guides-on', guides);
  }

  function savePrefs() {
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify({ guides: $('#toggle-guides').checked }));
    } catch (e) { /* ignore */ }
  }

  function wireStatic() {
    $('#add-photos').addEventListener('click', function () {
      pickFiles({
        multiple: true,
        onFiles: function (files) {
          assignFiles(files, null, autoArrange);
        }
      });
    });
    $('#take-photos').addEventListener('click', startCapture);

    $('#toggle-guides').addEventListener('change', function (e) {
      grid.classList.toggle('guides-on', e.target.checked);
      savePrefs();
    });

    infoForm.addEventListener('submit', function (e) { e.preventDefault(); });
    infoForm.addEventListener('input', function () {
      if (!state.requestFor) {
        state.me = Object.assign({}, state.me, readForm());
      }
      renderSummary();
      persistProfile();
    });
    /* tidy up on the way out of the field, never mid-keystroke */
    ['phone', 'weight'].forEach(function (k) {
      var el = infoForm.elements[k];
      el.addEventListener('change', function () {
        var next = tidy(k, el.value.trim());
        if (next !== el.value) {
          el.value = next;
          renderSummary();
          persistProfile();
        }
      });
    });

    noteInput.addEventListener('input', updateNoteCount);
    updateNoteCount();

    createBtn.addEventListener('click', doCreate);
    saveImageBtn.addEventListener('click', saveImage);
    editBtn.addEventListener('click', function () { setDetailsOpen(infoForm.hidden); });

    /* stray drops shouldn't navigate the page away */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    grid.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer.files;
      if (!files || !files.length) return;
      /* dropping a batch (e.g. four dragged out of Photos) gets sorted the
         same way the Add photos button does */
      assignFiles(files, null, files.length > 1 ? autoArrange : null);
    });

    /* stop the page scrolling once a touch drag has taken hold */
    grid.addEventListener('touchmove', function (e) {
      if (drag && drag.active) e.preventDefault();
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!modal.hidden) closeAdjust(false);
        else clearSelection();
      }
    });

    if (window.ResizeObserver) {
      var raf = 0;
      new ResizeObserver(function () {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(rerenderAll);
      }).observe(grid);
    } else {
      window.addEventListener('resize', debounce(rerenderAll, 150));
    }
  }

  function init() {
    buildGrid();
    loadPrefs();
    wireStatic();
    wireAdjust();
    updateCreateStatus();

    var reqId = requestedPerformerId();

    Api.getSession().then(function (session) {
      state.me = session.user || {};
      fillForm(state.me);
      renderSessionChip();
      setDetailsOpen(!state.me.name);
    }).catch(function (err) {
      console.error('session failed', err);
      state.me = {};
      renderSessionChip(true);
      setDetailsOpen(true);
    }).then(function () {
      if (!reqId) return;
      return Api.getPerformer(reqId).then(enterRequestMode, function (err) {
        /* a stale or mistyped link is user input, not a fault — say so in
           the banner and let them carry on making a sheet by hand */
        console.warn('request link could not be resolved:', err.message);
        var banner = $('#request-banner');
        banner.hidden = false;
        banner.classList.add('is-error');
        banner.innerHTML = '<b>That request link didn’t work</b>' +
          '<span>We couldn’t look up who it was for. You can still make a sheet below.</span>';
      });
    });
  }

  /* exposed for integration debugging and automated tests */
  window.HairSelfie = {
    state: state,
    setDetailsOpen: setDetailsOpen,
    renderCell: renderCell,
    assignFiles: assignFiles,
    swapSlots: swapSlots,
    autoArrange: autoArrange,
    doCreate: doCreate
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
