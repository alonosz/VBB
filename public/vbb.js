/**
 * VBB Engine - ad click identifier capture.
 *
 * A lead that arrives without a click ID can only be matched to an ad click by
 * its hashed email, which relies on Google finding the click itself. A click ID
 * matches exactly. This script's whole job is to make sure the ID survives the
 * trip from the ad click to the form submission.
 *
 * Paste it once, before </body>. It has no dependencies, sends nothing
 * anywhere, and touches only its own fields.
 */
(function () {
  "use strict";

  // gclid is the standard Google click ID. gbraid and wbraid are its iOS
  // privacy-preserving counterparts and arrive instead of gclid, never as
  // well - so all three have to be watched. fbclid is Meta's.
  var PARAMS = ["gclid", "gbraid", "wbraid", "fbclid"];
  var STORE_PREFIX = "vbb_";
  var TTL_DAYS = 90;
  var VERSION = "1";

  /** Marks the page as instrumented, so the verifier can confirm from outside. */
  function stamp() {
    try {
      window.vbbSnippet = { version: VERSION, captured: read() };
    } catch (e) {
      /* A frozen window is not worth failing over. */
    }
  }

  function writeCookie(name, value) {
    try {
      var expires = new Date(Date.now() + TTL_DAYS * 864e5).toUTCString();
      // SameSite=Lax keeps the cookie on the top-level navigation that carries
      // the click ID, without exposing it to third-party contexts.
      document.cookie =
        name + "=" + encodeURIComponent(value) +
        ";expires=" + expires +
        ";path=/;SameSite=Lax" +
        (location.protocol === "https:" ? ";Secure" : "");
    } catch (e) {
      /* Cookies disabled; localStorage may still work. */
    }
  }

  function readCookie(name) {
    try {
      var match = document.cookie.match("(?:^|;\\s*)" + name + "=([^;]*)");
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocal(name, value) {
    try {
      // Safari's ITP caps script-set cookies at seven days, which is shorter
      // than most B2B sales cycles. localStorage is not subject to that cap,
      // so the two together outlast the gap either one leaves.
      localStorage.setItem(name, JSON.stringify({ v: value, t: Date.now() }));
    } catch (e) {
      /* Private mode or a full quota. The cookie still stands. */
    }
  }

  function readLocal(name) {
    try {
      var raw = localStorage.getItem(name);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.v !== "string") return null;
      // Expire it ourselves; localStorage has no TTL of its own.
      if (Date.now() - parsed.t > TTL_DAYS * 864e5) return null;
      return parsed.v;
    } catch (e) {
      return null;
    }
  }

  /** A click ID is an opaque token. Anything else is somebody's junk query string. */
  function looksLikeClickId(value) {
    return (
      typeof value === "string" &&
      value.length >= 8 &&
      value.length <= 512 &&
      /^[A-Za-z0-9_.\-]+$/.test(value)
    );
  }

  /** Pulls any click IDs off the current URL and stores them. */
  function capture() {
    var params;
    try {
      params = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    for (var i = 0; i < PARAMS.length; i++) {
      var key = PARAMS[i];
      var value = params.get(key);
      if (!value || !looksLikeClickId(value)) continue;
      // A fresh click always wins: the visitor is here from a newer ad.
      writeCookie(STORE_PREFIX + key, value);
      writeLocal(STORE_PREFIX + key, value);
    }
  }

  /** Everything we currently hold, cookie first, localStorage as the fallback. */
  function read() {
    var found = {};
    for (var i = 0; i < PARAMS.length; i++) {
      var key = PARAMS[i];
      var value = readCookie(STORE_PREFIX + key) || readLocal(STORE_PREFIX + key);
      if (value) found[key] = value;
    }
    return found;
  }

  /**
   * Adds the IDs to a form as hidden fields.
   *
   * Only ever adds its own fields, never edits one it did not create, and skips
   * a field the site already has under that name - an existing gclid input
   * belongs to whatever put it there.
   */
  function fill(form) {
    if (!form || form.nodeName !== "FORM") return;
    var values = read();

    for (var key in values) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue;

      var existing = form.querySelector('[name="' + key + '"]');
      if (existing) {
        // Ours to keep current; anyone else's to leave alone.
        if (existing.getAttribute("data-vbb") === "1") existing.value = values[key];
        continue;
      }

      var input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = values[key];
      input.setAttribute("data-vbb", "1");
      form.appendChild(input);
    }
  }

  function fillAll() {
    var forms = document.getElementsByTagName("form");
    for (var i = 0; i < forms.length; i++) fill(forms[i]);
  }

  function watch() {
    if (typeof MutationObserver !== "function") return;
    // HubSpot, Typeform and Marketo all inject their forms after load, so a
    // one-shot pass at DOMContentLoaded would miss exactly the forms that
    // matter most.
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.nodeName === "FORM") fill(node);
          else if (node.querySelectorAll) {
            var nested = node.querySelectorAll("form");
            for (var k = 0; k < nested.length; k++) fill(nested[k]);
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function start() {
    capture();
    fillAll();
    watch();
    stamp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  // Exposed so the verification page can confirm the script is live, and so a
  // single-page app can re-run it after a client-side route change.
  window.vbbCapture = { run: start, read: read, fill: fill, version: VERSION };
})();
