# Haltija REST API Reference

> For most use cases, use the `hj` CLI instead. This document is for direct HTTP integration.

The Haltija server exposes a REST API at `http://localhost:8700`. All POST endpoints accept JSON bodies and return JSON responses.

## Quick Reference

```bash
# Health / readiness
GET  /status                       # Server up?
GET  /windows                      # Browser connected?

# Navigation
POST /navigate  {"url": "..."}     # Go to URL
GET  /location                     # Current URL + title

# Interaction
POST /click     {"selector": "..."} 
POST /type      {"selector": "...", "text": "..."}
POST /key       {"key": "Enter"}

# Inspection
POST /tree      {"depth": 3}       # DOM tree with ref IDs
POST /query     {"selector": "..."} # Find element details

# Testing
POST /test/run  {"test": {...}}    # Run one test
POST /test/suite {"tests": [...]}  # Run multiple tests

# Debugging
GET  /console                      # Browser console output
POST /screenshot                   # Page capture (base64 PNG)
POST /snapshot                     # Full debug state dump

# Tabs
POST /tabs/open  {"url": "..."}    # New tab
POST /tabs/close {"window": "..."}  # Close tab
```

## Response Format

All POST endpoints return:
```json
{"success": true, "data": ...}
```
or on error:
```json
{"success": false, "error": "..."}
```

## Targeting Specific Tabs

Add `?window=<id>` to any endpoint or include `"window": "id"` in the POST body.

Get window IDs from `GET /windows`.

## Full API Documentation

Run `hj api` or visit `http://localhost:8700/api` for complete endpoint documentation with all parameters and examples.

## curl Examples

### Check server status
```bash
curl http://localhost:8700/status
```

### See page structure
```bash
curl -X POST http://localhost:8700/tree \
  -H "Content-Type: application/json" \
  -d '{"depth": 3, "mode": "actionable"}'
```

### Click an element
```bash
curl -X POST http://localhost:8700/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "#submit"}'
```

### Type text
```bash
curl -X POST http://localhost:8700/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "#email", "text": "user@example.com"}'
```

### Navigate
```bash
curl -X POST http://localhost:8700/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Take screenshot
```bash
curl -X POST http://localhost:8700/screenshot \
  -H "Content-Type: application/json" \
  -d '{"maxWidth": 800}'
```

### Run a test
```bash
curl -X POST http://localhost:8700/test/run \
  -H "Content-Type: application/json" \
  -d @tests/my-test.json
```

## hj Equivalents

Every curl command above has a simpler `hj` equivalent:

| curl | hj |
|------|-----|
| `curl localhost:8700/status` | `hj status` |
| `curl -X POST localhost:8700/tree -d '{...}'` | `hj tree` |
| `curl -X POST localhost:8700/click -d '{"selector":"#btn"}'` | `hj click "#btn"` |
| `curl -X POST localhost:8700/type -d '{"selector":"#email","text":"..."}' | `hj type "#email" user@example.com` |
| `curl -X POST localhost:8700/navigate -d '{"url":"..."}'` | `hj navigate example.com` |

Use `hj --help` for the full command list.
