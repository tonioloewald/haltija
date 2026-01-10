/**
 * Dev Channel Bookmarklet
 * 
 * Minimal loader that fetches and executes the injector from the server.
 * 
 * Usage:
 * 1. Start server: bunx tosijs-dev (HTTP on 8700) or DEV_CHANNEL_MODE=https bunx tosijs-dev
 * 2. Visit the server URL and drag the bookmarklet to your toolbar
 * 3. Click bookmark on any page to inject tosijs-dev
 * 
 * The bookmarklet is protocol-aware: it uses HTTPS for HTTPS sites, HTTP for HTTP sites.
 * For HTTPS sites, you need to run the server in 'https' or 'both' mode.
 */

// This file contains the actual injection code that gets served from /inject.js
// The __SERVER_URL__ and __WS_URL__ placeholders are replaced by the server at runtime
export const injectorCode = `
(function() {
  if (document.querySelector('tosijs-dev')) {
    console.log('[tosijs-dev] Already active');
    var existing = document.querySelector('tosijs-dev');
    if (existing && existing.show) existing.show();
    return;
  }
  
  // These get replaced by the server based on the request protocol
  var serverUrl = '__SERVER_URL__';
  var wsUrl = '__WS_URL__';
  
  var script = document.createElement('script');
  script.src = serverUrl + '/component.js';
  script.onload = function() {
    if (window.DevChannel) {
      var el = document.createElement('tosijs-dev');
      el.setAttribute('server', wsUrl);
      document.body.appendChild(el);
    }
  };
  script.onerror = function() {
    alert('[tosijs-dev] Could not load component. Check that the server is running.');
  };
  document.head.appendChild(script);
})();
`;
