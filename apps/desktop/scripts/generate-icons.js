#!/usr/bin/env node
/**
 * Generate app icons from SVG using Electron's browser context.
 * Renders SVG to canvas at each size with proper transparency.
 * 
 * Usage: node scripts/generate-icons.js
 * Or: npm run icons
 */

const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync, readFileSync, copyFileSync, rmSync } = require('fs')
const { join, dirname } = require('path')
const { execSync } = require('child_process')

const APP_DIR = dirname(__dirname)
const ROOT_DIR = join(APP_DIR, '../..')
const SVG_PATH = join(ROOT_DIR, 'haltija-icon.svg')
const ICONS_DIR = join(APP_DIR, 'icons')

const SIZES = [1024, 512, 256, 128, 64, 32, 16]

async function generateIcons() {
  mkdirSync(ICONS_DIR, { recursive: true })
  
  // Read SVG content
  const svgContent = readFileSync(SVG_PATH, 'utf8')
  
  // Create hidden window for rendering (use deviceScaleFactor: 1 to avoid retina scaling)
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    webPreferences: {
      offscreen: true,
      zoomFactor: 1.0,
    }
  })
  
  // Force 1x scale factor
  win.webContents.setZoomFactor(1.0)
  
  console.log('Generating icons from SVG...')
  
  // Generate each size
  for (const size of SIZES) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    html, body { background: transparent !important; }
  </style>
</head>
<body>
  <canvas id="c" width="${size}" height="${size}"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const svg = new Blob([${JSON.stringify(svgContent)}], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svg);
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, ${size}, ${size});
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      URL.revokeObjectURL(url);
      document.body.dataset.ready = 'true';
    };
    img.src = url;
  </script>
</body>
</html>`
    
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    
    // Wait for image to render
    await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        const check = () => document.body.dataset.ready === 'true' ? resolve() : setTimeout(check, 10);
        check();
      })
    `)
    
    // Capture the canvas area
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    const pngBuffer = image.toPNG()
    
    writeFileSync(join(ICONS_DIR, `icon_${size}x${size}.png`), pngBuffer)
    console.log(`  ${size}x${size}`)
  }
  
  win.close()
  
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
  }
  
  console.log(`Done! Icons in ${ICONS_DIR}`)
}

app.whenReady().then(generateIcons).then(() => app.quit()).catch(err => {
  console.error('Error:', err)
  app.quit()
  process.exit(1)
})
