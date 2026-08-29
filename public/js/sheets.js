/*
 * Keeping a copy of a finished sheet.
 *
 * The upload carries the sheet and the access token and nothing else — no
 * user id, no name. Who it belongs to is decided by the Worker from the
 * token, because an id sent from a browser is a request, not a fact.
 *
 * Saving is best-effort by design: the image is already on the person's
 * phone by the time this runs, so a failure here is worth reporting and
 * not worth blocking on.
 */
window.HairSelfieSheets = (function () {
  'use strict';

  var PATH = '/api/sheets';

  function token() {
    var GQL = window.StuntListingGQL;
    return GQL && GQL.accessToken ? GQL.accessToken() : null;
  }

  function canSave() {
    return !!token();
  }

  function save(blob, kind) {
    var t = token();
    if (!t) return Promise.reject(new Error('not signed in'));

    return fetch(PATH, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
        'X-Sheet-Kind': kind || 'hair',
        Authorization: 'Bearer ' + t
      },
      body: blob
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('Save failed (' + res.status + ')'));
        return body;
      });
    });
  }

  function remove(key) {
    var t = token();
    if (!t) return Promise.reject(new Error('not signed in'));
    return fetch(PATH + '?key=' + encodeURIComponent(key), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + t }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ('Could not delete (' + res.status + ')'));
        return true;
      });
    });
  }

  /* Everything this account has saved, newest first. */
  function list() {
    var t = token();
    if (!t) return Promise.resolve([]);
    return fetch(PATH, { headers: { Authorization: 'Bearer ' + t } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          /* A failed listing must not read as an empty one: telling someone
             with twenty sheets that they have none is worse than an error. */
          if (!res.ok) throw new Error(body.error || ('Could not list (' + res.status + ')'));
          return (body && body.sheets) || [];
        });
      });
  }

  /*
   * Count this page load — signed in or not. The visitor id is a random
   * string kept in this browser and nothing else: it exists so that ten
   * loads by one person do not read as ten people, and it says nothing
   * about who they are.
   */
  function visitorId() {
    try {
      var id = localStorage.getItem('hairselfie.visitor');
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
          : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('hairselfie.visitor', id);
      }
      return id;
    } catch (e) {
      return '';   // private mode: the Worker gives it a one-off id
    }
  }

  function recordUse(page) {
    var headers = { 'Content-Type': 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch('/api/use', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ visitor: visitorId(), page: page || 'other' })
    }).then(function (res) { return res.ok; })
      .catch(function () { return false; });   // never worth interrupting anyone over
  }

  return { save: save, list: list, remove: remove, canSave: canSave, recordUse: recordUse };
})();
