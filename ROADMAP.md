# Haltija Roadmap

Finished phases (1–11), the architecture principles and the original file map now live in
[`docs/ROADMAP-HISTORY.md`](docs/ROADMAP-HISTORY.md). Day-to-day work is on the virta board;
this file holds the longer-range plan and the ideas parking lot.

## Planned

### Phase 12: Framework-Aware Interactions

**Make click/type just work on React, Vue, and other framework antipatterns.**

The goal: Haltija should handle framework quirks automatically. The agent shouldn't need to know it's dealing with React.

#### Problems to Solve

| Pattern | Problem | Solution |
|---------|---------|----------|
| Clickable divs | `onClick` but no button role, no keyboard | Detect handler, dispatch properly |
| Controlled inputs | React state ignores DOM events | Dispatch React synthetic events |
| Contenteditable | Rich text, not real input | Use `execCommand` or input events |
| Custom selects | Divs pretending to be dropdowns | Detect pattern, click to open, click option |
| Form libraries | Formik/RHF bypass native events | Trigger framework-specific updates |
| Virtual lists | Elements created on scroll | Scroll into existence first |

#### Detection Strategies
- Check for `onClick`/`onKeyDown` as element properties (React)
- Look for `__reactFiber$` or `__vue__` expando properties
- Detect `contenteditable="true"`
- Identify ARIA roles that indicate custom widgets (`role="listbox"`, `role="combobox"`)
- Check for common component library patterns (MUI, Ant, Chakra)

#### Implementation
- `/click` auto-detects React elements and dispatches synthetic events
- `/type` handles contenteditable and controlled inputs
- `/tree` flags elements with framework bindings
- New endpoint or flag: `/inspect` returns `frameworkHints`

#### Success Criteria
Standard selectors work on:
- MUI (Material-UI) components
- Ant Design components
- Chakra UI components
- Headless UI components
- React Hook Form / Formik forms
- Slate/TipTap/ProseMirror editors

### Phase 13: UX Crimes Database

**Curated anti-patterns to make the agent a seasoned UX auditor.**

#### Categories
- **Forms from Hell**: Phone, zip, country, date pickers, CC fields, CAPTCHA
- **Navigation Nightmares**: Language selectors, mega menus, hamburgers hiding critical actions
- **Accessibility Atrocities**: Contrast, focus traps, missing labels, div buttons, no skip links
- **Mobile Hostility**: Tap targets, viewport crimes, hover-dependent UI, pinch-zoom disabled
- **Dark Patterns**: Confirmshaming, roach motels, trick questions, hidden unsubscribe

#### Structure
- Real examples (anonymized) of each sin
- DOM signatures: how to detect programmatically
- Severity rating
- What to report / suggested fix
- WCAG/usability guidelines violated

#### Usage
- Feed as context to AI agents
- "I've seen 500 bad phone fields. Yours is the 501st."
- Turns basic automation into expert UX review

#### Built-in Heuristics (Widget Auto-Detection)
Encode crimes as detectable patterns that run automatically:

```javascript
// Example heuristics
{ 
  selector: 'input[type="text"]', 
  condition: 'label contains "password"',
  crime: 'Security Risk: Password field using type="text"',
  severity: 'critical'
},
{
  selector: 'div[onclick]',
  condition: 'no role="button"',
  crime: 'Accessibility: Clickable div without button role',
  severity: 'high'
},
{
  selector: 'input[type="tel"]',
  condition: 'no inputmode, strict pattern',
  crime: 'UX: Phone field fighting user input',
  severity: 'medium'
}
```

- Widget runs heuristics on page load
- Flags issues before agent even starts
- Standalone "Audit" mode for quick UX review
- Viral potential: shareable UX crime reports

## Other planned work

### Visual Replay Cursor

When replaying tests or recordings, show a visible animated cursor:
- **Cursor graphic** - Smooth movement to click targets
- **Click ripple** - Visual feedback when clicking
- **Typing animation** - Text appearing character-by-character with blinking caret
- **Scroll indicator** - Show scroll direction/distance
- **Hover glow** - Highlight elements being interacted with

Makes replays feel alive and helps users understand what the agent is doing.

## Ideas Parking Lot

### Smart Input Behaviors
- **Segmented inputs**: Detect split fields (OTP, credit card 4-4-4-4, SSN, phone)
  - Auto-tab between segments with natural pause
  - Type at human speed across the group
- **Password fields**: Occasional show/hide toggle, variable timing
- **Restricted inputs**: Respect maxlength, input masks, validation
- **Form field detection**: Know when it's email vs phone vs credit card
- **Phone/Zip nightmare handling**: 
  - Detect expected format from placeholder, mask, or validation errors
  - Try raw digits first, adapt if rejected
  - Handle country code dropdowns
  - Cope with auto-formatting that fights input
  - Report badly-behaved fields as accessibility/UX bugs
- **Country/State dropdowns**: 
  - Flag "200 countries, US not defaulted despite en-US locale"
  - Handle type-ahead (or lack thereof)
  - Detect duplicate entries (UK vs Great Britain vs United Kingdom)
- **Language selectors**:
  - Flag unreadable: "12 languages listed in Japanese, user locale en-US"
  - Detect missing lang attribute on html element
  - Find the selector (footer? hamburger? settings? globe icon? random flag?)
  - Report if no way to switch from auto-detected wrong language

### AI as QA Professional (Extended)
- **Exploratory testing**: Agent fuzzes around, finds edge cases
- **Bug reports**: Structured reports with repro steps, screenshots, DOM state
- **Regression verification**: "Is bug #123 fixed?" → Agent checks
- **Accessibility audits**: WCAG compliance, contrast ratios, focus order, ARIA
- **Responsive/Mobile testing**:
  - Viewport resizing, device emulation
  - Screen rotation (portrait ↔ landscape)
  - Touch vs mouse interactions
  - Tap target sizes (48px minimum)
  - Viewport meta tag validation
  - Content reflow, no horizontal scroll

### Idle Behaviors (Bug Discovery + Human Mimicry)
- Random micro-movements when "thinking"
- Occasional scroll jitter
- Tab between fields without typing
- Hover over elements before clicking
- These uncover bugs (hover states, focus traps, tooltip issues)

### Semantic Event Narration & Accessibility

**Philosophy**: Semantic events should be at least as good as a screen reader for a blind user.

**Bigger vision**: This architecture could power a *better* screen reader.

Current screen readers do DOM-level narration - "Button", "Edit text, password field", "Checkbox, checked". They read elements, not intent. Haltija's semantic events capture what's actually happening:

| Screen Reader | Haltija Semantic Event |
|---------------|------------------------|
| "Button" | "User clicked Submit to complete checkout" |
| "Edit text" | "User typed email address in login form" |
| "Checkbox, checked" | "User accepted terms and conditions" |

The aggregation we're building - debouncing keystrokes, detecting gestures, understanding navigation causality - is what screen readers *should* do. A screen reader built on this could:
- Announce meaningful actions, not element descriptions
- Skip noise (intermediate states, framework churn)
- Provide workflow context ("checkout step 2 of 3")
- Understand state changes, not just DOM changes

If a blind user can follow the semantic event stream and understand the page, we've succeeded.

- **Subtitles overlay**: Pop-up captions showing semantic events as they're captured
  - Especially useful during recording to confirm what's being tracked
  - Unobtrusive positioning, auto-fade
  - Toggle on/off from widget
  
- **Voice narration**: Text-to-speech toggle that reads semantic events aloud
  - Uses Web Speech API
  - Configurable voice, rate, pitch
  - Great for demos, accessibility testing, and hands-free monitoring
  
- **Screen reader parity**: 
  - Study real screen reader behavior (NVDA, JAWS, VoiceOver)
  - Find blind user forums/communities for feedback on pain points
  - Semantic events should announce what a screen reader would announce
  - Rich descriptions: "Button: Submit form" not just "click"
  - Context-aware: "Checkbox: Accept terms, now checked"
  
- **Accessibility testing integration**:
  - Compare our semantic stream to screen reader output
  - Flag elements with poor accessibility (missing labels, bad ARIA)
  - Partner with blind testers for real-world validation

### Apple Intelligence Integration (Speculative)
- Default AI backend using on-device Apple Intelligence (free, no API keys)
- Privacy-first: DOM never leaves the device
- Good enough for basic QA: find elements, fill forms, verify state
- "Works with your Mac's built-in AI" positioning
- Depends on Apple exposing useful APIs

### Other Ideas
- Sourcemaps for transpiled code debugging
- Session replay (video-like scrubbing)
- Heatmaps from hover/click data
- A/B test integration
- Performance metrics (LCP, FID, CLS)
- Network request monitoring
- Screenshot capture on events
- Diff between expected/actual DOM
