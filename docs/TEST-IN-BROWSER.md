# Browser tests with the host's `expect` (`testInBrowser`)

Tests whose **assertions run on the host** (your ordinary `bun:test`, vitest or jest file, with its
real `expect`) and whose **probes run in a real browser**. Only the small expression inside
`read()` crosses into the page; everything else is an ordinary closure.

```ts
import { test, expect, afterAll } from 'bun:test'
import { hj, createBrowserPage, markBrowserTestRan, assertBrowserTierRan } from 'haltija/test'

const page = createBrowserPage(hj) // any haltija client is a bridge

test('the slider moves', async () => {
  markBrowserTestRan()
  const box = await page.read(() => document.querySelector('#thumb')!.getBoundingClientRect().toJSON())
  await page.dragFrom(box.x + 5, box.y + 5, 40, 0)
  expect(await page.read(() => (document.querySelector('#slider') as HTMLInputElement).value)).toBe('60')
})

afterAll(() => assertBrowserTierRan()) // "ran nothing" fails; it does not pass quietly
```

`read(fn, args)` re-parses `fn` in the page, so it cannot see the test's variables. Pass what it
needs as `args`. Values come back as JSON.

`page` has `read`, `click`, `type`, `press`, and the coordinate actions `clickAt(x, y)` and
`dragFrom(x, y, dx, dy, steps?)` for UI with no selectable element. Coordinates are
viewport-relative, as `getBoundingClientRect()` reports them; a point below the fold is scrolled
into view first.

## Which engine?

| Bridge | Engines | What `click` / `type` are |
| --- | --- | --- |
| a haltija client (`hj`, `createTestClient(url)`) | whatever browser has the widget: the desktop app, `haltija --headless` (**Chromium only**), or any tab you injected it into | haltija's realistic synthetic sequences; haltija selectors, including `:text()` |
| `playwrightBridge(page)` | Chromium, Firefox, **WebKit** | Playwright's real input and Playwright's selectors |

`read`, `clickAt` and `dragFrom` behave the same on both, because they are plain JavaScript
evaluated in the page.

### Firefox and WebKit: `playwrightBridge`

`haltija --headless` launches Chromium and has no engine flag. For another engine, launch it with
Playwright yourself and hand the page to the bridge. No haltija server is involved.

```ts
import { webkit } from 'playwright'
import { createBrowserPage, playwrightBridge } from 'haltija/test'

const browser = await webkit.launch()
const pw = await browser.newPage()
await pw.goto('http://localhost:3000')
const page = createBrowserPage(playwrightBridge(pw))
```

## Writing your own bridge

A bridge is four methods:

```ts
interface BrowserBridge {
  eval(code: string): Promise<BridgeEvalResult>
  click(selector: string): Promise<BridgeActionResult>
  type(selector: string, text: string): Promise<BridgeActionResult>
  press(key: string): Promise<BridgeActionResult>
}
```

**`eval` must resolve to the value the code evaluated to** (with a returned Promise already
resolved). Two other shapes are accepted: `{ data: value }`, and `{ success: false, error }` when
the code threw. Do not invent a wrapper such as `{ success: true, value }`: the probe will have run
correctly and every `read()` will fail, with an error saying the bridge returned no `{ ok }`
envelope.

`click`, `type` and `press` may resolve to anything; `{ success: false, error }` fails the step. Any
method may reject instead.

## One measuring trap

Measure rendered boxes only (`getBoundingClientRect().width > 0`). Collapsed whitespace and custom
elements that have not upgraded report a zero rect, and a zero rect compared with an earlier
non-zero one reads as a large layout shift. tosijs-editor measured a 1058px shift this way, in two
engines, that did not exist.
