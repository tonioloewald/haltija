/**
 * One drag, used by BOTH `/drag` and the test-suite runner's `drag` step.
 *
 * The runner had no `drag` case at all, so a suite step failed with "Unsupported step action: drag"
 * even though `hj drag` and `POST /drag` both worked (issue #30). The obvious fix — copy the
 * routine into the runner's switch — is the mistake this release cycle keeps paying for: `/type`'s
 * `ref`, `/map`'s parameters, `:text()` vs `/find`, `hj wait` vs the runner's `wait`. Every one was
 * two implementations of a single idea with only one of them updated.
 *
 * Dragging is not a single message to the widget (which is what a reasonable reader assumes from
 * the outside): it scrolls into view, measures the element, then dispatches a mouseenter/over/move
 * → mousedown → N interpolated mousemoves → mouseup sequence. That is far too much behaviour to
 * have two copies of, so it lives here and both callers call it.
 */

/** How a caller talks to the browser widget. Both call sites already have one of these. */
export type BrowserRequest = (
  channel: string,
  action: string,
  payload: unknown,
  timeout?: number,
  windowId?: string,
) => Promise<{ success: boolean; data?: any; error?: string }>

export interface DragOptions {
  ref?: string
  selector?: string
  deltaX?: number
  deltaY?: number
  /** Total drag time in ms (default 300). Also sets how many mousemoves are interpolated. */
  duration?: number
}

export interface DragResult {
  success: boolean
  error?: string
  from?: { x: number; y: number }
  to?: { x: number; y: number }
  /** Set when the drag dispatched but the target cannot be driven by synthetic events. */
  warning?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Eval-safe expression resolving a selector through the widget's resolver (so `:text()` works). */
function qs(selector: string): string {
  return `(window.__haltija_resolveSelector || document.querySelector.bind(document))(${JSON.stringify(selector)})`
}

export async function performDrag(
  request: BrowserRequest,
  opts: DragOptions,
  windowId?: string,
): Promise<DragResult> {
  const { ref, selector } = opts
  const deltaX = opts.deltaX || 0
  const deltaY = opts.deltaY || 0
  const duration = opts.duration || 300
  const steps = Math.max(5, Math.floor(duration / 16))
  const targetDesc = ref ? `@${ref}` : selector

  // Scroll into view (use ref or selector)
  if (ref) {
    await request(
      'eval',
      'exec',
      {
        code: `(window.__haltija_refRegistry?.resolve(${JSON.stringify(ref)}) || document.body)?.scrollIntoView({behavior: "smooth", block: "center"})`,
      },
      5000,
      windowId,
    )
  } else if (selector) {
    await request(
      'eval',
      'exec',
      { code: `${qs(selector)}?.scrollIntoView({behavior: "smooth", block: "center"})` },
      5000,
      windowId,
    )
  }
  await sleep(100)

  // Measure it. A drag against an element that isn't there must fail HERE — dispatching mouse
  // events at coordinates derived from a missing box would "succeed" while dragging nothing.
  const inspectResponse = await request('dom', 'inspect', { ref, selector }, 5000, windowId)
  if (!inspectResponse.success || !inspectResponse.data) {
    return {
      success: false,
      error:
        `Element not found: ${targetDesc}. Run \`hj map\` or \`hj tree\` to see what is on the page; ` +
        `prefer text selectors (\`:text(save)\`, \`:text-is(Save)\`) or \`[data-testid=…]\` over ` +
        `structural ones, and \`hj wait <selector>\` if the page may still be loading.`,
    }
  }
  const box = inspectResponse.data.box
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  // NATIVE FORM CONTROLS CANNOT BE DRAGGED BY SYNTHETIC EVENTS, and until now we reported success
  // anyway. Measured: dragging a `<input type=range>` 60px leaves value at 0, while an identical
  // drag on a custom div thumb moves it 0 -> 60px. The browser drives native controls from TRUSTED
  // input only; a custom implementation listens for `mousemove` on `document` and therefore works,
  // which is why MUI sliders, resize handles and drag-reorder lists (the cases this feature exists
  // for) are fine.
  //
  // Reporting success on a drag that moved nothing is the silent-wrong-action shape this product
  // keeps finding in itself, so the result carries a warning naming the cause and the way round it.
  // `/inspect` returns `tagName`, not `tag` — checked against the live response rather than assumed,
  // after the first version of this guard read a field that does not exist and never fired.
  const tag = String(inspectResponse.data.tagName || '').toLowerCase()
  const type = String(inspectResponse.data.attributes?.type || '').toLowerCase()
  const untouchable =
    tag === 'input' && (type === 'range' || type === 'file' || type === 'color')
  const warning = untouchable
    ? `\`${tag}[type=${type}]\` is a NATIVE control: browsers only move it for trusted input, so ` +
      `this drag dispatched but almost certainly changed nothing. Set its value with an \`eval\` ` +
      `step instead (assign \`value\`, then dispatch \`input\` and \`change\`). Custom sliders and ` +
      `handles — which listen for mousemove on document — are unaffected.`
    : undefined

  // mouseenter, mouseover, mousemove to start
  for (const event of ['mouseenter', 'mouseover', 'mousemove']) {
    await request(
      'events',
      'dispatch',
      { ref, selector, event, options: { clientX: startX, clientY: startY } },
      5000,
      windowId,
    )
  }

  // mousedown
  await request(
    'events',
    'dispatch',
    { ref, selector, event: 'mousedown', options: { clientX: startX, clientY: startY } },
    5000,
    windowId,
  )

  // mousemove steps
  const stepDelay = duration / steps
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps
    const x = startX + deltaX * progress
    const y = startY + deltaY * progress
    await request(
      'eval',
      'exec',
      {
        code: `document.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))`,
      },
      5000,
      windowId,
    )
    await sleep(stepDelay)
  }

  // mouseup
  await request(
    'eval',
    'exec',
    {
      code: `document.dispatchEvent(new MouseEvent('mouseup', { clientX: ${startX + deltaX}, clientY: ${startY + deltaY}, bubbles: true }))`,
    },
    5000,
    windowId,
  )

  return {
    success: true,
    from: { x: startX, y: startY },
    to: { x: startX + deltaX, y: startY + deltaY },
    ...(warning ? { warning } : {}),
  }
}
