const log = require('electron-log')
const windowsCapture = require('./captureWindows')
const { shouldExcludeWindow } = windowsCapture
const { screen } = require('electron')
const { calculateVisibleRegion, applyMaskToImage } = require('./windowRegionUtils')

/**
 * Mask excluded apps from screenshots (internal function with all parameters)
 * @param {Array} screenshots Array of screenshot data URLs
 * @param {Array} excludedApps Array of exclusion rules [{appName, titlePattern}]
 * @param {Array} windowData Array of window info with bounds, screen, app name, title (already sorted by z-order)
 * @param {Array} displayBounds Array of display bounds from screen.getAllDisplays()
 * @returns {Promise<Array>} Masked screenshots array
 */
async function maskExcludedApps(screenshots, excludedApps, windowData, displayBounds) {
  try {
    if (!excludedApps || excludedApps.length === 0) return screenshots
    if (!windowData || windowData.length === 0) return screenshots
    if (!displayBounds || displayBounds.length === 0) return screenshots

    const isMergedScreenshot = screenshots.length === 1 && displayBounds.length > 1

    if (isMergedScreenshot) {
      const screenshot = screenshots[0]
      const minX = Math.min(...displayBounds.map(d => d.bounds.x))
      const minY = Math.min(...displayBounds.map(d => d.bounds.y))
      const maxX = Math.max(...displayBounds.map(d => d.bounds.x + d.bounds.width))
      const maxY = Math.max(...displayBounds.map(d => d.bounds.y + d.bounds.height))
      const mergedBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

      const excludedWindows = windowData.filter(window => {
        if (!window.bounds || window.screen === undefined) return false
        return shouldExcludeWindow(window, excludedApps)
      })
      if (excludedWindows.length === 0) return screenshots

      const isSameWindow = (w1, w2) => {
        if (!w1.bounds || !w2.bounds) return false
        return w1.appName === w2.appName &&
               w1.bounds.x === w2.bounds.x &&
               w1.bounds.y === w2.bounds.y &&
               w1.bounds.width === w2.bounds.width &&
               w1.bounds.height === w2.bounds.height
      }
      const windowsWithActivity = windowData.filter(w => w.hasActivity === true)
      const excludedNoActivity = windowData.filter(w =>
        w.hasActivity !== true && excludedWindows.some(ex => isSameWindow(ex, w))
      )
      const nonExcludedNoActivity = windowData.filter(w =>
        w.hasActivity !== true && !excludedWindows.some(ex => isSameWindow(ex, w))
      )
      const reorderedWindows = [...windowsWithActivity, ...excludedNoActivity, ...nonExcludedNoActivity]

      const primaryDisplay = displayBounds.find(d => d.id === screen.getPrimaryDisplay().id) || displayBounds[0]
      const allMaskRegions = []
      for (const excludedWindow of excludedWindows) {
        const windowDisplay = excludedWindow.screen !== undefined && displayBounds[excludedWindow.screen]
          ? displayBounds[excludedWindow.screen]
          : primaryDisplay
        const regions = calculateVisibleRegion(excludedWindow, reorderedWindows, mergedBounds, windowDisplay)
        allMaskRegions.push(...regions)
      }
      if (allMaskRegions.length > 0) {
        const maskedImage = await applyMaskToImage(screenshot, allMaskRegions, mergedBounds)
        return [maskedImage]
      }
      return screenshots
    }

    const maskedScreenshots = []
    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i]
      const display = displayBounds[i]
      if (!display || !display.bounds) {
        maskedScreenshots.push(screenshot)
        continue
      }
      const screenBounds = display.bounds
      const windowsOnScreen = windowData.filter(window => {
        if (!window.bounds || window.screen === undefined) return false
        return window.screen === i
      })
      const excludedWindows = windowsOnScreen.filter(window => shouldExcludeWindow(window, excludedApps))
      if (excludedWindows.length === 0) {
        maskedScreenshots.push(screenshot)
        continue
      }
      const isSameWindow = (w1, w2) => {
        if (!w1.bounds || !w2.bounds) return false
        return w1.appName === w2.appName &&
               w1.bounds.x === w2.bounds.x &&
               w1.bounds.y === w2.bounds.y &&
               w1.bounds.width === w2.bounds.width &&
               w1.bounds.height === w2.bounds.height
      }
      const windowsWithActivity = windowsOnScreen.filter(w => w.hasActivity === true)
      const excludedNoActivity = windowsOnScreen.filter(w =>
        w.hasActivity !== true && excludedWindows.some(ex => isSameWindow(ex, w))
      )
      const nonExcludedNoActivity = windowsOnScreen.filter(w =>
        w.hasActivity !== true && !excludedWindows.some(ex => isSameWindow(ex, w))
      )
      const reorderedWindows = [...windowsWithActivity, ...excludedNoActivity, ...nonExcludedNoActivity]
      const allMaskRegions = []
      for (const excludedWindow of excludedWindows) {
        const regions = calculateVisibleRegion(excludedWindow, reorderedWindows, screenBounds, display)
        allMaskRegions.push(...regions)
      }
      if (allMaskRegions.length > 0) {
        const maskedImage = await applyMaskToImage(screenshot, allMaskRegions, screenBounds)
        maskedScreenshots.push(maskedImage)
      } else {
        maskedScreenshots.push(screenshot)
      }
    }
    return maskedScreenshots
  } catch (error) {
    log.error('Error masking excluded apps:', error)
    return screenshots
  }
}

/**
 * Apply app exclusions to screenshots (public API)
 * Handles loading exclusions from store, gathering window data, and applying masks
 * @param {Array} screenshots Array of screenshot data URLs
 * @returns {Promise<Array>} Masked screenshots array (or original if no exclusions or error)
 */
async function applyAppExclusions(screenshots) {
  try {
    if (!screenshots || screenshots.length === 0) return screenshots

    const { default: Store } = await import('electron-store')
    const { app } = require('electron')
    const store = new Store({ name: 'donethat-config', cwd: app.getPath('userData') })
    const exclusions = store.get('appExclusions') || []
    if (!exclusions || exclusions.length === 0) return screenshots

    const windowData = await windowsCapture.getAllVisibleWindows()
    const displayBounds = screen.getAllDisplays()
    if (!windowData || windowData.length === 0 || !displayBounds || displayBounds.length === 0) {
      return screenshots
    }

    return await maskExcludedApps(screenshots, exclusions, windowData, displayBounds)
  } catch (error) {
    log.error('Error applying app exclusions:', error)
    return screenshots
  }
}

module.exports = {
  applyAppExclusions
}
