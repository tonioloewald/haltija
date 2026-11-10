import { describe, it, expect } from 'bun:test'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const DESKTOP = join(import.meta.dir, '..', 'apps', 'desktop')

function hasAssetutil(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('xcrun', ['--find', 'assetutil'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// macOS 26 shows the layered (Liquid Glass) icon only when Info.plist's CFBundleIconName names an
// IconGroup in Assets.car. actool names that group after the .icon bundle's file, not --app-icon, so
// the two drifted ('AppIcon' vs 'haltija') and the app silently fell back to its static icon.icns.
describe('desktop app icon (virta #3740)', () => {
  it.skipIf(!hasAssetutil())('CFBundleIconName names an IconGroup in Assets.car', () => {
    const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8'))
    const declared = pkg.build.mac.extendInfo.CFBundleIconName
    const info = JSON.parse(
      execFileSync('xcrun', ['assetutil', '--info', join(DESKTOP, 'resources', 'Assets.car')], { encoding: 'utf8' }),
    )
    const groups = new Set(info.filter((a: any) => a.AssetType === 'IconGroup').map((a: any) => a.Name.split('/')[0]))
    expect([...groups]).toContain(declared)
  })
})
