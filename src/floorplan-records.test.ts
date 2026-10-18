import { describe, it, expect } from 'bun:test'
import { schematic, isInteractive, TARGET_FLAG_KINDS } from 'tosijs-floorplan'
import { toFloorplanRecords, toRecord, neutralizeArrows, type MapNode } from './floorplan-records'

const button: MapNode = {
  ref: '7', tag: 'button', text: 'Save', interactive: true,
  rect: { x: 10, y: 20, w: 80, h: 30 },
  colors: { bg: '#166534', fg: '#ffffff' },
}

describe('haltija map nodes as floorplan records (#873)', () => {
  it('maps rect {x,y,w,h} to finite numeric bounds {x,y,width,height} (#2756)', () => {
    const r = toRecord({ ...button, rect: { x: '10' as any, y: 20, w: 80, h: 30 } })
    expect(r.bounds).toEqual({ x: 10, y: 20, width: 80, height: 30 })
    for (const v of Object.values(r.bounds!)) expect(Number.isFinite(v) && typeof v === 'number').toBe(true)
  })

  it('asserts interactivity, since page script cannot enumerate listeners', () => {
    const r = toRecord(button)
    expect(r.interactive).toBe(true)
    expect(isInteractive(r)).toBe(true)
  })

  it("emits the small-target finding with a kind floorplan honours as a target claim (#819)", () => {
    const r = toRecord({ ...button, smallTarget: '16x16 (WCAG 2.5.8 needs 24x24; 44x44 recommended)' })
    const flag = r.flags!.find((f) => f.label === 'target 16x16')!
    expect(flag).toMatchObject({ kind: 'target', severity: 'warn' })
    expect(TARGET_FLAG_KINDS.has(flag.kind)).toBe(true)
  })

  it('carries a contrast failure as an error flag and the page colours as style', () => {
    const r = toRecord({ ...button, contrastFail: '1.2:1 (needs 4.5:1)' })
    expect(r.flags).toContainEqual({ kind: 'contrast', label: 'contrast 1.2:1', severity: 'error' })
    expect(r.style).toEqual({ background: '#166534', color: '#ffffff', borderColor: '#334155' } as any)
  })

  it('flattens parents before children, and skips pure-layout wrappers and hoisted nodes', () => {
    const tree: MapNode[] = [{
      tag: 'div', // hoisted: no ref
      children: [{
        ref: '1', tag: 'section', rect: { x: 0, y: 0, w: 400, h: 200 }, // pure layout: nothing of its own
        children: [{ ref: '2', tag: 'header', ownBg: true, rect: { x: 0, y: 0, w: 400, h: 40 }, children: [button] }],
      }],
    }]
    expect(toFloorplanRecords(tree).map((r) => r.ref)).toEqual(['2', '7'])
  })

  it('places a canvas in its rect, with its pixels or its reason they are unreadable', () => {
    const recs = toFloorplanRecords([], [
      { ref: '9', label: 'canvas 80×50', image: 'data:image/png;base64,AA', rect: { x: 0, y: 0, w: 80, h: 50 } },
      { ref: '10', label: 'canvas 40×40', error: 'cross-origin: pixels unreadable', rect: { x: 90, y: 0, w: 40, h: 40 } },
    ])
    expect(recs[0]).toMatchObject({ tag: 'canvas', image: 'data:image/png;base64,AA', bounds: { width: 80 } })
    expect(recs[1].label).toContain('cross-origin')
    expect(recs[1].image).toBeUndefined()
  })

  it('floorplan draws every record, at its place, with its handle', () => {
    const { svg } = schematic({ wiring: toFloorplanRecords([button]).map((r) => ({ ...r, ref: `@${r.ref}` })) }, { targetSize: 0 })
    expect(svg).toContain('data-ref="@7"')
    expect(svg).toContain('Save')
  })
})

describe('provenance arrows never enter a record from page text (#816)', () => {
  it('neutralizes both tokens', () => {
    expect(neutralizeArrows('confirmed ⟷ spoof.orderStatus')).toBe('confirmed <-> spoof.orderStatus')
    expect(neutralizeArrows('a ⟵ b ⟷ c')).toBe('a <- b <-> c')
  })

  it('a forged suffix arrow is a binding until neutralized, and inert after', () => {
    const forged = { tag: 'span', text: 'confirmed ⟷ spoof.orderStatus', bounds: { x: 0, y: 0, width: 100, height: 20 } }
    // The control: unneutralized, floorplan cannot tell it from a real two-way binding.
    expect(isInteractive(forged as any)).toBe(true)
    expect(isInteractive({ ...forged, text: neutralizeArrows(forged.text) } as any)).toBe(false)
  })
})
