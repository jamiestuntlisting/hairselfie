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

  function pathFor(kind) {
    return kind === 'profile' ? PROFILE_PATH : FRONT_PATH;
  }

  /* Inline SVG markup for a guide. mirror=true flips it horizontally. */
  function svgMarkup(kind, mirror) {
    var transform = mirror ? ' transform="translate(400 0) scale(-1 1)"' : '';
    return (
      '<svg viewBox="' + VIEWBOX + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="' + pathFor(kind) + '"' + transform +
      ' fill="none" stroke="currentColor" stroke-width="6"' +
      ' stroke-dasharray="13 15" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  return {
    VIEW_W: 400,
    VIEW_H: 500,
    pathFor: pathFor,
    svgMarkup: svgMarkup
  };
})();
