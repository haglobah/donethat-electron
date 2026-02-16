const log = require('electron-log')
const { Jimp } = require('jimp')
const windowsCapture = require('./captureWindows')
const { convertBoundsToDIP } = windowsCapture

const GRAY = 0x808080ff

/**
 * Calculate visible region of a window (not covered by windows on top)
 * Assumes allWindows is already sorted by z-order (topmost first)
 * @param {Object} window Window to check
 * @param {Array} allWindows All windows (already sorted: activity windows, then excluded no-activity, then non-excluded no-activity)
 * @param {Object} screenBounds Screen bounds in DIP
 * @param {Object} display Electron display object (for scale factor conversion)
 * @returns {Array} Array of rectangles [{x, y, width, height}] relative to screenBounds
 */
function calculateVisibleRegion(window, allWindows, screenBounds, display) {
  if (!window.bounds) {
    return []
  }

  const windowBoundsDIP = convertBoundsToDIP(window.bounds, display)
  const windowRect = {
    x: windowBoundsDIP.x,
    y: windowBoundsDIP.y,
    width: windowBoundsDIP.width,
    height: windowBoundsDIP.height
  }

  const clampedRect = {
    x: Math.max(windowRect.x, screenBounds.x),
    y: Math.max(windowRect.y, screenBounds.y),
    width: Math.min(windowRect.x + windowRect.width, screenBounds.x + screenBounds.width) - Math.max(windowRect.x, screenBounds.x),
    height: Math.min(windowRect.y + windowRect.height, screenBounds.y + screenBounds.height) - Math.max(windowRect.y, screenBounds.y)
  }

  if (clampedRect.width <= 0 || clampedRect.height <= 0) {
    return []
  }

  const windowIndex = allWindows.indexOf(window)
  if (windowIndex === -1) {
    return [{
      x: clampedRect.x - screenBounds.x,
      y: clampedRect.y - screenBounds.y,
      width: clampedRect.width,
      height: clampedRect.height
    }]
  }

  const topWindows = allWindows.slice(0, windowIndex)
  let visibleRegions = [clampedRect]

  for (const topWindow of topWindows) {
    if (!topWindow.bounds) continue
    const topBoundsDIP = convertBoundsToDIP(topWindow.bounds, display)
    const topRect = {
      x: topBoundsDIP.x,
      y: topBoundsDIP.y,
      width: topBoundsDIP.width,
      height: topBoundsDIP.height
    }
    const noOverlap = topRect.x + topRect.width <= clampedRect.x ||
        topRect.x >= clampedRect.x + clampedRect.width ||
        topRect.y + topRect.height <= clampedRect.y ||
        topRect.y >= clampedRect.y + clampedRect.height
    if (noOverlap) continue

    const overlapX = Math.max(topRect.x, clampedRect.x)
    const overlapY = Math.max(topRect.y, clampedRect.y)
    const overlapWidth = Math.min(topRect.x + topRect.width, clampedRect.x + clampedRect.width) - overlapX
    const overlapHeight = Math.min(topRect.y + topRect.height, clampedRect.y + clampedRect.height) - overlapY
    if (overlapWidth <= 0 || overlapHeight <= 0) continue

    const newVisibleRegions = []
    for (const region of visibleRegions) {
      if (overlapX + overlapWidth <= region.x ||
          overlapX >= region.x + region.width ||
          overlapY + overlapHeight <= region.y ||
          overlapY >= region.y + region.height) {
        newVisibleRegions.push(region)
        continue
      }
      if (region.y < overlapY) {
        const topRegion = { x: region.x, y: region.y, width: region.width, height: overlapY - region.y }
        if (topRegion.width > 0 && topRegion.height > 0) newVisibleRegions.push(topRegion)
      }
      if (region.y + region.height > overlapY + overlapHeight) {
        const bottomRegion = { x: region.x, y: overlapY + overlapHeight, width: region.width, height: (region.y + region.height) - (overlapY + overlapHeight) }
        if (bottomRegion.width > 0 && bottomRegion.height > 0) newVisibleRegions.push(bottomRegion)
      }
      if (region.x < overlapX) {
        const leftRegion = {
          x: region.x,
          y: Math.max(region.y, overlapY),
          width: overlapX - region.x,
          height: Math.min(region.y + region.height, overlapY + overlapHeight) - Math.max(region.y, overlapY)
        }
        if (leftRegion.width > 0 && leftRegion.height > 0) newVisibleRegions.push(leftRegion)
      }
      if (region.x + region.width > overlapX + overlapWidth) {
        const rightRegion = {
          x: overlapX + overlapWidth,
          y: Math.max(region.y, overlapY),
          width: (region.x + region.width) - (overlapX + overlapWidth),
          height: Math.min(region.y + region.height, overlapY + overlapHeight) - Math.max(region.y, overlapY)
        }
        if (rightRegion.width > 0 && rightRegion.height > 0) newVisibleRegions.push(rightRegion)
      }
    }
    visibleRegions = newVisibleRegions
  }

  const finalRegions = visibleRegions
    .filter(r => r.width > 0 && r.height > 0)
    .map(r => ({
      x: r.x - screenBounds.x,
      y: r.y - screenBounds.y,
      width: r.width,
      height: r.height
    }))

  if (finalRegions.length === 0) return []
  return finalRegions
}

/**
 * Apply mask regions to an image (grays out specified areas)
 * @param {string} imageDataUrl Image as data URL
 * @param {Array} maskRegions Array of rectangles [{x, y, width, height}]
 * @param {Object} screenBounds Screen bounds with width and height
 * @returns {Promise<string>} Masked image as data URL
 */
async function applyMaskToImage(imageDataUrl, maskRegions, screenBounds) {
  try {
    if (!maskRegions || maskRegions.length === 0) return imageDataUrl
    if (!screenBounds?.width || !screenBounds?.height) return imageDataUrl
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const img = await Jimp.read(buffer)
    const imageWidth = img.bitmap.width
    const imageHeight = img.bitmap.height
    const scaleX = imageWidth / screenBounds.width
    const scaleY = imageHeight / screenBounds.height

    for (const region of maskRegions) {
      const x = Math.round(region.x * scaleX)
      const y = Math.round(region.y * scaleY)
      const regionWidth = Math.round(region.width * scaleX)
      const regionHeight = Math.round(region.height * scaleY)
      const clampedX = Math.max(0, Math.min(x, imageWidth - 1))
      const clampedY = Math.max(0, Math.min(y, imageHeight - 1))
      const clampedWidth = Math.max(1, Math.min(regionWidth, imageWidth - clampedX))
      const clampedHeight = Math.max(1, Math.min(regionHeight, imageHeight - clampedY))
      if (clampedWidth <= 0 || clampedHeight <= 0) continue
      const grayRect = new Jimp({ width: clampedWidth, height: clampedHeight, color: GRAY })
      img.composite(grayRect, clampedX, clampedY, { mode: 'srcOver' })
    }
    const maskedBuffer = await img.getBuffer('image/jpeg', { quality: 70 })
    return `data:image/jpeg;base64,${maskedBuffer.toString('base64')}`
  } catch (error) {
    log.error('Error in applyMaskToImage:', error)
    return imageDataUrl
  }
}

/**
 * Crop a region (or bounding box of multiple regions) from an image
 * @param {string} imageDataUrl Image as data URL
 * @param {Array} regions Array of rectangles [{x, y, width, height}] in screen coordinates
 * @param {Object} screenBounds Screen bounds with width and height
 * @param {number} maxWidth Optional maximum width for the cropped image
 * @returns {Promise<string|null>} Cropped image as data URL, or null on failure
 */
async function cropRegionFromImage(imageDataUrl, regions, screenBounds, maxWidth) {
  try {
    if (!regions || regions.length === 0) return null
    if (!screenBounds?.width || !screenBounds?.height) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const r of regions) {
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.width)
      maxY = Math.max(maxY, r.y + r.height)
    }
    const bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    if (bbox.width <= 0 || bbox.height <= 0) return null

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const img = await Jimp.read(buffer)
    const imageWidth = img.bitmap.width
    const imageHeight = img.bitmap.height
    const scaleX = imageWidth / screenBounds.width
    const scaleY = imageHeight / screenBounds.height

    const x = Math.round(bbox.x * scaleX)
    const y = Math.round(bbox.y * scaleY)
    const w = Math.round(bbox.width * scaleX)
    const h = Math.round(bbox.height * scaleY)
    const clampedX = Math.max(0, Math.min(x, imageWidth - 1))
    const clampedY = Math.max(0, Math.min(y, imageHeight - 1))
    const clampedW = Math.max(1, Math.min(w, imageWidth - clampedX))
    const clampedH = Math.max(1, Math.min(h, imageHeight - clampedY))

    const cropped = img.clone().crop({ x: clampedX, y: clampedY, w: clampedW, h: clampedH })
    
    // Resize if maxWidth is provided and image is larger
    if (maxWidth && cropped.bitmap.width > maxWidth) {
      cropped.resize({ w: maxWidth })
    }

    const jpegBuffer = await cropped.getBuffer('image/jpeg', { quality: 70 })
    return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`
  } catch (error) {
    log.error('Error in cropRegionFromImage:', error)
    return null
  }
}

module.exports = {
  calculateVisibleRegion,
  applyMaskToImage,
  cropRegionFromImage
}
