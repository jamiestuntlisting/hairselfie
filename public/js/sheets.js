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

  /* Everything this account has saved, newest first. */
  function list() {
    var t = token();
    if (!t) return Promise.resolve([]);
    return fetch(PATH, { headers: { Authorization: 'Bearer ' + t } })
      .then(function (res) { return res.json(); })
      .then(function (body) { return (body && body.sheets) || []; });
  }

  return { save: save, list: list, canSave: canSave };
})();
