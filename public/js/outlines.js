/*
 * Passport-style head guides.
 *
 * Both outlines are drawn in the same 400×500 box (the 4:5 aspect of a photo
 * cell) on a shared skeleton, so the head is the same size and sits in the
 * same place whichever position you are looking at:
 *
 *   cranium   x 100 → 300, y 62 → 332   (centred on x = 200)
 *   neck      y 328 → 372
 *   shoulders reach x 30 → 370 at y 488
 *
 * The profile only breaks that box where a face should — the nose pushes out
 * to x ≈ 82 — which is what makes the facing direction readable at a glance.
 *
 *   'front'   — facing the camera (also used for the back of the head)
 *   'profile' — side view with the nose pointing LEFT
 *
 * Which way should a side shot face? For a LEFT side view the camera sees
 * your left ear, which puts your nose on the viewer's left — so the left
 * slot uses the profile unmirrored, and the right slot mirrors it.
 */
window.Outlines = (function () {
  'use strict';

  var VIEWBOX = '0 0 400 500';

  /*
   * The head guides are drawn a little larger than the box they were laid
   * out in, so the head fills more of the photo. The shoulders run off the
   * sides and the bottom at this scale, which is what they do in a real
   * head-and-shoulders shot anyway.
   */
  var HEAD_GROW = 1.18;

  var FRONT_PATH = [
    // cranium
    'M200 62 C 255 62 300 112 300 180 C 300 262 255 332 200 332',
    'C 145 332 100 262 100 180 C 100 112 145 62 200 62 Z',
    // ears
    'M100 190 C 84 181 75 203 89 223 C 95 231 100 235 105 235',
    'M300 190 C 316 181 325 203 311 223 C 305 231 300 235 295 235',
    // neck
    'M168 328 C 168 346 167 360 164 372',
    'M232 328 C 232 346 233 360 236 372',
    // shoulders
    'M164 372 C 118 383 60 410 30 488',
    'M236 372 C 282 383 340 410 370 488'
  ].join(' ');

  var PROFILE_PATH = [
    // back of the skull, crown → nape
    'M200 62 C 255 62 300 112 300 180 C 300 240 285 285 262 308',
    'C 258 322 260 340 268 356',
    // face, crown → forehead → nose → lips → chin → jaw
    'M200 62 C 148 64 108 110 104 168',
    'C 103 182 100 192 92 202',
    'C 84 213 82 226 90 233',
    'C 96 238 94 244 89 250',
    'C 83 257 87 265 97 268',
    'C 104 271 103 277 99 283',
    'C 92 292 97 312 112 318',
    'C 126 326 140 332 168 335',
    // front of the neck
    'M168 335 C 170 350 169 362 166 372',
    // shoulders
    'M166 372 C 120 383 62 410 32 488',
    'M268 356 C 272 364 278 370 286 374 C 330 388 352 420 370 488',
    // ear
    'M208 190 C 226 184 238 204 228 226 C 221 240 209 243 203 236'
  ].join(' ');

  /*
   * A standing figure for wardrobe, in a 2:3 box — a full body does not
   * belong in the 4:5 frame a head does. Head about an eighth of the
   * height, feet just off the bottom, so someone matching it is standing
   * far enough back to show the whole outfit.
   */
  var BODY_VIEWBOX = '0 0 400 600';

  var BODY_PATH = [
    // head
    'M200 26 C 226 26 247 50 247 82 C 247 114 226 138 200 138',
    'C 174 138 153 114 153 82 C 153 50 174 26 200 26 Z',
    // neck
    'M183 136 C 183 148 182 157 180 163',
    'M217 136 C 217 148 218 157 220 163',
    // shoulders and outer arms, down to the hands
    'M180 163 C 152 170 130 183 120 202 C 110 224 106 262 104 302',
    'C 102 332 103 352 106 374',
    'M220 163 C 248 170 270 183 280 202 C 290 224 294 262 296 302',
    'C 298 332 297 352 294 374',
    // hands
    'M106 374 C 99 383 100 396 109 399 C 118 402 125 395 124 385',
    'M294 374 C 301 383 300 396 291 399 C 282 402 275 395 276 385',
    // torso: under the arm, in to the waist, out to the hip
    'M136 200 C 130 240 127 268 129 300 C 131 322 133 336 137 352',
    'M264 200 C 270 240 273 268 271 300 C 269 322 267 336 263 352',
    // outer legs
    'M137 352 C 132 404 130 462 132 520 C 133 546 133 562 132 576',
    'M263 352 C 268 404 270 462 268 520 C 267 546 267 562 268 576',
    // inner legs, from the crotch down
    'M200 366 C 196 420 193 480 191 522 C 190 548 190 562 191 576',
    'M200 366 C 204 420 207 480 209 522 C 210 548 210 562 209 576',
    // feet
    'M132 576 C 121 580 113 584 113 588 L 191 588',
    'M268 576 C 279 580 287 584 287 588 L 209 588'
  ].join(' ');

  /* Declared after the paths they name, so nothing here is undefined. */
  var KINDS = {
    front:   { path: FRONT_PATH,   box: VIEWBOX,      grow: HEAD_GROW, about: [200, 62] },
    profile: { path: PROFILE_PATH, box: VIEWBOX,      grow: HEAD_GROW, about: [200, 62] },
    body:    { path: BODY_PATH,    box: BODY_VIEWBOX, grow: 1,         about: [200, 300] }
  };

  function kindFor(kind) {
    return KINDS[kind] || KINDS.front;
  }

  function boxWidth(box) {
    return parseFloat(box.split(/\s+/)[2]) || 400;
  }

  function pathFor(kind) {
    return kindFor(kind).path;
  }

  /* Inline SVG markup for a guide. mirror=true flips it horizontally. */
  function svgMarkup(kind, mirror) {
    var k = kindFor(kind);
    var parts = [];
    if (mirror) parts.push('translate(' + boxWidth(k.box) + ' 0) scale(-1 1)');
    if (k.grow !== 1) {
      parts.push('translate(' + k.about[0] + ' ' + k.about[1] + ')');
      parts.push('scale(' + k.grow + ')');
      parts.push('translate(' + (-k.about[0]) + ' ' + (-k.about[1]) + ')');
    }
    var transform = parts.length ? ' transform="' + parts.join(' ') + '"' : '';
    return (
      '<svg viewBox="' + k.box + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="' + k.path + '"' + transform +
      ' fill="none" stroke="currentColor" stroke-width="6"' +
      ' stroke-dasharray="13 15" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  return {
    VIEW_W: 400,
    VIEW_H: 500,
    HEAD_GROW: HEAD_GROW,
    pathFor: pathFor,
    kindFor: kindFor,
    svgMarkup: svgMarkup
  };
})();
