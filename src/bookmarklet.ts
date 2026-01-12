/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Haltija Bookmarklet
 * 
 * Minimal loader that sets config and loads component.js.
 * All spinup logic lives in component.ts - this is just a loader.
 * 
 * Usage:
 * 1. Start server: bunx haltija (HTTP on 8700)
 * 2. Visit the server URL and drag the bookmarklet to your toolbar
 * 3. Click bookmark on any page to inject Haltija
 * 
 * The bookmarklet is protocol-aware: it uses HTTPS for HTTPS sites, HTTP for HTTP sites.
 * For HTTPS sites, you need to run the server in 'https' or 'both' mode.
 */

// This file contains the actual injection code that gets served from /inject.js
// The __SERVER_URL__, __WS_URL__, and __VERSION__ placeholders are replaced by the server at runtime
export const injectorCode = `
(function() {
  var serverUrl = '__SERVER_URL__';
  var wsUrl = '__WS_URL__';
  var serverVersion = '__VERSION__';
  
  // Check if already loaded with same version
  if (window.__haltija_widget_id__) {
    var existing = document.getElementById(window.__haltija_widget_id__);
    if (existing) {
      var existingVersion = existing.getAttribute('data-version') || '0.0.0';
      if (existingVersion === serverVersion) {
        console.log('[haltija] Already active (v' + serverVersion + ')');
        return;
      }
      // Version mismatch - component.ts inject() will handle replacement
    }
  }
  
  // Set config for auto-inject (component.ts reads this on load)
  window.__haltija_config__ = { serverUrl: wsUrl };
  
  // Load component.js - it auto-injects when it sees the config
  var script = document.createElement('script');
  script.src = serverUrl + '/component.js?v=' + serverVersion;
  script.onerror = function() {
    alert('[Haltija] Could not load component. Check that the server is running.');
  };
  document.head.appendChild(script);
})();
`;
