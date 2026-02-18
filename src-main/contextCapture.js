const { screen } = require('electron')
const { captureScreenshot } = require('./captureScreenshots')
const windowsCapture = require('./captureWindows')
const { shouldIncludeForContext, getActiveWindowSafe, normalizeAppName } = windowsCapture
const { calculateVisibleRegion, cropRegionFromImage } = require('./windowRegionUtils')
const { getBasePath, getStore } = require('./captureDump')
const path = require('path')
const fs = require('fs')

const CONTEXT_CAPTURE_URL = 'https://europe-west1-donethat.cloudfunctions.net/contextCapture'
const DWELL_MS = 10 * 1000
const REPEAT_MS = 60 * 1000

let dwellState = null
let getIdTokenFn = null
let contextCaptureInFlight = false

function getWindowId(window) {
  if (!window?.appName) return null
  return `${normalizeAppName(window.appName)}|${window.title || ''}`
}

function sanitizeAppSlug(name) {
  if (!name || typeof name !== 'string') return 'unknown'
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

async function getContextConfig() {
  const store = await getStore()
  const enabled = store.get('contextCaptureEnabled')
  const apps = store.get('contextApps') || []
  return { enabled: !!enabled, apps: Array.isArray(apps) ? apps : [] }
}

async function captureContextForActiveWindow(activeWin) {
  try {
    const screenshots = await captureScreenshot({ caller: 'context' })
    if (!screenshots || screenshots.length === 0) {
      return null
    }
    
    const displayBounds = screen.getAllDisplays()
    if (!displayBounds?.length) return null

    const store = await getStore()
    const contextApps = store.get('contextApps') || []
    if (!contextApps.length) return null

    // Build a simple window object from the active window
    const activeAppName = activeWin.owner?.name || activeWin.owner?.processName || 'Unknown'
    const targetWindow = {
      appName: activeAppName,
      title: activeWin.title || '',
      bounds: activeWin.bounds,
      screen: 0 // Will be determined below
    }
    
    // Verify this window should be captured
    if (!shouldIncludeForContext(targetWindow, contextApps)) return null

    const isMerged = screenshots.length === 1 && displayBounds.length > 1
    const primaryDisplay = displayBounds.find(d => d.id === screen.getPrimaryDisplay().id) || displayBounds[0]

    let screenshot, screenBounds, display
    if (isMerged) {
      screenshot = screenshots[0]
      const minX = Math.min(...displayBounds.map(d => d.bounds.x))
      const minY = Math.min(...displayBounds.map(d => d.bounds.y))
      const maxX = Math.max(...displayBounds.map(d => d.bounds.x + d.bounds.width))
      const maxY = Math.max(...displayBounds.map(d => d.bounds.y + d.bounds.height))
      screenBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      display = primaryDisplay
    } else {
      // Determine which screen the window is on
      const windowBounds = targetWindow.bounds
      let screenIndex = 0
      if (windowBounds) {
        for (let i = 0; i < displayBounds.length; i++) {
          const db = displayBounds[i].bounds
          if (windowBounds.x >= db.x && windowBounds.x < db.x + db.width &&
              windowBounds.y >= db.y && windowBounds.y < db.y + db.height) {
            screenIndex = i
            break
          }
        }
      }
      targetWindow.screen = screenIndex
      screenshot = screenshots[screenIndex] || screenshots[0]
      display = displayBounds[screenIndex] || displayBounds[0]
      screenBounds = display?.bounds || { width: 1920, height: 1080 }
    }

    // For context capture, we only care about the active window, so treat it as the only window
    // This avoids calling getAllVisibleWindows which pauses window tracking
    const regions = calculateVisibleRegion(targetWindow, [targetWindow], screenBounds, display)
    if (!regions?.length) return null

    const cropped = await cropRegionFromImage(screenshot, regions, screenBounds, 800)
    if (!cropped) return null

    return {
      appName: targetWindow.appName || 'Unknown',
      title: targetWindow.title || '',
      base64Data: cropped
    }
  } catch (err) {
    return null
  }
}

async function saveContextDump(contextItems) {
  try {
    const store = await getStore()
    if (!store.get('saveCaptureDataToFolder')) return
    const basePath = await getBasePath()
    const now = Date.now()
    const d = new Date(now)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const ts = `${dateStr}-${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}-${String(d.getMilliseconds()).padStart(3, '0')}`

    for (let i = 0; i < contextItems.length; i++) {
      const item = contextItems[i]
      const appSlug = sanitizeAppSlug(item.appName)
      const suffix = contextItems.length > 1 ? `-${i}` : ''
      const dir = path.join(basePath, 'context', dateStr, `${appSlug}-${ts}${suffix}`)
      fs.mkdirSync(dir, { recursive: true })
      const base64 = (item.base64Data || '').replace(/^data:image\/\w+;base64,/, '')
      if (base64) {
        fs.writeFileSync(path.join(dir, 'screenshot.jpg'), Buffer.from(base64, 'base64'))
      }
      fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({
        appName: item.appName,
        title: item.title,
        timestamp: now
      }, null, 2))
    }
  } catch (err) {
  }
}

async function sendContextToApi(idToken, contextItems) {
  if (!idToken || !contextItems?.length) return
  try {
    const fetch = (await import('node-fetch')).default
    // Fire and forget: don't await the fetch promise so the function returns immediately
    fetch(CONTEXT_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify({
        timestamp: Date.now(),
        contextScreenshots: contextItems.map(i => ({ appName: i.appName, title: i.title, base64Data: i.base64Data }))
      })
    }).catch(() => {
      // Silently catch background errors
    })
  } catch (err) {
    // Silently catch initialization errors
  }
}

/**
 * Called by recordCurrentWindow every time the active window is tracked
 * Checks dwell time and triggers capture if threshold is met
 */
async function onActiveWindowTracked(activeWindowInfo) {
  try {
    const { enabled, apps } = await getContextConfig()
    if (!enabled || !apps.length) {
      if (dwellState) dwellState = null
      return
    }

    if (!activeWindowInfo?.bounds) {
      if (dwellState) dwellState = null
      return
    }

    const win = {
      appName: activeWindowInfo.owner?.name || activeWindowInfo.owner?.processName || 'Unknown',
      title: activeWindowInfo.title || '',
      bounds: activeWindowInfo.bounds
    }
    
    if (!shouldIncludeForContext(win, apps)) {
      if (dwellState) dwellState = null
      return
    }

    const windowId = getWindowId(win)
    if (!windowId) return

    const now = Date.now()
    if (!dwellState || dwellState.windowId !== windowId) {
      dwellState = { windowId, firstSeenAt: now, lastCaptureAt: 0 }
    }

    const dwellMs = now - dwellState.firstSeenAt
    if (dwellMs < DWELL_MS) return

    const sinceLastCapture = now - dwellState.lastCaptureAt
    const shouldCapture = dwellState.lastCaptureAt === 0 || sinceLastCapture >= REPEAT_MS
    if (!shouldCapture) return
    if (contextCaptureInFlight) return

    contextCaptureInFlight = true
    dwellState.lastCaptureAt = now
    try {
      const item = await captureContextForActiveWindow(activeWindowInfo)
      if (item) {
        await saveContextDump([item])
        const token = getIdTokenFn ? getIdTokenFn() : null
        if (token) sendContextToApi(token, [item]).catch(() => {})
      }
    } finally {
      contextCaptureInFlight = false
    }
  } catch (err) {
  }
}

function startContextCapture(getIdToken) {
  getIdTokenFn = getIdToken
}

function stopContextCapture() {
  dwellState = null
  getIdTokenFn = null
  contextCaptureInFlight = false
}

module.exports = { startContextCapture, stopContextCapture, onActiveWindowTracked }
