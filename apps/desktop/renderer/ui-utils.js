/**
 * Shared UI utilities — notifications, floating panels, drag tracking.
 */

export function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Simple toast notification */
export function showNotification(message, duration = 2000) {
  const existing = document.getElementById('toast-notification')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.id = 'toast-notification'
  toast.textContent = message
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent, #6366f1);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: toast-in 0.2s ease-out;
  `

  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style')
    style.id = 'toast-styles'
    style.textContent = `
      @keyframes toast-in { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
      @keyframes toast-out { to { opacity: 0; transform: translateX(-50%) translateY(10px); } }
    `
    document.head.appendChild(style)
  }

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.2s ease-in forwards'
    setTimeout(() => toast.remove(), 200)
  }, duration)
}

/** Track a drag operation from mousedown/touchstart */
export function trackDrag(event, callback, cursor = 'move') {
  const isTouchEvent = event.type.startsWith('touch')

  if (!isTouchEvent) {
    const origX = event.clientX
    const origY = event.clientY

    const tracker = document.createElement('div')
    tracker.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;cursor:' + cursor
    document.body.appendChild(tracker)

    const onMove = (e) => {
      const dx = e.clientX - origX
      const dy = e.clientY - origY
      if (callback(dx, dy, e) === true) {
        tracker.removeEventListener('mousemove', onMove)
        tracker.removeEventListener('mouseup', onMove)
        tracker.remove()
      }
    }

    tracker.addEventListener('mousemove', onMove, { passive: true })
    tracker.addEventListener('mouseup', onMove, { passive: true })
  } else if (event.touches) {
    const touch = event.touches[0]
    const touchId = touch.identifier
    const origX = touch.clientX
    const origY = touch.clientY
    const target = event.target

    const onTouch = (e) => {
      const t = [...e.touches].find(t => t.identifier === touchId)
      const dx = t ? t.clientX - origX : 0
      const dy = t ? t.clientY - origY : 0
      if (callback(dx, dy, e) === true || !t) {
        target.removeEventListener('touchmove', onTouch)
        target.removeEventListener('touchend', onTouch)
        target.removeEventListener('touchcancel', onTouch)
      }
    }

    target.addEventListener('touchmove', onTouch)
    target.addEventListener('touchend', onTouch, { passive: true })
    target.addEventListener('touchcancel', onTouch, { passive: true })
  }
}

function findHighestZ() {
  return [...document.querySelectorAll('body *')]
    .map(el => parseFloat(getComputedStyle(el).zIndex))
    .filter(z => !isNaN(z))
    .reduce((max, z) => Math.max(max, z), 0)
}

/** Create a floating panel positioned near a target element */
export function createFloatPanel({ target, content, title = '', position = 's', onClose }) {
  const existing = document.querySelector(`.float-panel[data-title="${title}"]`)
  if (existing) {
    existing.remove()
    return null
  }

  const panel = document.createElement('div')
  panel.className = 'float-panel'
  panel.dataset.title = title
  panel.style.zIndex = findHighestZ() + 1

  panel.innerHTML = `
    <div class="float-header">
      <span class="float-title">${escapeHtml(title)}</span>
      <button class="float-close" title="Close">×</button>
    </div>
    <div class="float-content"></div>
  `

  panel.querySelector('.float-content').appendChild(content)

  const header = panel.querySelector('.float-header')
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.float-close')) return
    panel.style.zIndex = findHighestZ() + 1
    const x = panel.offsetLeft
    const y = panel.offsetTop
    trackDrag(e, (dx, dy, evt) => {
      panel.style.left = `${x + dx}px`
      panel.style.top = `${y + dy}px`
      panel.style.right = 'auto'
      panel.style.bottom = 'auto'
      return evt.type === 'mouseup'
    })
  })

  panel.querySelector('.float-close').addEventListener('click', () => {
    panel.remove()
    onClose?.()
  })

  document.body.appendChild(panel)

  if (target) {
    const rect = target.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()

    let left, top
    switch (position) {
      case 'n':
        left = rect.left + rect.width / 2 - panelRect.width / 2
        top = rect.top - panelRect.height - 8
        break
      case 's':
      default:
        left = rect.left + rect.width / 2 - panelRect.width / 2
        top = rect.bottom + 8
        break
    }

    left = Math.max(8, Math.min(left, window.innerWidth - panelRect.width - 8))
    top = Math.max(8, Math.min(top, window.innerHeight - panelRect.height - 8))

    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
  }

  return panel
}
