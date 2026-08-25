/*
 * Display formatting for the two fields that arrive in whatever shape the
 * user (or the user table) happens to hold them in.
 *
 * Both are deliberately conservative: anything they do not recognise is
 * handed back untouched, so an unusual value is never mangled — it just
 * misses out on the tidy-up. Both are idempotent, so running an already
 * formatted value through again is a no-op.
 */
window.HairSelfieFormat = (function () {
  'use strict';

  function group(d) {
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }

  /*
   * (310) 555-0100 — North American numbers, however they were typed:
   * 3105550100, 310-555-0100, +1 310 555 0100 all land in the same place.
   * A number with a country code that is not +1 is left exactly as given,
   * since the grouping conventions differ everywhere.
   */
  function phone(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';

    /* set an extension aside before counting digits */
    var ext = '';
    var body = raw.replace(/\s*(?:e?xt?\.?|#)\s*(\d{1,6})\s*$/i, function (_, n) {
      ext = n;
      return '';
    });

    var plus = /^\s*\+/.test(body);
    var digits = body.replace(/\D/g, '');
    if (plus && digits.charAt(0) !== '1') return raw;   // not ours to reformat

    var out;
    if (digits.length === 11 && digits.charAt(0) === '1') {
      out = (plus ? '+1 ' : '') + group(digits.slice(1));
    } else if (digits.length === 10) {
      out = group(digits);
    } else if (digits.length === 7) {
      out = digits.slice(0, 3) + '-' + digits.slice(3);
    } else {
      return raw;                                        // too short or too long
    }

    return ext ? out + ' ext. ' + ext : out;
  }

  /*
   * Always carries a unit: kg when the value says so, lbs otherwise —
   * including for a bare number, which is what most people type.
   * A range ("175-185") keeps its shape and gains the unit.
   */
  function weight(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';

    var kg = /kgs?\b|kilo/i.test(raw);
    var stripped = raw
      .replace(/(\d)\s*(?:lbs?|pounds?|kgs?|kilo(?:gram)?s?)\b\.?/ig, '$1')
      .replace(/\b(?:lbs?|pounds?|kgs?|kilo(?:gram)?s?)\b\.?/ig, '')
      .replace(/#/g, '')
      .trim()
      .replace(/[\s,]+$/, '');

    /* only a plain number or range gets a unit bolted on; anything else
       (5'11", "12 st 4") is somebody else's format — leave it be */
    if (!/\d/.test(stripped) || !/^[\d\s.,\/-]+$/.test(stripped)) return raw;

    return stripped + (kg ? ' kg' : ' lbs');
  }

  return { phone: phone, weight: weight };
})();
