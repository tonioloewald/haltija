# Haltija Agent Quick-Start

Copy this prompt to give an AI agent browser control via Haltija.

---

## The Prompt

```
# Haltija - Browser Control

## What is this?
You have browser control via the `hj` command.
It returns semantic structure — what's clickable, what's hidden and why, what inputs exist.
Not screenshots, not HTML dumps. The page as an agent should see it.

The server auto-starts if needed. All commands: `hj <verb> [target] [args]`

## Key Concepts

- **Tree** (`hj tree`): Your eyes. A text list of elements with IDs and flags.
- **Refs**: Every element has a numeric ID (e.g. 5, 42). Use these to target elements.
  Refs are stable — they survive re-renders. Always prefer refs over CSS selectors.
- **Flags**: Check these before acting:
  [interactive] — clickable/typeable
  [hidden:display] — invisible, don't interact
  [disabled] — form field is disabled
  [required] — must be filled
- **Quoting**: Only needed for spaces: `hj type 5 "hello world"`. Simple args need no quotes.

## Sample Output (`hj tree`)

```
1: body
  2: h1 "Sign Up"
  3: div.form-row
    4: label "Email:"
    5: input#email-input type=email placeholder="you@example.com" [interactive]
  6: div.form-row
    7: label "Password:"
    8: input type=password [interactive]
  9: button#btn-submit "Create Account" [interactive]
  10: p
    11: a href="/login" [interactive] "Already have an account?"
  12: div [hidden:display] "Error: invalid email"
```

Reading this:
- Refs are the numbers before `:` (e.g. 5, 9, 11)
- `[interactive]` means you can click/type it
- `[hidden:display]` means it exists but is invisible
- Attributes (type, placeholder, href) shown inline
- Text content in quotes

To fill this form:
- Type email: `hj type 5 "user@example.com"`
- Type password: `hj type 8 s3cret`
- Submit: `hj click 9`
- Check if error appeared: `hj tree` (see if ref 12 lost [hidden])

## Workflow

1. **Inspect**: `hj tree` to see what's on the page
2. **Plan**: Find the target ref. Confirm it shows [interactive].
3. **Act**: `hj click`/`hj type`/`hj navigate`
4. **Verify**: `hj tree` or `hj console` to confirm the result

## Commands

### See the page
  hj tree                Semantic page structure with refs and flags
  hj tree --visible      Only visible elements
  hj tree -d 5           Deeper tree
  hj tree form           Subtree rooted at selector
  hj console             Recent console logs/errors
  hj screenshot          Capture page as image
  hj location            Current URL and title
  hj events              Recent semantic events

### Inspect
  hj inspect 3           Deep details on one element
  hj query input         Quick element lookup
  hj call 5 value        Get element property
  hj eval document.title Run arbitrary JavaScript

### Interact
  hj click 9             Click by ref (preferred)
  hj click "Submit"      Click by text content
  hj click "#btn"        Click by selector (fragile)
  hj type 5 hello        Type into element
  hj key Enter           Press key
  hj key s --ctrl        Keyboard shortcut
  hj scroll 20           Scroll element into view
  hj navigate https://...  Go to URL

### Show the user
  hj highlight 5 "Here"  Draw a labeled box on their screen
  hj unhighlight          Remove highlight

### Wait
  hj wait .modal          Wait for element to appear
  hj wait .loading 10000  Wait up to 10s

### Multiple tabs
  hj windows              List connected tabs
  hj click 5 --window abc  Target specific tab

## Tips

- Start with `hj tree` — look for [interactive] to find actionable elements
- Always prefer refs over selectors — refs survive DOM changes
- After async actions: `hj wait .spinner` then `hj tree`
- Show the user what you found: `hj highlight 5 "This button"`
- If a click fails: `hj console` for JS errors
- Hidden elements can't be clicked — check [hidden] flag first
- Some apps use clickable divs: try `hj eval "document.querySelector('#el').click()"` as fallback
- Forms need proper events: use `hj type` (not eval) to fire input events correctly

## More info

`hj api` for full reference, `hj docs` for quick start.
```

---

## Notes

- The sample output block is the most important part — agents learn the format by example.
- Refs are bare numbers. The command verb determines how arguments are parsed,
  so there's no ambiguity between `hj click 5` (ref) and `hj scroll 300` (pixels).
- Only quote arguments that contain spaces.
