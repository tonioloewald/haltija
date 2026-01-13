
## Graceful Port Handling

Server currently uses hardcoded port 8700, which can conflict with other services or user needs.

**Problem:**
- Port 8700 might already be in use by another app
- Running tests stomps on interactive sessions
- Users may need to use a different port for various reasons
- Similar to how Apple's AirPlay Receiver uses port 5000, breaking Firebase emulators

**Solution:**
- Server should try preferred port, auto-fallback to next available if busy
- Clearly report actual port being used on startup
- Support `PORT` or `HALTIJA_PORT` env var for explicit override
- Tests use random ports to avoid conflicts

**Implementation notes:**

Server:
- Create `findAvailablePort(preferred?: number): Promise<number>` utility
- Try preferred port first, increment within known ranges on EADDRINUSE
- Use two port ranges: 8700-8710 (primary), 3700-3710 (secondary)
- Console output should always show actual port: "Haltija server running on http://localhost:XXXX"
- Support `HALTIJA_PORT` env var for explicit override

Bookmarklet:
- Scan both port ranges to find running server
- If not found: alert "Haltija server not found. Check your server's startup message for the correct port."
- Keep it simple - no prompts or fancy discovery
