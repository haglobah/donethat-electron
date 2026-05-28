// Active-window provider for GNOME Wayland sessions.
//
// get-windows can read the focused window on X11/macOS/Windows, but GNOME
// Wayland blocks that for ordinary apps. Instead we talk to the bundled
// "DoneThat Window Tracker" GNOME Shell extension over the session bus and
// reshape its reply to match get-windows' activeWindow()/openWindows() output,
// so the rest of captureWindows.js is unchanged.

const { execFile } = require('child_process')
const fs = require('fs')
const log = require('electron-log')

const BUS_NAME = 'ai.donethat.WindowTracker'
const OBJECT_PATH = '/ai/donethat/WindowTracker'
const INTERFACE = 'ai.donethat.WindowTracker'

// Availability is cached so we don't spawn busctl when the extension is absent.
// null = unknown (probe needed), true/false = last known state.
let extensionAvailable = null
let lastUnavailableLogAt = 0

function isGnomeWaylandSession() {
  if (process.platform !== 'linux') return false
  const isWayland = !!(
    process.env.WAYLAND_DISPLAY ||
    (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland'
  )
  if (!isWayland) return false
  const desktop = (
    process.env.XDG_CURRENT_DESKTOP ||
    process.env.ORIGINAL_XDG_CURRENT_DESKTOP ||
    ''
  ).toLowerCase()
  return desktop.includes('gnome')
}

/**
 * Whether the Wayland provider should be used instead of get-windows.
 * Only true on a GNOME Wayland session where the extension hasn't been proven
 * unavailable.
 */
function shouldUse() {
  return isGnomeWaylandSession() && extensionAvailable !== false
}

function noteUnavailable(reason) {
  extensionAvailable = false
  const now = Date.now()
  // Throttle the warning so we don't spam logs every tracking tick.
  if (now - lastUnavailableLogAt > 60000) {
    lastUnavailableLogAt = now
    log.warn(
      `[wayland-windows] GNOME window tracker extension not reachable (${reason}). ` +
        `Active-window tracking is unavailable until "${BUS_NAME}" is installed and enabled.`
    )
  }
}

function busctlCall(method, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const child = execFile(
      'busctl',
      ['--user', '--json=short', 'call', BUS_NAME, OBJECT_PATH, INTERFACE, method],
      { timeout: timeoutMs, killSignal: 'SIGKILL' },
      (err, stdout) => {
        if (settled) return
        settled = true
        if (err) {
          resolve({ ok: false, err })
          return
        }
        try {
          const parsed = JSON.parse(stdout)
          const payload = parsed && parsed.data ? parsed.data[0] : undefined
          resolve({ ok: true, value: payload })
        } catch (e) {
          resolve({ ok: false, err: e })
        }
      }
    )
    child.on('error', (err) => {
      if (settled) return
      settled = true
      resolve({ ok: false, err })
    })
  })
}

function resolveExecutable(pid) {
  if (!pid) return 'unknown'
  try {
    return fs.readlinkSync(`/proc/${pid}/exe`)
  } catch (_e) {
    return 'unknown'
  }
}

// Reshape the extension's window object into get-windows' result shape.
// Bounds are GNOME logical pixels; on HiDPI they may not match get-windows'
// physical-pixel convention, so screen attribution can be approximate. The
// app/title fields (the point of activity tracking) are always accurate.
function toGetWindowsShape(obj) {
  if (!obj || typeof obj !== 'object') return null
  const hasIdentity = obj.title || obj.appName || obj.wmClass
  if (!hasIdentity) return null
  const pid = Number(obj.pid) || undefined
  const bounds =
    obj.bounds && typeof obj.bounds === 'object'
      ? {
          x: Number(obj.bounds.x) || 0,
          y: Number(obj.bounds.y) || 0,
          width: Number(obj.bounds.width) || 0,
          height: Number(obj.bounds.height) || 0,
        }
      : undefined
  return {
    id: obj.id,
    title: obj.title || 'Unknown',
    bounds,
    owner: {
      name: obj.appName || obj.wmClass || 'Unknown',
      path: resolveExecutable(pid),
      processId: pid,
    },
  }
}

async function getActiveWindow(timeoutMs = 400) {
  const res = await busctlCall('GetFocusedWindow', timeoutMs)
  if (!res.ok) {
    noteUnavailable(res.err && res.err.message ? res.err.message : 'call failed')
    return null
  }
  extensionAvailable = true
  let parsed
  try {
    parsed = JSON.parse(res.value)
  } catch (_e) {
    return null
  }
  return toGetWindowsShape(parsed)
}

async function getWindows(timeoutMs = 800) {
  const res = await busctlCall('GetWindows', timeoutMs)
  if (!res.ok) {
    noteUnavailable(res.err && res.err.message ? res.err.message : 'call failed')
    return []
  }
  extensionAvailable = true
  let list
  try {
    list = JSON.parse(res.value)
  } catch (_e) {
    return []
  }
  if (!Array.isArray(list)) return []
  return list.map(toGetWindowsShape).filter((w) => w !== null)
}

/**
 * One-off probe of whether the GNOME extension is installed and responding.
 * Updates the cached availability flag and returns it.
 */
async function probeAvailability(timeoutMs = 500) {
  if (!isGnomeWaylandSession()) return false
  const res = await busctlCall('GetFocusedWindow', timeoutMs)
  extensionAvailable = res.ok
  return res.ok
}

module.exports = {
  isGnomeWaylandSession,
  shouldUse,
  getActiveWindow,
  getWindows,
  probeAvailability,
}
