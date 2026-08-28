/*
 * Canvas rendering: the one drawSlot() routine is shared by the grid
 * thumbnails, the adjust editor and the final sheet, so what you see while
 * framing is exactly what gets exported.
 *
 * A slot looks like:
 *   { img, zoom (1..4), panX, panY (fractions of the cell size), rot (0/90/180/270) }
 */
window.Composer = (function () {
  'use strict';

  /*
   * A LEFT side view means the camera sees your left ear, which puts the nose
   * on the viewer's left — so 'left' uses the profile unmirrored.
   */
  var SLOT_DEFS = [
    { key: 'front', label: 'Front',      outline: 'front',   mirror: false, facing: '' },
    { key: 'left',  label: 'Left side',  outline: 'profile', mirror: false, facing: 'left ear to camera' },
    { key: 'right', label: 'Right side', outline: 'profile', mirror: true,  facing: 'right ear to camera' },
    { key: 'back',  label: 'Back',       outline: 'front',   mirror: false, facing: '' }
  ];

  /*
   * One photo instead of four. Same info band underneath — the band does
   * not care how many cells are above it.
   */
  var HEADSHOT_DEFS = [
    { key: 'front', label: 'Headshot', outline: 'front', mirror: false, facing: '' }
  ];

  /*
   * Wardrobe is the same four angles as hair, with a standing figure to
   * frame against instead of a head — and a taller cell, because a whole
   * person in a 4:5 frame is mostly empty air either side.
   */
  var WARDROBE_DEFS = [
    { key: 'front', label: 'Front',      outline: 'body',        mirror: false, facing: '' },
    { key: 'left',  label: 'Left side',  outline: 'bodyProfile', mirror: false, facing: 'left side to camera' },
    { key: 'right', label: 'Right side', outline: 'bodyProfile', mirror: true,  facing: 'right side to camera' },
    { key: 'back',  label: 'Back',       outline: 'body',        mirror: false, facing: '' }
  ];

  var LAYOUTS = {
    sheet:    { cols: 2, rows: 2, cellWidth: 1000, cellHeight: 1250, defs: SLOT_DEFS },
    /* cropped in at the sides: a standing figure does not need the width a
       head-and-shoulders shot does, and the empty air was the least useful
       part of the frame */
    wardrobe: { cols: 2, rows: 2, cellWidth: 800, cellHeight: 1500, defs: WARDROBE_DEFS,
                /* you have to walk back to be in a full-length frame */
                firstSeconds: 5 },
    headshot: { cols: 1, rows: 1, cellWidth: 1600, cellHeight: 2000, defs: HEADSHOT_DEFS }
  };

  /* A layout, with anything set in config applied over it. */
  function layoutFor(name) {
    var base = LAYOUTS[name] || LAYOUTS.sheet;
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    var over = (LAYOUTS[name] && name !== 'sheet' ? out[name] : out) || {};
    return {
      name: LAYOUTS[name] ? name : 'sheet',
      cols: base.cols,
      rows: base.rows,
      cellWidth: over.cellWidth || base.cellWidth,
      cellHeight: over.cellHeight || base.cellHeight,
      firstSeconds: over.firstSeconds || base.firstSeconds || 3,
      defs: base.defs
    };
  }

  var FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function imgSize(img) {
    return {
      w: img.naturalWidth || img.width,
      h: img.naturalHeight || img.height
    };
  }

  /* Dimensions of the image after rotation, before scaling. */
  function effectiveSize(slot) {
    var s = imgSize(slot.img);
    var rotated = ((slot.rot || 0) % 180) !== 0;
    return { w: rotated ? s.h : s.w, h: rotated ? s.w : s.h };
  }

  /*
   * How far the photo may be panned inside a w×h cell, expressed as
   * fractions of the cell size (so the same slot state renders identically
   * in the small thumbnails and the full-resolution sheet).
   */
  function panLimits(slot, w, h) {
    var eff = effectiveSize(slot);
    var s0 = Math.max(w / eff.w, h / eff.h);
    var S = s0 * (slot.zoom || 1);
    return {
      x: Math.max(0, (eff.w * S - w) / 2) / w,
      y: Math.max(0, (eff.h * S - h) / 2) / h
    };
  }

  function clampPan(slot, w, h) {
    var lim = panLimits(slot, w, h);
    slot.panX = clamp(slot.panX || 0, -lim.x, lim.x);
    slot.panY = clamp(slot.panY || 0, -lim.y, lim.y);
  }

  /* Draw one slot (photo or placeholder) into the rect x,y,w,h. */
  function drawSlot(ctx, slot, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = '#101114';
    ctx.fillRect(x, y, w, h);

    if (slot && slot.img) {
      var size = imgSize(slot.img);
      var eff = effectiveSize(slot);
      var s0 = Math.max(w / eff.w, h / eff.h);
      var S = s0 * (slot.zoom || 1);
      var lim = panLimits(slot, w, h);
      var px = clamp(slot.panX || 0, -lim.x, lim.x) * w;
      var py = clamp(slot.panY || 0, -lim.y, lim.y) * h;

      ctx.translate(x + w / 2 + px, y + h / 2 + py);
      ctx.rotate((slot.rot || 0) * Math.PI / 180);
      ctx.scale(S, S);
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(slot.img, -size.w / 2, -size.h / 2);
    }

    ctx.restore();
  }

  /* Placeholder art for a cell with no photo (used in the final sheet). */
  function drawPlaceholder(ctx, def, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#14161a';
    ctx.fillRect(x, y, w, h);

    if (typeof Path2D !== 'undefined' && window.Outlines) {
      var k = Math.min(w / Outlines.VIEW_W, h / Outlines.VIEW_H) * 0.86;
      var ox = x + (w - Outlines.VIEW_W * k) / 2;
      var oy = y + (h - Outlines.VIEW_H * k) / 2;
      var m = def.mirror
        ? new DOMMatrix([-k, 0, 0, k, ox + Outlines.VIEW_W * k, oy])
        : new DOMMatrix([k, 0, 0, k, ox, oy]);
      var path = new Path2D();
      path.addPath(new Path2D(Outlines.pathFor(def.outline)), m);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(3, w * 0.006);
      ctx.setLineDash([w * 0.016, w * 0.018]);
      ctx.lineCap = 'round';
      ctx.stroke(path);
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 ' + Math.round(h * 0.036) + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(def.label.toUpperCase() + ' — NO PHOTO', x + w / 2, y + h - h * 0.045);
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }
  }

  /*
   * Pick the largest font size (up to maxPx) at which text still fits
   * targetW — so short names render big and long ones step down, and either
   * way the line reaches across the sheet.
   */
  function fitWidth(ctx, text, weight, targetW, minPx, maxPx, spacing) {
    var px = maxPx;
    for (;;) {
      if ('letterSpacing' in ctx) ctx.letterSpacing = (spacing || 0) + 'px';
      ctx.font = weight + ' ' + px + 'px ' + FONT_STACK;
      if (ctx.measureText(text).width <= targetW || px <= minPx) {
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        return px;
      }
      px -= 2;
    }
  }

  /* Hard-split a word that is wider than the line all by itself. */
  function splitLongWord(ctx, word, maxWidth) {
    var parts = [];
    var cur = '';
    for (var i = 0; i < word.length; i++) {
      var test = cur + word.charAt(i);
      if (cur && ctx.measureText(test).width > maxWidth) {
        parts.push(cur);
        cur = word.charAt(i);
      } else {
        cur = test;
      }
    }
    if (cur) parts.push(cur);
    return parts;
  }

  /*
   * Greedy word wrap at the current ctx.font, capped at maxLines.
   * If the text still doesn't fit, the last line is ellipsized.
   */
  function wrapText(ctx, text, maxWidth, maxLines) {
    var words = [];
    String(text).split(/\s+/).filter(Boolean).forEach(function (w) {
      if (ctx.measureText(w).width <= maxWidth) words.push(w);
      else words.push.apply(words, splitLongWord(ctx, w, maxWidth));
    });

    var lines = [];
    var cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (!cur || ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        lines.push(cur);
        cur = w;
      }
    });
    if (cur) lines.push(cur);

    if (lines.length <= maxLines) return lines;

    lines = lines.slice(0, maxLines);
    var last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1).replace(/\s+$/, '');
    }
    lines[maxLines - 1] = last + '…';
    return lines;
  }

  /*
   * Build the final sheet. Returns a canvas:
   *   ┌─────────┬─────────┐
   *   │  FRONT  │  LEFT   │
   *   ├─────────┼─────────┤
   *   │  RIGHT  │  BACK   │
   *   ├─────────────────────┤
   *   │  N A M E            │  ← white on black, full width, below the photos
   *   │  h · w · ph · email │
   *   │  optional note      │
   *   │  [CUT] [SHAVE]      │
   *   └─────────────────────┘
   */
  function compose(slots, person, layoutName) {
    var L = layoutFor(layoutName);
    var defs = L.defs;
    var CW = L.cellWidth;
    var CH = L.cellHeight;
    var GUT = Math.round(CW * 0.016);

    var fullW = CW * L.cols + GUT * (L.cols - 1);   // text runs the full image width
    /*
     * Type is sized against the image, not against a cell, so a one-photo
     * headshot and a four-photo sheet carry the same-looking name and
     * details rather than one of them coming out twice the weight. The
     * divisor is the sheet's own width-to-cell ratio, so the sheet renders
     * exactly as it did before this existed.
     */
    var TS = fullW / 2.016;
    var M = Math.round(TS * 0.028);

    var W = fullW + M * 2;
    var gridH = CH * L.rows + GUT * (L.rows - 1);
    var scratch = document.createElement('canvas').getContext('2d');

    /* name — as large as it can be while spanning the sheet */
    var name = ((person && person.name) || '').trim().toUpperCase();
    var nameSpacing = Math.round(TS * 0.007);
    var nameSize = name
      ? fitWidth(scratch, name, '800', fullW, 44, Math.round(TS * 0.23), nameSpacing)
      : 0;

    /* contact details — one line if they fit, otherwise two */
    /* Phone and weight print in one consistent shape no matter how they
       were typed or what the user table happened to hold. */
    var fmt = window.HairSelfieFormat || {};
    var fields = ['height', 'weight', 'phone', 'email'].map(function (k) {
      var v = ((person && person[k]) || '').trim();
      if (k === 'weight' && fmt.weight) return fmt.weight(v);
      if (k === 'phone' && fmt.phone) return fmt.phone(v);
      if (k === 'height' && fmt.height) return fmt.height(v);
      return v;
    }).filter(Boolean);

    var SEP = '   ·   ';
    var detailMax = Math.round(TS * 0.085);
    var detailLines = [];
    if (fields.length) {
      var one = fields.join(SEP);
      var oneSize = fitWidth(scratch, one, '600', fullW, 30, detailMax, 0);
      if (oneSize >= 40 || fields.length === 1) {
        detailLines = [{ text: one, size: oneSize }];
      } else {
        var half = Math.ceil(fields.length / 2);
        var a = fields.slice(0, half).join(SEP);
        var b = fields.slice(half).join(SEP);
        var sizeA = fitWidth(scratch, a, '600', fullW, 30, detailMax, 0);
        var sizeB = fitWidth(scratch, b, '600', fullW, 30, detailMax, 0);
        var both = Math.min(sizeA, sizeB);
        detailLines = [{ text: a, size: both }, { text: b, size: both }];
      }
    }

    /* optional note */
    var noteText = ((person && person.note) || '').trim().replace(/\s+/g, ' ');
    var noteSize = 0;
    var noteLines = [];
    if (noteText) {
      noteSize = Math.round(TS * 0.044);
      scratch.font = '400 ' + noteSize + 'px ' + FONT_STACK;
      noteLines = wrapText(scratch, noteText, Math.round(fullW * 0.94), 2);
    }

    /* capability chips */
    var chips = [];
    if (person && person.canCut) chips.push('ABLE TO CUT HAIR');
    if (person && person.canShave) chips.push('ABLE TO SHAVE');
    var chipSize = Math.round(TS * 0.048);
    var chipPadX = Math.round(chipSize * 0.85);
    var chipH = Math.round(chipSize * 2.3);
    var chipGap = Math.round(TS * 0.022);

    /* vertical rhythm */
    var gapTop = Math.round(TS * 0.075);
    var gapBottom = Math.round(TS * 0.075);
    var lineGap = Math.round(TS * 0.024);
    var noteGap = Math.round(TS * 0.032);
    var noteLineGap = Math.round(noteSize * 0.34);
    var chipGapTop = Math.round(TS * 0.038);

    var infoH = gapTop + gapBottom;
    if (nameSize) infoH += nameSize;
    if (nameSize && detailLines.length) infoH += lineGap;
    detailLines.forEach(function (l, i) {
      infoH += l.size + (i > 0 ? lineGap : 0);
    });
    if (noteLines.length) {
      if (nameSize || detailLines.length) infoH += noteGap;
      noteLines.forEach(function (_, i) {
        infoH += noteSize + (i > 0 ? noteLineGap : 0);
      });
    }
    if (chips.length) {
      if (nameSize || detailLines.length || noteLines.length) infoH += chipGapTop;
      infoH += chipH;
    }
    if (!nameSize && !detailLines.length && !noteLines.length && !chips.length) {
      infoH = Math.round(TS * 0.04);
    }

    var H = M + gridH + infoH;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    defs.forEach(function (def, i) {
      var col = i % L.cols;
      var row = Math.floor(i / L.cols);
      var x = M + col * (CW + GUT);
      var y = M + row * (CH + GUT);
      var slot = slots[def.key];
      if (slot && slot.img) drawSlot(ctx, slot, x, y, CW, CH);
      else drawPlaceholder(ctx, def, x, y, CW, CH);
    });

    /* ── info band: white on black, below the photos ── */
    var ty = M + gridH + gapTop;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    if (nameSize) {
      if ('letterSpacing' in ctx) ctx.letterSpacing = nameSpacing + 'px';
      ctx.font = '800 ' + nameSize + 'px ' + FONT_STACK;
      ctx.fillStyle = '#fff';
      ctx.fillText(name, W / 2, ty);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ty += nameSize + (detailLines.length ? lineGap : 0);
    }

    detailLines.forEach(function (l, i) {
      if (i > 0) ty += lineGap;
      ctx.font = '600 ' + l.size + 'px ' + FONT_STACK;
      ctx.fillStyle = '#fff';
      ctx.fillText(l.text, W / 2, ty);
      ty += l.size;
    });

    if (noteLines.length) {
      if (nameSize || detailLines.length) ty += noteGap;
      ctx.font = '400 ' + noteSize + 'px ' + FONT_STACK;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      noteLines.forEach(function (line, i) {
        if (i > 0) ty += noteLineGap;
        ctx.fillText(line, W / 2, ty);
        ty += noteSize;
      });
    }

    if (chips.length) {
      if (nameSize || detailLines.length || noteLines.length) ty += chipGapTop;
      ctx.font = '700 ' + chipSize + 'px ' + FONT_STACK;
      var widths = chips.map(function (c) { return ctx.measureText(c).width + chipPadX * 2; });
      var totalW = widths.reduce(function (a, b) { return a + b; }, 0) +
                   chipGap * (chips.length - 1);
      var cx = (W - totalW) / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      chips.forEach(function (c, i) {
        roundRectPath(ctx, cx, ty, widths[i], chipH, chipH / 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(2, TS * 0.0028);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(c, cx + chipPadX, ty + chipH / 2 + chipSize * 0.05);
        cx += widths[i] + chipGap;
      });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
    }

    return canvas;
  }

  function mimeType() {
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    return out.format || 'image/jpeg';
  }

  function toBlob(canvas) {
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    var format = mimeType();
    var quality = typeof out.quality === 'number' ? out.quality : 0.92;
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('could not encode image'));
        }, format, quality);
      } else {
        try {
          var dataUrl = canvas.toDataURL(format, quality);
          var bin = atob(dataUrl.split(',')[1]);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          resolve(new Blob([bytes], { type: format }));
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  function fileExtension() {
    return mimeType() === 'image/png' ? 'png' : 'jpg';
  }

  return {
    SLOT_DEFS: SLOT_DEFS,
    layoutFor: layoutFor,
    drawSlot: drawSlot,
    panLimits: panLimits,
    clampPan: clampPan,
    compose: compose,
    toBlob: toBlob,
    mimeType: mimeType,
    fileExtension: fileExtension
  };
})();
