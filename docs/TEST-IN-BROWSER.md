# Browser tests with the host's `expect` (`testInBrowser`)

Tests whose **assertions run on the host** (an ordinary `bun:test` or vitest file, with its real
`expect`) and whose **probes run in a real browser**. A probe is the small function you pass to
`read()`: it is the only thing sent to the page, and everything else in the test is an ordinary
closure. The package is ESM only.

The API is `createBrowserPage(bridge)`, where a *bridge* is whatever can run JavaScript in a page:
a haltija client, or a Playwright page.

## Before the first example runs

`npm i -D haltija`. A haltija client needs three things: a haltija server, a browser connected to it
(a page with haltija's widget in it), and that browser on the page under test.

```bash
npm i -D playwright && npx playwright install chromium
bunx haltija --private --headless     # prints HALTIJA_PRIVATE_READY {"port": …}
HALTIJA_PORT=<that port> bun test
```

**Always name your server** (`HALTIJA_PORT`, `HALTIJA_URL`, or `createTestClient(url)`). With none
of them, `hj` targets the machine's shared `localhost:8700`. There, `click`, `type`, `press` and
`navigate` refuse to run, but `read`, `clickAt` and `dragFrom` do run, against whatever tab is
focused, which may be someone else's.

```ts
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { hj, createBrowserPage, markBrowserTestRan, assertBrowserTierRan } from 'haltija/test'

const page = createBrowserPage(hj) // hj reads HALTIJA_PORT; or createTestClient('http://localhost:9123')

beforeAll(() => hj.navigate('http://localhost:3000/slider'))

test('the handle drags', async () => {
  markBrowserTestRan()
  // The app's own drag handle, 40px to the right. Start 5px inside its corner.
  const box = await page.read(() => document.querySelector('#handle')!.getBoundingClientRect().toJSON())
  await page.dragFrom(box.x + 5, box.y + 5, 40, 0)
  expect(await page.read(() => document.querySelector('#readout')!.textContent)).toBe('40')
})

afterAll(() => assertBrowserTierRan())
```

`markBrowserTestRan()` counts a test, and `assertBrowserTierRan(minimum = 1)` throws if fewer than
`minimum` were counted. A suite that silently ran nothing has no failures, so without this it
passes.

`read(fn, args)` re-parses `fn` in the page, so it cannot see the test's variables. `args` is an
array spread into `fn`'s parameters: `page.read((a, b) => a + b, [2, 3])`. Return JSON-serializable
values. (Using `document` in a test file needs the `dom` lib in your tsconfig.)

`page` has `read`, `click`, `type`, `press`, and the coordinate actions `clickAt(x, y)` and
`dragFrom(x, y, dx, dy, steps?)` for UI with no selectable element. Coordinates are
viewport-relative, as `getBoundingClientRect()` reports them; a point below the fold is scrolled
into view first. The coordinate actions dispatch synthetic pointer and mouse events, on every
bridge. They drive handlers your code attached; they do not move a native control such as
`<input type=range>`.

## When it fails

| Cause | What you get |
| --- | --- |
| the probe threw in the page | `BrowserProbeError` (exported) with the page's message; `.probe` holds the source that was sent |
| `clickAt` / `dragFrom` hit nothing | `BrowserProbeError`: "nothing at (x, y) even after scrolling it into view", or "(x, y) is outside the document" |
| no server | the `fetch` connection error |
| server up, no browser connected | an `Error` carrying the server's message |
| no tests counted | `assertBrowserTierRan` throws |

## Which engine?

| Bridge | Engines | What `click` / `type` are |
| --- | --- | --- |
| a haltija client (`hj`, `createTestClient(url)`) | whatever browser has the widget: the desktop app, `haltija --headless` (**Chromium only**), or any tab you injected it into | haltija's realistic synthetic sequences; haltija selectors, including `:text()` |
| `playwrightBridge(page)` | Chromium, Firefox, **WebKit** | Playwright's real input and Playwright's selectors |

`press` differs more than the others. Through a haltija client it is a single synthetic `keydown`
dispatched at `body`: no `keyup`, and not aimed at the focused element. Through Playwright it is a
real key press.

`read`, `clickAt` and `dragFrom` run the same JavaScript in the page on both. Return values can
differ at the edges: a haltija client returns JSON, while Playwright's own serialization also
carries `undefined`, `NaN` and `Date`.

### Firefox and WebKit: `playwrightBridge`

`haltija --headless` launches Chromium and has no engine flag. For another engine, launch it with
Playwright yourself and hand the page to the bridge. No haltija server is involved.

```bash
npm i -D playwright && npx playwright install webkit
```

```ts
import { test, expect, afterAll } from 'bun:test' // an ordinary test file; @playwright/test is not needed
import { webkit } from 'playwright'
import { createBrowserPage, playwrightBridge } from 'haltija/test'

const browser = await webkit.launch()
const pw = await browser.newPage()
await pw.goto('http://localhost:3000')
const page = createBrowserPage(playwrightBridge(pw))

test('the heading renders', async () => {
  expect(await page.read(() => document.querySelector('h1')!.getBoundingClientRect().width)).toBeGreaterThan(0)
})

afterAll(() => browser.close())
```

`clickAt` and `dragFrom` are still synthetic events here. For real mouse input, use `pw.mouse`
directly; the Playwright page is yours.

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
