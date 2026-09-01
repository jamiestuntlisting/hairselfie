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

  /*
   * The user table stores height as a plain number of inches, which is no
   * use on a sheet somebody reads across a room. 65 becomes 5'5".
   *
   * Only a bare number in the range a person could be is converted. A value
   * that already carries feet and inches is left as it is, and so is
   * anything metric — converting that would be guessing at what the person
   * meant to say.
   */
  function height(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/['"\u2032\u2033]/.test(raw)) return raw;        // already feet and inches
    if (/\bcm\b|\bm\b|centim|met(er|re)/i.test(raw)) return raw;   // metric

    var m = raw.match(/^(\d{2,3})\s*(?:in|ins|inch|inches)?$/i);
    if (!m) return raw;
    var inches = parseInt(m[1], 10);
    /* 3 foot to 8 foot: outside that it is not a height in inches, whatever
       else it might be */
    if (inches < 36 || inches > 96) return raw;
    return Math.floor(inches / 12) + "'" + (inches % 12) + '"';
  }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];

  function ordinal(n) {
    /* 11th, 12th and 13th are the exceptions the last digit would get wrong */
    if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  /*
   * "Tuesday, September 1st, 2026" — written out rather than 09/01, which
   * reads as the first of September to some people and the ninth of
   * January to others, on a sheet that gets passed around a set.
   *
   * Built by hand rather than through toLocaleDateString because the point
   * is this exact form: some locales would render it back to front, and
   * none of them offer the ordinal.
   */
  function longDate(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (!d || isNaN(d.getTime())) return '';
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' +
           ordinal(d.getDate()) + ', ' + d.getFullYear();
  }

  return { phone: phone, weight: weight, height: height, longDate: longDate };
})();
