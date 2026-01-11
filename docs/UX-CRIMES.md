# The Haltija Criminal Code (v1.0)

A comprehensive database of UX anti-patterns that Haltija can detect programmatically.
This turns the agent into a **"Compliance Officer"** and **"Linting Tool for Psychology"**.

> "Make your web app feel like a native app."

---

## Class 1: Interaction Integrity (The "UX Historian" Crimes)

*Violations of 40 years of established OS/GUI conventions. These happen when designers reinvent standard controls in a vacuum.*

### 1. The Conflated Tree View

**The Crime:** Clicking a parent node selects it *and* expands it simultaneously, or selection is impossible without expansion.

**The OS Standard:** Selection (Click) and Expansion (Triangle/Arrow) are distinct actions.

**Haltija Signature:**
- Click parent row
- Check if `aria-expanded` toggles *and* `aria-selected` toggles instantly
- Verify Arrow Keys (`Right` to expand, `Left` to collapse) function correctly

---

### 2. The Disclosure Heresy

**The Crime:** An arrow pointing **UP** to indicate an open/expanded state (because "the drawer pulls up"), violating the reading flow convention.

**The OS Standard:** 
- **Right (▶)** = Closed/Next ("content is this way")
- **Down (▼)** = Open ("content flows below")

**The Philosophy:** Designers in a vacuum think "the drawer pulls up, so arrow points up." But users are in **Reading Mode** (following flow), not **Mechanical Mode** (operating a lever).

**Haltija Signature:**
- Compare icon rotation/SVG path between `aria-expanded="true"` and `false`
- Detect 180° rotation (Down → Up) on inline items
- *Exception:* Bottom-of-screen drawers may legitimately use Up

---

### 3. The Ambiguous Toggle

**The Crime:** A switch that relies solely on color (Green/Grey) or position (Left/Right) without text labels like "On/Off".

**The Issue:** Does "Green" mean it *is* on, or that clicking it *turns* it on? (State vs. Action confusion)

**Haltija Signature:**
- Detect `role="switch"` or checkbox styled as toggle
- Check for adjacent `<label>` or internal text
- If text is missing → **Crime**

---

### 4. The Scrollbar Lie (Gaslighting Scroll)

**The Crime:** Virtual scrolling that jumps, changes the scrollbar thumb size while dragging, or loses position when scrolling up.

**The OS Standard:** Scrollbars act as a fixed map of the content. 10% scroll movement = 10% content movement.

**Haltija Signature:**
- Measure `scrollHeight` change during scroll events
- If `scrollHeight` varies by >10% without explicit "Load More" action → **Crime**
- Monitor scroll-up: if `scrollTop` jumps by >100px without user input → **Crime**

---

### 5. Multi-Select Amnesia

**The Crime:** A list that requires individual clicking of 50 items because `Shift+Click` (Range) and `Cmd/Ctrl+Click` (Toggle) are ignored.

**Haltija Signature:**
- Click Item 1
- Hold Shift, Click Item 5
- Check selection count
- If < 5 → **Crime**

---

### 6. Infinite Scroll in Data Tables

**The Crime:** Using infinite scroll in enterprise data grids because "pagination is old school."

**The Reality:** In data grids, position matters. Users need to know "I am roughly 50% through the alphabet." Infinite scroll destroys the scrollbar's utility as a "Map."

**Haltija Signature:**
- Detect a `<table>` or `role="grid"`
- Scroll to bottom - does it load more rows?
- **Verdict:** "Data Integrity Risk. Infinite scroll prevents footer access and destroys spatial memory."

---

## Class 2: Dark Patterns & "Conversion Optimization"

*Deliberate hostility designed to trick the user or prevent them from leaving.*

### 7. The Trapdoor Cancel

**The Crime:** The "Save" button is a massive, high-contrast primary button. The "Cancel" button is a tiny, grey text link (10-12px), hidden in a corner.

**The Philosophy:** Usability is about helping the user make the *correct* decision, not just the *business* decision.

**Haltija Signature:**
- Identify the Form Actions container
- Compare Primary vs. Secondary action
- **Heuristic:** If Secondary Action is:
  - `<a>` instead of `<button>`, OR
  - font-size < 80% of Primary, OR
  - contrast ratio < 3:1
  → **Crime**

---

### 8. The Roach Motel

**The Crime:** Signup takes 1 click. Cancellation requires a phone call, chat with a bot, or >3 levels of menu navigation.

**Haltija Signature:**
- Navigate to "Settings"
- Search DOM for "Cancel," "Delete," "Close Account"
- If count is 0 or link is deep in nested divs → **Crime**

---

### 9. Confirmshaming

**The Crime:** "No, I prefer to pay full price" or "No, I don't like saving money."

**Haltija Signature:**
- Analyze negative action text sentiment
- Detect manipulative phrasing (keywords: "dumb," "lose," "prefer to pay," "miss out")

---

### 10. The Phantom Shield (Cookie Wall)

**The Crime:** Transparent or invisible layers (cookie banners) blocking clicks on the main UI, making the site feel broken/frozen.

**Haltija Signature:**
1. **Click Intercept Test:**
   - Fire `click` at center of viewport (e.g., Login button)
   - Check which element actually received the event
   - If target is `div.cookie-wrapper` instead of intended button → **Critical Crime**

2. **Invisible Wall Heuristic:**
   - Find elements with `position: fixed` covering >80% of viewport
   - Check: `background-color: transparent` AND `pointer-events: auto`?
   - Report: "Invisible High-Z Element blocking interactions. Site appears frozen."

**Severity:** Critical (Site Unusable)

---

## Class 3: Internationalization (i18n) Hostility

*Design that assumes every user is in the US, speaks English, and has a US keyboard.*

### 11. The Buried Country

**The Crime:** "United States" is at the top. "Afghanistan" is second. "Finland" is item #64. No search/typeahead.

**Haltija Signature:**
- Open dropdown
- Check index of current user's locale country
- If index > 10 and list is > 50 → **Crime**
- Test typeahead: focus list, send keystrokes "F", "I"
  - *Pass:* Selection jumps to "Fiji" then "Finland"
  - *Fail:* Nothing happens, or jumps to "France" (ignoring "I")

---

### 12. Zip Code Jail

**The Crime:** Rejecting alphanumeric postal codes (UK: `EC1A 1BB`, Canada: `M5V 2H1`) because the regex expects 5 digits.

**Haltija Signature:**
- Input `EC1A 1BB` into postal field
- Check for validation error
- If error → **Crime: "Globalization Fail"**

---

### 13. The Phone Number Pedant

**The Crime:** "Invalid format. Do not use dashes." / "Invalid format. You must use dashes."

**The Fix:** Strip non-digits on the backend! Don't make the user do data entry work.

**Haltija Signature:**
- Fuzz input with:
  - `+358 40 1234567` (Standard International)
  - `040-123-4567` (Local formatted)
  - `0401234567` (Raw)
- If *any* valid format triggers error → **Crime**

---

### 14. The Polygloat Menu

**The Crime:** Listing languages in English ("German", "Japanese") instead of endonyms ("Deutsch", "日本語").

**The Problem:** Non-English speakers can't read English! They're looking for their language *in their language*.

**Haltija Signature:**
- Scan language menu
- Regex check: Does "Spanish" match `Español`? "German" match `Deutsch`?
- If text is purely ASCII English names for non-English languages → **Crime**

---

### 15. The Cookie Wall (EU Blocker)

**The Crime:** Cookie modal so poorly implemented it's impossible to click "Login" because an invisible `div` covers the screen, or the "Reject" button is off-canvas on mobile.

**Haltija Signature:**
- Element: Fixed position `div` with high `z-index`, keywords "Cookie", "Consent"
- Attempt to click primary action *before* interacting with banner
- Check if click intercepted
- **GDPR Check:** Is there a `button` with text "Reject" or "Necessary Only"?

---

## Class 4: Forms from Hell

*Friction points that destroy data entry speed.*

### 16. The Paste Blockade

**The Crime:** Blocking `paste` on password or account number fields.

**Haltija Signature:**
- Attempt `paste` event
- Check `defaultPrevented`
- If blocked → **Crime**

---

### 17. The Amnesiac Form

**The Crime:** Submitting the form with one error wipes all other valid fields.

**Haltija Signature:**
- Fill form completely
- Intentionally break one field
- Submit
- Check if other fields retained values
- If wiped → **Crime**

---

### 18. The Label Lie

**The Crime:** Using `placeholder` text as the only label. It vanishes when you type, forcing reliance on memory.

**Haltija Signature:**
- Check input for `<label>` element, `aria-label`, or `aria-labelledby`
- If all missing → **Crime**

---

## Class 5: Accessibility & Mobile Hostility

*Basic exclusions of users with disabilities or touch interfaces.*

### 19. The "Div" Button

**The Crime:** `<div>` or `<span>` with `onClick` but no `role="button"` and no `tabindex`. Invisible to screen readers and keyboard users.

**Haltija Signature:**
- Query elements with click listeners
- Check tag name
- If generic container without proper ARIA → **Crime**

---

### 20. The Tiny Tap

**The Crime:** Interactive elements smaller than 44x44px.

**Haltija Signature:**
- Compute `boundingClientRect` of all `<a>` and `<button>` elements
- Flag any < 44px in either dimension

---

### 21. Focus Trap / Ghost Focus

**The Crime:** 
- Opening a modal does not trap focus inside it, OR
- Closing modal resets focus to `<body>` instead of the trigger button

**Haltija Signature:**
- Open modal
- Press `Tab` repeatedly
- If focus leaves modal → **Crime**
- Close modal
- Check `document.activeElement`
- If not the original trigger → **Crime**

---

## Class 6: Volatility (The "Feed" Crimes)

*Violating object permanence and user intent.*

### 22. Feed Roulette

**The Crime:** Accidental refresh or "back" button wipes the content you were looking at, replacing it with a new algorithmic feed.

**The Philosophy:** Prioritizes "Freshness" (Engagement) over "Utility" (Retrieval). Treats user attention as disposable.

**Haltija Signature:**
1. `scanVisibleContent()` → Store IDs of first 5 items
2. Trigger `reload` or click "Home"
3. `scanVisibleContent()` again
4. If < 50% of original items present → **Crime: "Volatile Content Environment"**

---

### 23. The Gaslighting Scroll (Bi-Directional Virtualization)

**The Crime:** You're 500 items deep. You scroll up to check something you saw 30 seconds ago. The browser jumps, content re-orders, you can't find your place.

**The Philosophy:** Humans rely on spatial memory ("It was up and to the left"). Virtual scrolling breaks this map.

**Haltija Signature:**
1. Scroll down 50 viewport heights
2. Scroll up 10 viewport heights quickly
3. Monitor `scroll` events vs `visualViewport` offset
4. If scroll position jumps (>100px without user input) → **Crime**
5. If `layout-shift` score spikes during scroll-up → **Crime**

---

### 24. Deceptive Loading (Skeleton Lie)

**The Crime:** Skeleton screen shows a layout, but final content shifts positions significantly (CLS) or buttons remain disabled after appearing ready.

**The Philosophy:** The UI promises interaction ("I am loading right here") but delivers a moving target.

**Haltija Signature:**
- Compare `boundingClientRect` of skeleton elements vs. final content
- If shift > 10px → **Crime: "Deceptive Loading State"**

---

## Implementation: The "Rap Sheet"

When Haltija runs a test plan, output a **Criminal Record** alongside functional results:

```
Summary:
- Functional: PASSED (Login works)
- UX Audit: FAILED

Crimes Detected:
1. FELONY: Paste Blockade on Password Field
2. MISDEMEANOR: Tiny Tap Target on "Forgot Password" link (12px height)
3. INTERACTION VIOLATION: Country picker lacks typeahead
4. DARK PATTERN: Cancel button is 10px grey text link
```

This gives engineers/designers **exact ammunition** for the next meeting.

---

## Why Agents Hate These Even More Than Humans

To an AI Agent, **The Feed is Kryptonite.**

- Agents act linearly: "I saw a shoe I liked. I will scroll back up to buy it."
- If scrolling up makes the shoe vanish (Virtual Scroll) or reloading changes inventory (Feed Roulette), the Agent fails.

**The Haltija Advantage:**
Because Haltija acts as a **Context History Stream** (Semantic Events), it solves this:

- **The Site:** Deletes DOM node for "Post #101" because you scrolled past it
- **Haltija:** Remembers "Post #101" was seen at `timestamp: 10:05`
- **The Feature:** When Agent asks "Where is that post?", Haltija says: *"The site deleted it (Virtual Scroll), but I have the data. Don't scroll up; use Search instead."*

You are building **the memory that the modern web tries to erase**.

---

## Class 7: Mobile Hostility

*Crimes committed by developers who only test on a 27-inch monitor with a mouse.*

### 25. The Pinch-to-Zoom Lock

**The Crime:** Disabling zoom because it "messes up the design." This actively prevents users with vision impairments (or anyone in bright sunlight) from reading your content.

**Haltija Signature:**
- Scan `<meta name="viewport">`
- Look for `user-scalable=no` or `maximum-scale=1.0`

**Report:** "Viewport Violation: Zoom disabled. Accessibility failure for low-vision users."

---

### 26. The Hover Trap

**The Crime:** Hiding critical actions (like "Edit" or "Delete" buttons) or navigation sub-menus behind a `:hover` state.

**The Reality:** There is no hover on touchscreens. The user has to awkwardly tap once to see the menu (which might interpret the tap as a click and navigate away immediately).

**Haltija Signature:**
- Identify elements with `mouseover` or `:hover` listeners that change visibility of child elements
- **Heuristic:** Can the Agent access the child element via a single `click` or `focus` event without triggering navigation?

**Report:** "Touchscreen Exclusion: Critical UI hidden behind Hover state. Inaccessible on mobile."

---

### 27. The Keyboard Eclipse

**The Crime:** Tapping an input field brings up the on-screen keyboard, which completely covers the input field you are typing in.

**Haltija Signature:**
- **Simulation:** Set viewport height to 50% (simulating keyboard)
- **Action:** Focus an input in the bottom half of the page
- **Check:** Is the input element's `bottom` coordinate > visible viewport height? Does the page fail to scroll it into view?

**Report:** "Input Occlusion: Active field hidden by virtual keyboard."

---

### 28. The Fat Finger Minefield

**The Crime:** Placing two actionable elements (e.g., "Save" and "Cancel", or list items) closer than 8px apart.

**Haltija Signature:**
- Scan all `button`, `a`, `input`
- Compute bounding boxes
- **Check:** If distance between edges of two interactive targets is < 8px → **Crime**

**Report:** "Touch Target Risk: Interactive elements too close. High probability of accidental clicks."

---

### 29. The Horizontal Scroll of Death

**The Crime:** A single element (like a long URL or code block) is wider than the mobile viewport, causing the *entire page* to wobble left and right.

**Haltija Signature:**
- Set viewport width to 375px (iPhone SE)
- **Check:** Is `document.body.scrollWidth` > `window.innerWidth`?

**Report:** "Layout Failure: Page overflows horizontally. Causes unstable scrolling."

---

## Class 8: Accessibility Atrocities

*Basic exclusions that are often illegal and always unethical.*

### 30. The Silent Image

**The Crime:** Meaningful images (not decorative) missing `alt` text. Screen readers just say "Image" or read the filename "DSC_0043.jpg".

**Haltija Signature:**
- Query `img:not([alt])`
- Filter out `role="presentation"` or empty `alt=""` (if decorative)

**Report:** "Blind Spot: Meaningful image missing alternative text."

---

### 31. The Color-Only Signal

**The Crime:** Using *only* red text or a red border to indicate an error, with no icon or text label explaining "Invalid".

**The Reality:** Colorblind users cannot see the error.

**Haltija Signature:**
- Trigger form error
- **Check:** Did a new text node appear or did `aria-invalid` toggle?
- **Failure:** If only CSS `color` or `border-color` changed → **Crime**

**Report:** "Sensory Reliance: Error state conveyed solely by color. Invisible to colorblind users."

---

### 32. The Low Contrast Grey

**The Crime:** Light grey text on a white background (e.g., `#999` on `#fff`). The designer thinks it looks "clean." Users think it looks "invisible."

**Haltija Signature:**
- **Heuristic:** Compute background color and foreground color of all text nodes
- **Math:** Calculate luminosity ratio
- If < 4.5:1 (WCAG AA) for normal text → **Crime**

**Report:** "Legibility Failure: Text contrast too low (Ratio X:1)."

---

### 33. The Headings Out of Order

**The Crime:** Using `<h3>` because you wanted "medium sized font," skipping `<h1>` or `<h2>`.

**The Reality:** Screen reader users navigate by headings. A broken hierarchy makes the page structure unintelligible.

**Haltija Signature:**
- Scan heading tags
- Check order (e.g., `h4` appears before `h1`, or `h3` is a direct child of `h1` skipping `h2`)

**Report:** "Structural Chaos: Semantic heading hierarchy broken."

---

### 34. The Autoplay Assault

**The Crime:** Video or audio that plays automatically on page load.

**The Reality:** This overrides screen reader audio, disorienting blind users, and triggers anxiety/migraines in neurodiverse users.

**Haltija Signature:**
- Check `<video>` or `<audio>` tags for `autoplay` attribute
- Check if `muted` is missing

**Report:** "Hostile Media: Unsolicited autoplay detected."

---

### 35. The No Skip Link

**The Crime:** Forcing keyboard users to tab through 50 navigation links on *every single page* before they can reach the content.

**Haltija Signature:**
- **Action:** Press `Tab` from page load
- **Check:** Is one of the first 3 focusable elements a link to `#main` or `main`?

**Report:** "Navigation Fatigue: Missing 'Skip to Content' link."

---

## Implementation Strategy: The Audit Flag

You don't want this running on every fast iteration loop (it generates too much noise).

**Add a flag to the Haltija CLI:**

```bash
# Run functional tests only
npx haltija test

# Run with full Criminal Investigation
npx haltija test --audit
```

When `--audit` is active, the Agent gets the "Criminal Code" system prompt and the Haltija widget activates its "Sensors" (Contrast checker, Layout shift observer, etc.).

This allows teams to separate:
- **"Did we break the build?"** (Functional)
- **"Did we ruin the product?"** (Audit)

---

## The Value Proposition

You aren't just selling a "Tester." You are selling a **Compliance Officer**.

If a company uses Haltija, they aren't just checking if the login button works. They're checking:

- "Did we alienate our European customers today?"
- "Did we break the site for Canada?"
- "Is our mobile menu usable by humans?"

This turns **JSON Test Results** into a **Business Risk Report**. That's worth 10x what a Selenium script is worth.

---

## Severity Levels

| Level | Description | Example |
|-------|-------------|---------|
| **Critical** | Site unusable | Phantom Shield blocking all clicks |
| **Felony** | Major user harm | Paste Blockade on passwords |
| **Misdemeanor** | Friction/annoyance | Tiny tap targets |
| **Violation** | Best practice breach | Missing form labels |
| **Warning** | Potential issue | Country picker lacks typeahead |

---

## Future Additions (Parking Lot)

From original roadmap, not yet codified:

- **CAPTCHA nightmares** - inaccessible, unsolvable
- **Hamburger menus hiding critical actions** - primary nav buried
- **No skip links** - keyboard users trapped in header
- **Hover-dependent UI on mobile** - tooltips/menus that require hover
- **Pinch-zoom disabled** - viewport meta crimes
- **Auto-formatting that fights input** - phone fields that add/remove chars while typing
- **Duplicate country entries** - "UK" vs "Great Britain" vs "United Kingdom"
- **Language selector buried** - in footer? hamburger? settings? random flag icon?
- **Missing lang attribute** - wrong language auto-detected, no way to fix
