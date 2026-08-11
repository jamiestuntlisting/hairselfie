/*
 * Hair Selfie — UI wiring.
 *
 * Photos are handled entirely in the browser: picked/dropped files are
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

  var state = {
    slots: { front: null, left: null, right: null, back: null },
    me: {},
    coordinator: false,
    performer: null,     // coordinator-selected performer, or null = "me"
    selectedKey: null,   // cell picked for tap-to-swap
    labels: true
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
  var fileMulti = $('#file-multi');
  var fileSingle = $('#file-single');
  var infoForm = $('#info-form');
  var createBtn = $('#create-btn');
  var createStatus = $('#create-status');
  var resultBox = $('#result');
  var resultImg = $('#result-img');
  var downloadLink = $('#download-link');
  var noteInput = $('#f-note');
  var noteCount = $('#note-count');

  var cells = {};          // key → { root, canvas, guide, dragDepth }
  var pendingSlot = null;  // slot waiting on the single-file picker
  var dragSourceKey = null;
  var resultUrl = null;

  /* Profile fields — driven by the session user or a coordinator's pick.
     The note is deliberately not one of them: it belongs to the sheet, not
     the person, so switching performers leaves it alone. */
  var FIELDS = ['name', 'height', 'weight', 'phone', 'email'];
  var NOTE_MAX = 140;

  /* ── photo grid ──────────────────────────────────────────────── */

  function buildGrid() {
    SLOT_DEFS.forEach(function (def) {
      var root = document.createElement('div');
      root.className = 'cell';
      root.dataset.slot = def.key;
      root.setAttribute('role', 'button');
      root.setAttribute('aria-label', def.label + ' photo position');
      root.innerHTML =
        '<canvas class="cell-canvas" aria-hidden="true"></canvas>' +
        '<div class="cell-empty">' +
          Outlines.svgMarkup(def.outline, def.mirror) +
          '<span class="cell-name">' + esc(def.label) + '</span>' +
          '<span class="cell-cta">Tap to add photo</span>' +
        '</div>' +
        '<div class="cell-guide">' + Outlines.svgMarkup(def.outline, def.mirror) + '</div>' +
        '<span class="cell-tag">' + esc(def.label) + '</span>' +
        '<div class="cell-tools">' +
          '<button type="button" data-act="adjust" title="Adjust framing" aria-label="Adjust ' + esc(def.label) + ' photo">✎</button>' +
          '<button type="button" data-act="rotate" title="Rotate 90°" aria-label="Rotate ' + esc(def.label) + ' photo">⟳</button>' +
          '<button type="button" data-act="remove" title="Remove photo" aria-label="Remove ' + esc(def.label) + ' photo">✕</button>' +
        '</div>' +
        '<span class="cell-swapbadge">Tap another spot to swap</span>';

      grid.appendChild(root);
      cells[def.key] = {
        root: root,
        canvas: root.querySelector('.cell-canvas'),
        dragDepth: 0
      };
      wireCell(def.key);
    });
  }

  function wireCell(key) {
    var c = cells[key];
    var root = c.root;

    root.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (btn) return; // tool buttons handle themselves
      cellClicked(key);
    });

    root.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = btn.dataset.act;
        if (act === 'adjust') openAdjust(key);
        else if (act === 'rotate') rotateSlot(key);
        else if (act === 'remove') removeSlot(key);
      });
    });

    /* swap by native drag (desktop; iOS long-press drag also works) */
    root.addEventListener('dragstart', function (e) {
      if (!state.slots[key]) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', 'hairselfie:' + key);
      e.dataTransfer.effectAllowed = 'move';
      dragSourceKey = key;
    });
    root.addEventListener('dragend', function () { dragSourceKey = null; });

    root.addEventListener('dragenter', function (e) {
      e.preventDefault();
      c.dragDepth++;
      root.classList.add('dragover');
    });
    root.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragSourceKey ? 'move' : 'copy';
    });
    root.addEventListener('dragleave', function () {
      if (--c.dragDepth <= 0) {
        c.dragDepth = 0;
        root.classList.remove('dragover');
      }
    });
    root.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      c.dragDepth = 0;
      root.classList.remove('dragover');
      var dt = e.dataTransfer;
      if (dt.files && dt.files.length) {
        assignFiles(dt.files, key);
        return;
      }
      var txt = dt.getData('text/plain') || '';
      if (txt.indexOf('hairselfie:') === 0) {
        var src = txt.slice('hairselfie:'.length);
        if (src !== key && state.slots[src]) swapSlots(src, key);
      }
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
      pendingSlot = key;
      fileSingle.click();
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
    c.root.draggable = !!slot;
    if (slot) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      var w = c.root.clientWidth, h = c.root.clientHeight;
      if (w && h) {
        c.canvas.width = Math.round(w * dpr);
        c.canvas.height = Math.round(h * dpr);
        var ctx = c.canvas.getContext('2d');
        Composer.drawSlot(ctx, slot, 0, 0, c.canvas.width, c.canvas.height);
      }
    }
  }

  function rerenderAll() {
    SLOT_KEYS.forEach(function (k) {
      if (state.slots[k]) renderCell(k);
    });
  }

  /* ── files in ────────────────────────────────────────────────── */

  function looksLikeImage(file) {
    return /^image\//i.test(file.type) ||
      /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name || '');
  }

  function assignFiles(fileList, preferKey) {
    var files = Array.prototype.slice.call(fileList).filter(looksLikeImage);
    if (!files.length) return;

    var targets = [];
    if (preferKey) targets.push(preferKey);
    SLOT_KEYS.forEach(function (k) {
      if (k !== preferKey && !state.slots[k]) targets.push(k);
    });
    SLOT_KEYS.forEach(function (k) {
      if (targets.indexOf(k) === -1 && targets.length < files.length) targets.push(k);
    });

    files.slice(0, targets.length).forEach(function (f, i) {
      setSlotImage(targets[i], f);
    });
  }

  function setSlotImage(key, file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var old = state.slots[key];
      if (old && old.url) URL.revokeObjectURL(old.url);
      state.slots[key] = { img: img, url: url, zoom: 1, panX: 0, panY: 0, rot: 0, fileName: file.name };
      clearSelection();
      renderCell(key);
      updateCreateStatus();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert('Couldn’t read “' + (file.name || 'that file') + '”.\nIf it’s a HEIC photo, this browser may not support it — try exporting it as JPEG or PNG.');
    };
    img.src = url;
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
    var ctx = adjCanvas.getContext('2d');
    Composer.drawSlot(ctx, adjustSlot, 0, 0, adjCanvas.width, adjCanvas.height);
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
    adjZoom.addEventListener('input', function () {
      setAdjustZoom(adjZoom.value / 100);
    });

    $('#adjust-rotate').addEventListener('click', function () {
      if (!adjustSlot) return;
      adjustSlot.rot = ((adjustSlot.rot || 0) + 90) % 360;
      var rect = adjCanvas.getBoundingClientRect();
      Composer.clampPan(adjustSlot, rect.width || 4, rect.height || 5);
      drawAdjust();
    });

    $('#adjust-reset').addEventListener('click', function () {
      if (!adjustSlot) return;
      adjustSlot.zoom = 1;
      adjustSlot.panX = 0;
      adjustSlot.panY = 0;
      adjustSlot.rot = 0;
      adjZoom.value = 100;
      drawAdjust();
    });

    $('#adjust-done').addEventListener('click', function () { closeAdjust(true); });
    $('#adjust-cancel').addEventListener('click', function () { closeAdjust(false); });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeAdjust(false);
    });

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

  /* ── performer details / coordinator ─────────────────────────── */

  function fillForm(p) {
    FIELDS.forEach(function (k) {
      infoForm.elements[k].value = (p && p[k]) || '';
    });
  }

  function readForm() {
    var o = {};
    FIELDS.forEach(function (k) {
      o[k] = infoForm.elements[k].value.trim();
    });
    return o;
  }

  /* Everything that gets printed on the sheet: profile fields plus the note. */
  function readSheet() {
    var o = readForm();
    o.note = noteInput.value.trim();
    return o;
  }

  function updateNoteCount() {
    var used = noteInput.value.length;
    noteCount.textContent = used ? used + ' / ' + NOTE_MAX : '';
    noteCount.classList.toggle('near-limit', used > NOTE_MAX - 20);
  }

  var persistProfile = debounce(function () {
    if (Api.isDemo && !state.performer) {
      Api.saveLocalProfile(Object.assign({ id: 'demo-me' }, readForm()));
    }
  }, 350);

  function renderSessionChip(failed) {
    var chip = $('#session-chip');
    if (failed) {
      chip.textContent = 'Not signed in';
      return;
    }
    chip.innerHTML =
      'Signed in as <b>' + esc(state.me.name || 'Guest') + '</b>' +
      (state.coordinator ? '<span class="role-tag">Coordinator</span>' : '');
  }

  function renderDemoBanner() {
    var banner = $('#demo-banner');
    if (!Api.isDemo) { banner.hidden = true; return; }
    banner.hidden = false;
    var sel = $('#demo-role');
    sel.value = Api.getDemoRole() || 'performer';

    /* Re-render in place rather than reloading, so switching roles keeps
       the photos and anything already typed into the form. */
    sel.addEventListener('change', function () {
      Api.setDemoRole(sel.value);
      state.coordinator = sel.value === 'coordinator';
      if (!state.coordinator && state.performer) {
        state.performer = null;
        fillForm(state.me);
      }
      renderSessionChip();
      renderPerfSource();
      renderCoordinatorBox();
    });
  }

  function renderPerfSource() {
    var el = $('#perf-source');
    if (state.performer) {
      el.innerHTML =
        'Creating for <b>' + esc(state.performer.name) + '</b>' +
        '<span class="pill">coordinator selection</span>' +
        '<button class="btn btn-small" id="ps-reset" type="button">Switch back to me</button>';
      el.classList.add('show');
      $('#ps-reset').addEventListener('click', resetPerformer);
    } else {
      el.classList.remove('show');
      el.innerHTML = '';
    }
  }

  function selectPerformer(p) {
    state.performer = p;
    fillForm(p);
    renderPerfSource();
    renderCoordCurrent();
  }

  function resetPerformer() {
    state.performer = null;
    fillForm(state.me);
    renderPerfSource();
    renderCoordCurrent();
    var search = $('#perf-search');
    if (search) search.value = '';
  }

  function renderCoordCurrent() {
    var el = $('#coord-current');
    if (!el) return;
    if (state.performer) {
      el.innerHTML =
        'Creating for: <b>' + esc(state.performer.name) + '</b> ' +
        '<button class="btn" id="coord-reset" type="button">Switch back to me</button>';
      $('#coord-reset').addEventListener('click', resetPerformer);
    } else {
      el.innerHTML = 'Creating for: <b>You — ' + esc(state.me.name || 'yourself') + '</b> <span>(default)</span>';
    }
  }

  function renderCoordinatorBox() {
    var box = $('#coordinator-box');

    if (!state.coordinator) {
      box.innerHTML =
        '<div class="coord locked">' +
        '<span class="lock" aria-hidden="true">🔒</span>' +
        '<span><b>Coordinator tools.</b> Locked — sign in with a coordinator account to create sheets for other performers.</span>' +
        '</div>';
      return;
    }

    box.innerHTML =
      '<div class="coord">' +
        '<div class="coord-head">Coordinator tools <span class="coord-badge">Coordinator</span></div>' +
        '<p class="hint">Making a sheet for someone else? Find them here — their details replace yours in the form above (you can still edit before creating).</p>' +
        '<div class="ac-wrap">' +
          '<input type="search" id="perf-search" placeholder="Start typing a performer’s name…" ' +
                 'role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="perf-listbox" autocomplete="off">' +
          '<div class="ac-list" id="perf-listbox" role="listbox" hidden></div>' +
        '</div>' +
        '<div class="coord-current" id="coord-current"></div>' +
      '</div>';

    renderCoordCurrent();
    wireAutocomplete();
  }

  function wireAutocomplete() {
    var input = $('#perf-search');
    var list = $('#perf-listbox');
    var items = [];
    var activeIndex = -1;
    var searchSeq = 0;

    function closeList() {
      list.hidden = true;
      list.innerHTML = '';
      items = [];
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
    }

    function renderList(results) {
      if (!results.length) {
        list.innerHTML = '<div class="ac-empty">No performers match “' + esc(input.value.trim()) + '”</div>';
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        items = [];
        activeIndex = -1;
        return;
      }
      list.innerHTML = results.map(function (p, i) {
        var meta = [p.height, p.weight].filter(Boolean).join(' · ');
        return '<button type="button" class="ac-item" role="option" id="ac-opt-' + i + '">' +
          '<span>' + esc(p.name) + '</span>' +
          (meta ? '<span class="ac-meta">' + esc(meta) + '</span>' : '') +
          '</button>';
      }).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      items = Array.prototype.slice.call(list.querySelectorAll('.ac-item'));
      activeIndex = -1;
      items.forEach(function (el, i) {
        el.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // keep input focus
        el.addEventListener('click', function () {
          selectPerformer(results[i]);
          input.value = results[i].name;
          closeList();
        });
      });
    }

    function setActive(i) {
      if (!items.length) return;
      activeIndex = (i + items.length) % items.length;
      items.forEach(function (el, j) {
        el.classList.toggle('active', j === activeIndex);
      });
      input.setAttribute('aria-activedescendant', 'ac-opt-' + activeIndex);
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    var runSearch = debounce(function () {
      var q = input.value.trim();
      var seq = ++searchSeq;
      if (!q) { closeList(); return; }
      Api.searchPerformers(q).then(function (results) {
        if (seq !== searchSeq) return;
        renderList(results);
      }).catch(function (err) {
        if (seq !== searchSeq) return;
        list.innerHTML = '<div class="ac-empty">Search failed — ' + esc(err.message) + '</div>';
        list.hidden = false;
      });
    }, 170);

    input.addEventListener('input', runSearch);

    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter') {
        if (activeIndex >= 0 && items[activeIndex]) { e.preventDefault(); items[activeIndex].click(); }
      } else if (e.key === 'Escape') {
        closeList();
      }
    });

    input.addEventListener('blur', function () {
      setTimeout(closeList, 150);
    });
  }

  /* ── create & download ───────────────────────────────────────── */

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
      .then(function () {
        var canvas = Composer.compose(state.slots, person, { labels: state.labels });
        return Composer.toBlob(canvas);
      })
      .then(function (blob) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(blob);
        resultImg.src = resultUrl;
        var date = new Date().toISOString().slice(0, 10);
        downloadLink.href = resultUrl;
        downloadLink.download =
          'hair-selfie_' + (slugify(person.name) || 'performer') + '_' + date + '.' + Composer.fileExtension();
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

  /* ── static wiring & init ────────────────────────────────────── */

  function loadPrefs() {
    var prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(LS_PREFS)) || {}; } catch (e) { /* ignore */ }
    var guides = prefs.guides !== false;
    state.labels = prefs.labels !== false;
    $('#toggle-guides').checked = guides;
    $('#toggle-labels').checked = state.labels;
    grid.classList.toggle('guides-on', guides);
  }

  function savePrefs() {
    try {
      localStorage.setItem(LS_PREFS, JSON.stringify({
        guides: $('#toggle-guides').checked,
        labels: $('#toggle-labels').checked
      }));
    } catch (e) { /* ignore */ }
  }

  function wireStatic() {
    $('#add-photos').addEventListener('click', function () { fileMulti.click(); });

    fileMulti.addEventListener('change', function () {
      assignFiles(fileMulti.files);
      fileMulti.value = '';
    });

    fileSingle.addEventListener('change', function () {
      if (fileSingle.files.length && pendingSlot) {
        assignFiles(fileSingle.files, pendingSlot);
      }
      pendingSlot = null;
      fileSingle.value = '';
    });

    $('#toggle-guides').addEventListener('change', function (e) {
      grid.classList.toggle('guides-on', e.target.checked);
      savePrefs();
    });
    $('#toggle-labels').addEventListener('change', function (e) {
      state.labels = e.target.checked;
      savePrefs();
    });

    infoForm.addEventListener('submit', function (e) { e.preventDefault(); });
    infoForm.addEventListener('input', function () {
      if (!state.performer) state.me = Object.assign({}, state.me, readForm());
      persistProfile();
    });

    noteInput.addEventListener('input', updateNoteCount);
    updateNoteCount();

    createBtn.addEventListener('click', doCreate);
    $('#back-to-edit').addEventListener('click', function () {
      $('#photos-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    /* don’t let stray drops navigate the page away; drop on the grid
       gutter fills empty slots in order */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    grid.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        assignFiles(e.dataTransfer.files);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!modal.hidden) closeAdjust(false);
        else clearSelection();
      }
    });

    if (window.ResizeObserver) {
      var raf = 0;
      var ro = new ResizeObserver(function () {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(rerenderAll);
      });
      ro.observe(grid);
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

    Api.getSession().then(function (session) {
      state.me = session.user || {};
      state.coordinator = !!session.coordinator;
      fillForm(state.me);
      renderSessionChip();
      renderDemoBanner();
      renderCoordinatorBox();
      renderPerfSource();
    }).catch(function (err) {
      console.error('session failed', err);
      state.me = {};
      state.coordinator = false;
      renderSessionChip(true);
      renderDemoBanner();
      renderCoordinatorBox();
    });
  }

  /* exposed for integration debugging and automated tests */
  window.HairSelfie = {
    state: state,
    renderCell: renderCell,
    assignFiles: assignFiles,
    doCreate: doCreate
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
