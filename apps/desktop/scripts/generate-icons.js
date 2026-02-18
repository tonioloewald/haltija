#!/usr/bin/env node
/**
 * Generate app icons from haltija.png (exported from Icon Composer).
 * 
 * Source of truth: haltija.icon (Icon Composer bundle)
 * Export: haltija.png (manually exported at 1024x1024 from Icon Composer)
 * 
 * This script:
 * 1. Resizes the exported PNG to each required size for cross-platform use
 * 2. Creates .icns for older macOS versions (CFBundleIconFile)
 * 3. Compiles .icon bundle to Assets.car for macOS 26+ Liquid Glass (CFBundleIconName)
 * 
 * Usage: node scripts/generate-icons.js
 * Or: npm run icons
 */

const { app, nativeImage } = require('electron')
const { writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } = require('fs')
const { join, dirname } = require('path')
const { execSync, spawnSync } = require('child_process')

const APP_DIR = dirname(__dirname)
const ROOT_DIR = join(APP_DIR, '../..')
const SOURCE_PNG = join(ROOT_DIR, 'haltija.png')
const ICON_BUNDLE = join(ROOT_DIR, 'haltija.icon')
const ICONS_DIR = join(APP_DIR, 'icons')
const RESOURCES_DIR = join(APP_DIR, 'resources')

const SIZES = [1024, 512, 256, 128, 64, 32, 16]

async function generateIcons() {
  // Check for source PNG
  if (!existsSync(SOURCE_PNG)) {
    console.error(`Source icon not found: ${SOURCE_PNG}`)
    console.error('Export haltija.png from Icon Composer (haltija.icon)')
    process.exit(1)
  }
  
  console.log(`Loading source icon: ${SOURCE_PNG}`)
  const sourceImage = nativeImage.createFromPath(SOURCE_PNG)
  
  if (sourceImage.isEmpty()) {
    console.error('Failed to load source image')
    process.exit(1)
  }
  
  const sourceSize = sourceImage.getSize()
  console.log(`Source size: ${sourceSize.width}x${sourceSize.height}`)
  
  mkdirSync(ICONS_DIR, { recursive: true })
  
  console.log('Generating icons...')
  
  // Generate each size
  for (const size of SIZES) {
    const resized = sourceImage.resize({ width: size, height: size, quality: 'best' })
    const pngBuffer = resized.toPNG()
    
    writeFileSync(join(ICONS_DIR, `icon_${size}x${size}.png`), pngBuffer)
    console.log(`  ${size}x${size}`)
  }
  
  // Copy main icon
  copyFileSync(join(ICONS_DIR, 'icon_512x512.png'), join(ICONS_DIR, 'icon.png'))
  
  // Create .icns using iconutil (macOS only)
  if (process.platform === 'darwin') {
    console.log('Creating .icns...')
    const iconset = join(ICONS_DIR, 'icon.iconset')
    mkdirSync(iconset, { recursive: true })
    
    copyFileSync(join(ICONS_DIR, 'icon_16x16.png'), join(iconset, 'icon_16x16.png'))
    copyFileSync(join(ICONS_DIR, 'icon_32x32.png'), join(iconset, 'icon_16x16@2x.png'))
    copyFileSync(join(ICONS_DIR, 'icon_32x32.png'), join(iconset, 'icon_32x32.png'))
    copyFileSync(join(ICONS_DIR, 'icon_64x64.png'), join(iconset, 'icon_32x32@2x.png'))
    copyFileSync(join(ICONS_DIR, 'icon_128x128.png'), join(iconset, 'icon_128x128.png'))
    copyFileSync(join(ICONS_DIR, 'icon_256x256.png'), join(iconset, 'icon_128x128@2x.png'))
    copyFileSync(join(ICONS_DIR, 'icon_256x256.png'), join(iconset, 'icon_256x256.png'))
    copyFileSync(join(ICONS_DIR, 'icon_512x512.png'), join(iconset, 'icon_256x256@2x.png'))
    copyFileSync(join(ICONS_DIR, 'icon_512x512.png'), join(iconset, 'icon_512x512.png'))
    copyFileSync(join(ICONS_DIR, 'icon_1024x1024.png'), join(iconset, 'icon_512x512@2x.png'))
    
    execSync(`iconutil -c icns "${iconset}" -o "${join(ICONS_DIR, 'icon.icns')}"`)
    rmSync(iconset, { recursive: true })
    
    // Compile .icon bundle to Assets.car for macOS 26+ Liquid Glass
    if (existsSync(ICON_BUNDLE)) {
      console.log('Compiling .icon bundle to Assets.car for macOS 26+...')
      
      const actoolPath = '/Applications/Xcode.app/Contents/Developer/usr/bin/actool'
      if (existsSync(actoolPath)) {
        const tempDir = join(ICONS_DIR, 'actool-temp')
        mkdirSync(tempDir, { recursive: true })
        
        const result = spawnSync(actoolPath, [
          ICON_BUNDLE,
          '--compile', RESOURCES_DIR,
          '--output-format', 'human-readable-text',
          '--notices', '--warnings', '--errors',
          '--output-partial-info-plist', join(tempDir, 'partial-info.plist'),
          '--app-icon', 'AppIcon',
          '--include-all-app-icons',
          '--enable-on-demand-resources', 'NO',
          '--target-device', 'mac',
          '--minimum-deployment-target', '26.0',
          '--platform', 'macosx'
        ], { encoding: 'utf8' })
        
        if (result.status === 0) {
          console.log('  Assets.car created')
          // Clean up temp
          rmSync(tempDir, { recursive: true, force: true })
        } else {
          console.warn('  Warning: actool failed:', result.stderr || result.stdout)
          rmSync(tempDir, { recursive: true, force: true })
        }
      } else {
        console.log('  Skipping Assets.car (actool not found - need Xcode)')
      }
    }
  }
  
  console.log(`Done! Icons in ${ICONS_DIR}`)
}

app.whenReady().then(generateIcons).then(() => app.quit()).catch(err => {
  console.error('Error:', err)
  app.quit()
  process.exit(1)
})
