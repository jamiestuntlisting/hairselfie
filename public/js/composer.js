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

  var SLOT_DEFS = [
    { key: 'front', label: 'Front',      outline: 'front',   mirror: false },
    { key: 'left',  label: 'Left side',  outline: 'profile', mirror: false },
    { key: 'right', label: 'Right side', outline: 'profile', mirror: true  },
    { key: 'back',  label: 'Back',       outline: 'front',   mirror: false }
  ];

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
      var k = Math.min(w / Outlines.VIEW_W, h / Outlines.VIEW_H) * 0.62;
      var ox = x + (w - Outlines.VIEW_W * k) / 2;
      var oy = y + (h - Outlines.VIEW_H * k) / 2 - h * 0.03;
      var m = def.mirror
        ? new DOMMatrix([-k, 0, 0, k, ox + Outlines.VIEW_W * k, oy])
        : new DOMMatrix([k, 0, 0, k, ox, oy]);
      var path = new Path2D();
      path.addPath(new Path2D(Outlines.pathFor(def.outline)), m);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(3, w * 0.005);
      ctx.setLineDash([w * 0.014, w * 0.016]);
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

  /* Shrink a font size until text fits maxWidth (or minPx is reached). */
  function fitFont(ctx, text, weight, startPx, minPx, maxWidth) {
    var px = startPx;
    for (;;) {
      ctx.font = weight + ' ' + px + 'px ' + FONT_STACK;
      if (ctx.measureText(text).width <= maxWidth || px <= minPx) return px;
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
   *   │  NAME               │  ← white on black, below the photos
   *   │  h • w • ph • email │
   *   │  optional note      │
   *   └─────────────────────┘
   */
  function compose(slots, person, opts) {
    opts = opts || {};
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    var CW = out.cellWidth || 1000;
    var CH = out.cellHeight || 1250;
    var GUT = Math.round(CW * 0.016);
    var M = Math.round(CW * 0.028);

    var W = M * 2 + CW * 2 + GUT;
    var gridH = CH * 2 + GUT;
    var maxTextW = W - (M + 30) * 2;

    var scratch = document.createElement('canvas').getContext('2d');

    var name = ((person && person.name) || '').trim().toUpperCase();
    var nameSize = 0;
    if (name) {
      if ('letterSpacing' in scratch) scratch.letterSpacing = '6px';
      nameSize = fitFont(scratch, name, '700', Math.round(CW * 0.092), 48, maxTextW);
      if ('letterSpacing' in scratch) scratch.letterSpacing = '0px';
    }

    var fields = ['height', 'weight', 'phone', 'email'].map(function (k) {
      return ((person && person[k]) || '').trim();
    }).filter(Boolean);

    var SEP = '   •   ';
    var detailLines = [];
    if (fields.length) {
      var one = fields.join(SEP);
      var oneSize = fitFont(scratch, one, '400', Math.round(CW * 0.046), 38, maxTextW);
      scratch.font = '400 ' + oneSize + 'px ' + FONT_STACK;
      if (scratch.measureText(one).width <= maxTextW || fields.length === 1) {
        detailLines = [{ text: one, size: oneSize }];
      } else {
        var last = fields[fields.length - 1];
        var first = fields.slice(0, -1).join(SEP);
        detailLines = [
          { text: first, size: fitFont(scratch, first, '400', Math.round(CW * 0.046), 38, maxTextW) },
          { text: last,  size: fitFont(scratch, last,  '400', Math.round(CW * 0.046), 38, maxTextW) }
        ];
      }
    }

    /* optional short note, wrapped to at most two lines */
    var noteText = ((person && person.note) || '').trim().replace(/\s+/g, ' ');
    var noteSize = 0;
    var noteLines = [];
    var noteW = Math.min(maxTextW, Math.round(W * 0.84));
    if (noteText) {
      noteSize = Math.round(CW * 0.040);
      scratch.font = '400 ' + noteSize + 'px ' + FONT_STACK;
      noteLines = wrapText(scratch, noteText, noteW, 2);
    }

    var gapTop = Math.round(CW * 0.085);
    var gapBottom = Math.round(CW * 0.09);
    var lineGap = Math.round(CW * 0.022);
    var noteGap = Math.round(CW * 0.036);
    var noteLineGap = Math.round(noteSize * 0.34);
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
    if (!nameSize && !detailLines.length && !noteLines.length) infoH = Math.round(CW * 0.04);

    var H = M + gridH + infoH;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    SLOT_DEFS.forEach(function (def, i) {
      var col = i % 2;
      var row = i >> 1;
      var x = M + col * (CW + GUT);
      var y = M + row * (CH + GUT);
      var slot = slots[def.key];

      if (slot && slot.img) {
        drawSlot(ctx, slot, x, y, CW, CH);
      } else {
        drawPlaceholder(ctx, def, x, y, CW, CH);
      }

      if (opts.labels && slot && slot.img) {
        var text = def.label.toUpperCase();
        var fs = Math.round(CW * 0.036);
        ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
        var tw = ctx.measureText(text).width;
        var padX = Math.round(fs * 0.55);
        var chipH = Math.round(fs * 1.7);
        var cx = x + Math.round(CW * 0.024);
        var cy = y + CH - chipH - Math.round(CW * 0.024);
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        roundRectPath(ctx, cx, cy, tw + padX * 2, chipH, Math.round(fs * 0.35));
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx + padX, cy + chipH / 2 + fs * 0.06);
        ctx.textBaseline = 'alphabetic';
      }
    });

    /* info band — white text on the black background, below the photos */
    var ty = M + gridH + gapTop;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';

    if (nameSize) {
      if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
      ctx.font = '700 ' + nameSize + 'px ' + FONT_STACK;
      ctx.fillText(name, W / 2, ty);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ty += nameSize + (detailLines.length ? lineGap : 0);
    }

    detailLines.forEach(function (l, i) {
      if (i > 0) ty += lineGap;
      ctx.font = '400 ' + l.size + 'px ' + FONT_STACK;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(l.text, W / 2, ty);
      ty += l.size;
    });

    if (noteLines.length) {
      if (nameSize || detailLines.length) ty += noteGap;
      ctx.font = '400 ' + noteSize + 'px ' + FONT_STACK;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      noteLines.forEach(function (line, i) {
        if (i > 0) ty += noteLineGap;
        ctx.fillText(line, W / 2, ty);
        ty += noteSize;
      });
    }

    return canvas;
  }

  function toBlob(canvas) {
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    var format = out.format || 'image/jpeg';
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
    var out = (window.HAIRSELFIE_CONFIG && window.HAIRSELFIE_CONFIG.output) || {};
    return (out.format || 'image/jpeg') === 'image/png' ? 'png' : 'jpg';
  }

  return {
    SLOT_DEFS: SLOT_DEFS,
    drawSlot: drawSlot,
    panLimits: panLimits,
    clampPan: clampPan,
    compose: compose,
    toBlob: toBlob,
    fileExtension: fileExtension
  };
})();
