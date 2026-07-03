/* WhatsApp CRM first-party analytics beacon.
   - Sends a page view on load + on SPA route changes (history API + hashchange).
   - Exposes window.track(name, props) for custom events.
   - Respects cookie consent: an anonymous id is only stored if the visitor has
     accepted non-essential cookies. Without consent, events are still counted
     but not tied to a persistent id.
*/
(function () {
  var ENDPOINT = '/api/analytics/collect';

  function consentAccepted() {
    try { return localStorage.getItem('cookie_consent') === 'accepted'; } catch (e) { return false; }
  }

  function anonId() {
    if (!consentAccepted()) return null;
    try {
      var id = localStorage.getItem('aid');
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID()
          : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('aid', id);
      }
      return id;
    } catch (e) { return null; }
  }

  function send(ev) {
    try {
      var payload = JSON.stringify(ev);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* never let analytics break the page */ }
  }

  function page() {
    send({ type: 'page', path: location.pathname + location.search, name: document.title, referrer: document.referrer, anon_id: anonId() });
  }

  window.track = function (name, props) {
    send({ type: 'event', name: String(name).slice(0, 200), props: props || undefined, path: location.pathname, anon_id: anonId() });
  };

  // Initial + SPA navigations
  var lastPath = location.pathname + location.search;
  function maybePage() {
    var p = location.pathname + location.search;
    if (p !== lastPath) { lastPath = p; page(); }
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); setTimeout(maybePage, 0); return r; };
  });
  window.addEventListener('popstate', maybePage);
  window.addEventListener('hashchange', maybePage);

  if (document.readyState === 'complete' || document.readyState === 'interactive') page();
  else document.addEventListener('DOMContentLoaded', page);
})();
