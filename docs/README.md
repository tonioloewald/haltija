# Haltija Documentation

## Quick Start

1. **[Getting Started: Service](getting-started/service.md)** - Run `bunx haltija` and inject the widget
2. **[Getting Started: App](getting-started/app.md)** - Add one script tag to your app
3. **[Getting Started: Playground](getting-started/playground.md)** - Interactive testing environment
4. **[CI Integration](CI-INTEGRATION.md)** - Run Haltija in GitHub Actions and other CI systems

## Recipes

**[Recipes](recipes.md)** - Common workflows with copy-paste examples:
- Testing login flows
- Exploring unfamiliar UIs
- Recording bug reproductions
- Generating tests from manual exploration
- Debugging customer issues
- Accessibility auditing
- Multi-tab testing (OAuth, admin/user)
- Waiting for dynamic content
- User selection ("point at the problem")

## Reference

- **[API Reference](../API.md)** - Complete endpoint documentation (auto-generated from schema)
- **[Agent Prompt](agent-prompt.md)** - System prompt for AI agents using Haltija
- **[UX Crimes](UX-CRIMES.md)** - Anti-patterns Haltija detects automatically

## Architecture

- **[CLAUDE.md](../CLAUDE.md)** - Build commands, architecture overview, code structure
- **[Component Patterns](../COMPONENT-PATTERNS.md)** - Design patterns used in the widget

## Planning

- **[Executive Summary](EXECUTIVE-SUMMARY.md)** - What Haltija is, who it's for
- **[Roadmap to 10/10](ROADMAP-TO-10.md)** - Where we're going
- **[Development Roadmap](../ROADMAP.md)** - Completed and planned phases
- **[TODO](../TODO.md)** - Outstanding issues and ideas

## Desktop App

- **[Desktop README](../apps/desktop/README.md)** - Electron app setup and building

---

## Documentation Map

```
README.md                    # Main entry point, 30-second pitch
docs/
  README.md                  # This file - documentation index
  getting-started/
    service.md               # Start the server
    app.md                   # Add to your app
    playground.md            # Interactive testing
  CI-INTEGRATION.md          # GitHub Actions, CI/CD setup
  recipes.md                 # Common workflows with examples
  EXECUTIVE-SUMMARY.md       # For stakeholders
  ROADMAP.md                 # Product roadmap (to 11/10)
  agent-prompt.md            # AI agent system prompt
  UX-CRIMES.md               # Anti-pattern detection
API.md                       # Auto-generated API reference
CLAUDE.md                    # Developer guide (for AI and humans)
COMPONENT-PATTERNS.md        # Widget architecture patterns
TODO.md                      # Issues and ideas
```
