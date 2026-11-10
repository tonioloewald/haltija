import { describe, it, expect } from 'bun:test'
import { builtinModules } from 'module'
import { readFileSync } from 'fs'
import { join } from 'path'

// Every package a shipped entry point imports must be one an installer will actually provide (#3384).
// A devDependency imported bare (tosijs-floorplan is the live example: component.ts uses it, and only
// the bundler's inlining keeps it out of the shipped import list) passes every test in this repo,
// where node_modules has it, and fails for every adopter. The MCP bundle has its own, stricter build
// check (no non-builtin import at all).
const ROOT = join(import.meta.dir, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const provided = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  pkg.name, // self-reference through `exports`
])
const builtins = new Set(builtinModules)
const transpiler = new Bun.Transpiler({ loader: 'js' })

function packageOf(spec: string): string {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
}

const entries = [...new Set(Object.values(pkg.exports as Record<string, { import: string }>).map((e) => e.import))]

describe('shipped entry points import only what an install provides (#3384)', () => {
  for (const entry of entries) {
    it(entry, () => {
      const code = readFileSync(join(ROOT, entry), 'utf8')
      const undeclared = transpiler
        .scanImports(code)
        .map((i) => i.path)
        .filter((p) => !p.startsWith('.') && !p.startsWith('/') && !p.startsWith('node:') && !p.startsWith('bun:') && p !== 'bun')
        .filter((p) => !builtins.has(p) && !provided.has(packageOf(p)))
      expect(undeclared).toEqual([])
    })
  }
})
