/**
 * haltija as a producer of the floorplan record format (virta #873).
 *
 * The schematic used to be drawn by ~600 lines of renderer inside component.ts. tosijs-floorplan is
 * the shared renderer for the same idea (tosijs's `describe()` output is already its input), so
 * haltija now emits records and lets floorplan draw them. What stays here is what only a DOM
 * producer knows: geometry, the page's own colours, and audits computed with DOM access.
 *
 * Pure: no DOM, so the mapping is unit-tested without a browser.
 */

/**
 * The subset of floorplan's `SchematicRecord` that haltija emits, declared here rather than imported:
 * floorplan is bundled into the widget (a devDependency), and `dist/` ships this file's .d.ts, which
 * must not name a package npm users never install. component.ts hands these records straight to
 * floorplan's `schematic()`, so tsc still checks them against the real interface.
 */
export interface SchematicRecord {
  tag: string
  ref?: string
  id?: string
  role?: string
  label?: string
  placeholder?: string
  text?: string
  value?: string
  href?: string
  type?: string
  checked?: boolean
  disabled?: boolean
  focused?: boolean
  interactive?: boolean
  editable?: boolean
  contentEditable?: boolean
  structural?: boolean
  image?: string
  style?: { background: string; borderColor: string; color: string }
  flags?: Array<{ kind: string; label: string; severity?: 'info' | 'warn' | 'error' }>
  bounds?: { x: number; y: number; width: number; height: number }
}

/** The fields of a haltija map node that this mapping reads (see buildDomAffordances). */
export interface MapNode {
  ref?: string
  tag: string
  role?: string
  id?: string
  label?: string
  placeholder?: string
  text?: string
  value?: string
  href?: string | null
  type?: string
  checked?: boolean
  disabled?: boolean
  focused?: boolean
  interactive?: boolean
  editable?: boolean
  empty?: boolean
  ownBg?: boolean
  ownBorder?: boolean
  contrastFail?: string
  smallTarget?: string
  svgImage?: string
  colors?: { bg?: string; fg?: string; border?: string }
  rect?: { x: number; y: number; w: number; h: number }
  children?: MapNode[]
}

export interface CanvasThumb {
  ref: string
  label: string
  image?: string
  error?: string
  rect?: { x: number; y: number; w: number; h: number }
}

/**
 * Strip the provenance arrows out of page-derived text (virta #816, floorplan's spec: MUST).
 *
 * In the record format `"x ⟷ path"` means "two-way bound to path". Page text is untrusted, so a
 * page whose button reads `confirmed ⟷ app.status` would be drawn, and reported, as a writable
 * binding. The renderer can't tell a forged suffix arrow from a real one; only the producer can,
 * by never letting one in.
 *
 * A hand copy of floorplan's policy until floorplan exports one (virta #3387, UPSTREAM.md).
 */
export function neutralizeArrows(s: string): string {
  return s.replaceAll('⟷', '<->').replaceAll('⟵', '<-')
}

/** The page-text fields of a node that the arrow rule covers. `href` is a destination, kept verbatim by spec. */
export const PAGE_TEXT_FIELDS = ['label', 'placeholder', 'text', 'value'] as const

/**
 * Nothing of its own to say or show: its children's positions already show the grouping, so it
 * earns no box. A `<header>` that paints a background keeps its box, because that background is
 * content and is what the contrast audit is measured against.
 */
function isPureLayout(n: MapNode): boolean {
  return (
    !!n.children?.length &&
    !n.label && !n.text && n.value === undefined && !n.href &&
    !n.placeholder && !n.contrastFail && !n.interactive && !n.ownBg && !n.ownBorder
  )
}

const STRUCTURAL_TAGS = new Set([
  'main', 'nav', 'header', 'footer', 'aside', 'section', 'form', 'dialog',
])

/** One node to one record. Children are flattened by the caller, parents first. */
export function toRecord(n: MapNode): SchematicRecord {
  const r: SchematicRecord = { tag: n.tag }
  if (n.ref) r.ref = n.ref
  if (n.id) r.id = n.id
  if (n.role) r.role = n.role
  if (n.label) r.label = n.label
  if (n.placeholder) r.placeholder = n.placeholder
  if (n.text) r.text = n.text
  if (n.value !== undefined && n.value !== '') r.value = String(n.value)
  if (n.href) r.href = n.href
  if (n.type && n.type !== 'text' && n.type !== 'submit' && n.type !== 'button') r.type = n.type
  if (n.checked) r.checked = true
  if (n.disabled) r.disabled = true
  if (n.focused) r.focused = true
  // Asserted, not inferred: page script cannot enumerate addEventListener handlers, so haltija
  // says what its selector matched. The format's `interactive` exists for producers like this one.
  if (n.interactive) r.interactive = true
  // Both: `editable` is the assertion, `contentEditable` is what makes floorplan caption it as a field
  // (its placeholder in italics when empty) rather than as a `<div>`.
  if (n.editable) { r.editable = true; r.contentEditable = true }
  // Structure is drawn as faint dotted ground, without the page's colours. A landmark that paints its
  // own background or border keeps them: a dark header IS content, and the contrast audit of the text
  // on it is only legible against it.
  if (STRUCTURAL_TAGS.has(n.tag) && !n.interactive && !n.ownBg && !n.ownBorder) r.structural = true
  if (n.svgImage) r.image = n.svgImage
  if (n.colors && (n.colors.bg || n.colors.fg || n.colors.border)) {
    // No border of its own: a faint hairline (slate when interactive), as haltija drew it before.
    // floorplan's fallback is currentColor, which put a heavy black outline on every paragraph.
    const border = n.colors.border || (n.interactive ? '#334155' : 'rgba(0,0,0,.18)')
    // Partial on purpose: floorplan falls back per field (styleColor), so a missing border stays
    // `currentColor` instead of being faked from the background. The declared type wants all three.
    r.style = {
      ...(n.colors.bg ? { background: n.colors.bg } : {}),
      borderColor: border,
      ...(n.colors.fg ? { color: n.colors.fg } : {}),
    } as SchematicRecord['style']
  }
  const flags: NonNullable<SchematicRecord['flags']> = []
  // Short labels: floorplan draws the first flag's label beside the box, where a WCAG sentence
  // overlapped the neighbours. The full text rides haltija's legend.
  if (n.contrastFail) flags.push({ kind: 'contrast', label: `contrast ${n.contrastFail.split(' ')[0]}`, severity: 'error' })
  // 'target' is in floorplan's TARGET_FLAG_KINDS, so this finding supersedes the renderer's own
  // geometry audit rather than double-marking (#819). haltija computes WCAG 2.5.8's inline
  // exception with real DOM access, which is the path floorplan's README names for DOM producers.
  if (n.smallTarget) flags.push({ kind: 'target', label: `target ${n.smallTarget.split(' ')[0]}`, severity: 'warn' })
  if (flags.length) r.flags = flags
  // rect {x,y,w,h} → bounds {x,y,width,height}. Must stay numeric: floorplan drops any record whose
  // bounds are not finite numbers (#2756), and `'10'` counts as not finite.
  if (n.rect) {
    const { x, y, w, h } = n.rect
    r.bounds = { x: Number(x), y: Number(y), width: Number(w), height: Number(h) }
  }
  return r
}

/** Flatten a haltija map into records, parents before children so children draw on top. */
export function toFloorplanRecords(nodes: MapNode[], canvases: CanvasThumb[] = []): SchematicRecord[] {
  const out: SchematicRecord[] = []
  const visit = (n: MapNode) => {
    // A hoisted wrapper (no ref) or a pure-layout container draws nothing; its children still do.
    if (n.ref && !isPureLayout(n)) out.push(toRecord(n))
    for (const c of n.children || []) visit(c)
  }
  nodes.forEach(visit)
  // A canvas's pixels go in last and in place: it is usually the page's actual content.
  for (const c of canvases) {
    if (!c.rect) continue
    out.push({
      tag: 'canvas',
      ref: c.ref,
      label: c.error ? `${c.label} — ${c.error}` : c.label,
      ...(c.image ? { image: c.image } : {}),
      bounds: { x: c.rect.x, y: c.rect.y, width: c.rect.w, height: c.rect.h },
    })
  }
  return out
}
