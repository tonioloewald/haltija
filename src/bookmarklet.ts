/**
 * Haltija - Browser Control for AI Agents
 * https://github.com/anthropics/claude-code
 * 
 * Copyright 2025 Tonio Loewald
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Haltija Bookmarklet
 * 
 * Minimal loader that fetches and executes the injector from the server.
 * 
 * Usage:
 * 1. Start server: bunx tosijs-dev (HTTP on 8700) or DEV_CHANNEL_MODE=https bunx tosijs-dev
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
  
  // Check for existing widget - use DevChannel.tagName if available (handles renamed tags)
  var currentTag = (window.DevChannel && window.DevChannel.tagName) || 'haltija-dev';
  var existing = document.querySelector(currentTag);
  if (existing) {
    // Check if existing widget is stale (different version)
    var existingVersion = existing.getAttribute('data-version') || '0.0.0';
    if (existingVersion === serverVersion) {
      console.log('[haltija] Already active (v' + serverVersion + ')');
      if (existing.show) existing.show();
      return;
    }
    // Remove stale widget
    console.log('[haltija] Replacing stale widget (v' + existingVersion + ' -> v' + serverVersion + ')');
    existing.remove();
  }
  
  var script = document.createElement('script');
  script.src = serverUrl + '/component.js?v=' + serverVersion;
  script.onload = function() {
    if (window.DevChannel) {
      // Use elementCreator to get correct (possibly auto-renamed) tag
      var creator = window.DevChannel.elementCreator();
      var el = creator();
      el.setAttribute('server', wsUrl);
      el.setAttribute('data-version', serverVersion);
      document.body.appendChild(el);
    }
  };
  script.onerror = function() {
    alert('[Haltija] Could not load component. Check that the server is running.');
  };
  document.head.appendChild(script);
})();
`;
