/*
 * Passport-style head guides.
 *
 * Two stylized head-and-shoulders outlines drawn in a 400×500 box
 * (same 4:5 aspect as the photo cells):
 *   - 'front'   — facing the camera (also used for the back of the head)
 *   - 'profile' — side view, nose pointing left (mirrored for the right side)
 */
window.Outlines = (function () {
  'use strict';

  var VIEWBOX = '0 0 400 500';

  var FRONT_PATH = [
    // head
    'M200 56 C 254 56 292 106 292 174 C 292 248 252 306 200 306',
    'C 148 306 108 248 108 174 C 108 106 146 56 200 56 Z',
    // ears
    'M108 190 C 94 182 86 202 98 220 C 103 227 108 230 112 230',
    'M292 190 C 306 182 314 202 302 220 C 297 227 292 230 288 230',
    // neck
    'M170 300 C 170 316 169 330 166 342',
    'M230 300 C 230 316 231 330 234 342',
    // shoulders
    'M166 342 C 118 352 66 382 42 452',
    'M234 342 C 282 352 334 382 358 452'
  ].join(' ');

  var PROFILE_PATH = [
    // crown → forehead → nose → lips → chin → jaw → throat
    'M206 58 C 158 60 126 100 122 152 C 121 168 119 178 112 188',
    'C 103 200 94 212 99 219 C 103 224 101 230 96 236',
    'C 91 243 94 250 103 253 C 109 255 108 260 104 265',
    'C 99 271 101 280 111 283 C 122 287 130 294 134 306',
    'C 140 324 156 337 178 342 C 179 356 178 366 175 374',
    // crown → back of skull → nape
    'M206 58 C 262 60 298 110 298 176 C 298 234 285 268 268 292',
    'C 266 310 268 327 275 342',
    // shoulders
    'M175 374 C 140 384 90 404 64 462',
    'M275 342 C 278 350 282 356 288 360 C 322 372 344 400 356 462',
    // ear
    'M212 208 C 228 200 240 216 230 236 C 224 248 214 252 208 246'
  ].join(' ');

  function pathFor(kind) {
    return kind === 'profile' ? PROFILE_PATH : FRONT_PATH;
  }

  /* Inline SVG markup for a guide. mirror=true flips horizontally. */
  function svgMarkup(kind, mirror) {
    var transform = mirror ? ' transform="translate(400 0) scale(-1 1)"' : '';
    return (
      '<svg viewBox="' + VIEWBOX + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="' + pathFor(kind) + '"' + transform +
      ' fill="none" stroke="currentColor" stroke-width="5"' +
      ' stroke-dasharray="11 13" stroke-linecap="round" stroke-linejoin="round"/>' +
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
