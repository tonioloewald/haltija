/**
 * Dev Channel Bookmarklet
 * 
 * Minimal loader that fetches and executes the injector from the server.
 * 
 * Usage:
 * 1. Start server: bun run packages/tosijs-dev/bin/server.ts
 * 2. Visit https://localhost:8700 and accept the self-signed certificate
 * 3. Drag the bookmark from the test page to your bookmarks bar
 * 4. Click bookmark on any page to inject tosijs-dev
 * 
 * The server runs HTTPS on port 8700 by default (if certs exist).
 * This allows injection on both HTTP and HTTPS sites.
 */

// Bookmarklet (always uses HTTPS):
// javascript:(function(){fetch('https://localhost:8700/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('tosijs-dev: '+e.message+' - Visit https://localhost:8700 first to accept the certificate.'))})()

// This file contains the actual injection code that gets served from /inject.js
export const injectorCode = `
(function() {
  if (document.querySelector('tosijs-dev')) {
    console.log('[tosijs-dev] Already active');
    var existing = document.querySelector('tosijs-dev');
    if (existing && existing.show) existing.show();
    return;
  }
  
  // Server URL - always HTTPS on port 8700
  var serverUrl = 'https://localhost:8700';
  
  var script = document.createElement('script');
  script.src = serverUrl + '/component.js';
  script.onload = function() {
    if (window.DevChannel) {
      var el = document.createElement('tosijs-dev');
      el.setAttribute('server', 'wss://localhost:8700/ws/browser');
      document.body.appendChild(el);
    }
  };
  script.onerror = function() {
    alert('[tosijs-dev] Could not load. Visit https://localhost:8700 first to accept the self-signed certificate.');
  };
  document.head.appendChild(script);
})();
`;
