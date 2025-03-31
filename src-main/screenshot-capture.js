const { desktopCapturer, nativeImage, screen } = require('electron')
const { execSync } = require('child_process')
const path = require('path')
const log = require('electron-log')

// Store tool and session state
let linuxScreenshotTool = null
let isWaylandSession = null

///// UTILITIES /////

// Wayland vs X11 for linux
function _checkSessionType() {
  // Check if running on Wayland
  isWaylandSession = process.env.XDG_SESSION_TYPE === 'wayland'
  log.info(`Session type: ${isWaylandSession ? 'Wayland' : 'X11'}`)
  return isWaylandSession
}

// Function to check screen capture permission
async function checkScreenCapturePermission() {
  try {
    // Linux-specific handling
    if (process.platform === 'linux') {    
      const hasPermission = await checkLinuxScreenCapturePermission()
      return hasPermission
    }
    
    // For other platforms (macOS, Windows)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 }
    })
    
    return sources && sources.length > 0
  } catch (error) {
    console.error('Error checking screen capture permission:', error)
    return false
  }
}

// Helper function to handle gnome-screenshot with animations disabled
async function takeGnomeScreenshot(outputPath) {
  // Save original animation and sound settings to restore later
  const getOriginalAnimationSetting = execSync('gsettings get org.gnome.desktop.interface enable-animations').toString().trim()
  const getOriginalSoundSetting = execSync('gsettings get org.gnome.desktop.sound event-sounds').toString().trim()

  try {
    // Disable animations and sounds
    execSync('gsettings set org.gnome.desktop.interface enable-animations false')
    execSync('gsettings set org.gnome.desktop.sound event-sounds false')
    
    // Take screenshot with gnome-screenshot
    execSync(`gnome-screenshot -f "${outputPath}"`, { timeout: 5000 })
  } finally {
    // Restore original settings (even if screenshot fails)
    execSync(`gsettings set org.gnome.desktop.interface enable-animations ${getOriginalAnimationSetting}`)
    execSync(`gsettings set org.gnome.desktop.sound event-sounds ${getOriginalSoundSetting}`)
  }
}

// Linux-specific permission checking and tool detection
async function checkLinuxScreenCapturePermission() {
  _checkSessionType() // Use the renamed internal function
  // Session type already checked by parent function
  try {
    log.info(`Checking Linux screenshot permission (Wayland: ${isWaylandSession})`)

    const fs = require('fs')
    const os = require('os')
    const tempDir = os.tmpdir()
    const testPath = path.join(tempDir, `test-screenshot-${Date.now()}.png`)
        
    // Check available tools based on the environment
    if (isWaylandSession) {
      // For Wayland, check if gnome-screenshot is available
      try {
        execSync('which gnome-screenshot', { stdio: 'ignore' })
        log.info('gnome-screenshot is available for Wayland')
        
        // Try to take a test screenshot with animations disabled
        await takeGnomeScreenshot(testPath)
        
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath)
          linuxScreenshotTool = 'gnome-screenshot'
          log.info('gnome-screenshot permission test successful')
          return true
        }
      } catch (e) {
        log.info(`gnome-screenshot not available or failed: ${e.message}`)
      }
      
      log.info('No working screenshot tool found for Wayland')
      linuxScreenshotTool = null
      return false
    } else {
      // For X11, try scrot first, then maim
      try {
        execSync('which scrot', { stdio: 'ignore' })
        log.info('scrot is available for X11')
        
        execSync(`scrot -z "${testPath}"`, { timeout: 3000 })
        
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath)
          linuxScreenshotTool = 'scrot'
          log.info('scrot permission test successful')
          return true
        }
      } catch (e) {
        log.info(`scrot not available or failed: ${e.message}`)
      }
      
      // Try maim as alternative
      try {
        execSync('which maim', { stdio: 'ignore' })
        log.info('maim is available for X11')

        execSync(`maim "${testPath}"`, { timeout: 3000 })
        
        if (fs.existsSync(testPath)) {
          fs.unlinkSync(testPath)
          linuxScreenshotTool = 'maim'
          log.info('maim permission test successful')
          return true
        }
      } catch (e) {
        log.info(`maim not available or failed: ${e.message}`)
      }
      
      log.info('No working screenshot tool found for X11')
      linuxScreenshotTool = null
      return false
    }
  } catch (error) {
    log.error('Linux screenshot permission check failed:', error)
    linuxScreenshotTool = null
    return false
  }
}

///// MAIN /////

// Use a single unified method for all platforms
async function captureAndSendScreenshot(idToken, FIREBASE_CAPTURE_URL) {
  if (!idToken) {
    log.warn('Cannot send screenshots: User not authenticated')
    return
  }

  try {
    let screenshots = []
    
    // Use Linux-specific method on Linux platforms
    if (process.platform === 'linux') {
      log.info('Using Linux-specific screenshot method')
      screenshots = await captureScreenshotsLinux()
    } else {
      // Use the standard Electron approach for other platforms
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      
      if (sources.length === 0) {
        log.warn('No screen sources found')
        return
      }      
      // Process each source
      screenshots = await Promise.all(
        sources.map(async source => {
          return await processScreenshotForUpload(source.thumbnail.toDataURL())
        })
      )
    }
    
    if (screenshots.length === 0) {
      log.warn('No screenshots captured')
      return
    }

    const fetch = await import('node-fetch').then(module => module.default)
    
    const response = await fetch(FIREBASE_CAPTURE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        timestamp: Date.now(),
        screenshots: screenshots
      })
    })
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`)
    }
    
    return true
  } catch (error) {
    log.error('Screenshot error:', error.message, error.stack)
    
    // If it's an auth error, return special value to indicate token issue
    if (error.message.includes('401') || error.message.includes('403')) {
      return { authError: true }
    }
    return false
  }
}

// Simplified Linux screenshot function using the detected tool
async function captureScreenshotsLinux() {
  try {
    // If no tool was found during permission check, abort
    if (!linuxScreenshotTool) {
      log.error('No screenshot tool available for Linux')
      return []
    }
    
    const fs = require('fs')
    const os = require('os')
    const tempDir = os.tmpdir()
    const screenshotPath = path.join(tempDir, `screenshot-${Date.now()}.png`)
    
    // Use the appropriate tool based on what was detected
    if (linuxScreenshotTool === 'gnome-screenshot') {
      // For Wayland with gnome-screenshot
      try {
        await takeGnomeScreenshot(screenshotPath)
      } catch (e) {
        log.error(`gnome-screenshot failed: ${e.message}`)
        return []
      }
    } else if (linuxScreenshotTool === 'scrot') {
      // For X11 with scrot
      try {
        execSync(`scrot -z "${screenshotPath}"`, { timeout: 5000 })
      } catch (e) {
        log.error(`scrot failed: ${e.message}`)
        return []
      }
    } else if (linuxScreenshotTool === 'maim') {
      // For X11 with maim
      try {
        execSync(`maim "${screenshotPath}"`, { timeout: 5000 })
      } catch (e) {
        log.error(`maim failed: ${e.message}`)
        return []
      }
    } else {
      log.error(`Unknown screenshot tool: ${linuxScreenshotTool}`)
      return []
    }
    
    // Process the screenshot if it was created successfully
    if (fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 0) {
      const screenshotData = fs.readFileSync(screenshotPath)
      const base64Data = `data:image/png;base64,${screenshotData.toString('base64')}`
      fs.unlinkSync(screenshotPath)
      
      // For multi-monitor setups
      if (linuxScreenshotTool === 'gnome-screenshot') {
        // Process for all displays if needed
        const displays = await getLinuxDisplays()
        
        if (displays.length <= 1) {
          // If only one display, just process the whole image
          const processedImage = await processScreenshotForUpload(base64Data)
          return [processedImage]
        } else {
          // For multiple displays, crop the image for each display
          return await cropScreenshots(
            Buffer.from(base64Data.split(',')[1], 'base64'),
            displays.map(d => d.bounds)
          )
        }
      } else {
        // For scrot and maim, just process the whole image
        const processedImage = await processScreenshotForUpload(base64Data)
        return [processedImage]
      }
    } else {
      log.error('Screenshot file was not created or is empty')
      return []
    }
  } catch (error) {
    log.error('Failed to capture Linux screenshot:', error)
    return []
  }
}

// Helper function to get Linux display information for multi-monitor setups
async function getLinuxDisplays() {
  try {
    // For X11, we can use xrandr to get display information
    if (process.env.XDG_SESSION_TYPE !== 'wayland') {
      const { execSync } = require('child_process')
      const xrandrOutput = execSync('xrandr --current').toString()
      
      // Parse the output to get display information
      const displays = []
      const displayRegex = /(\S+) connected (\d+)x(\d+)\+(\d+)\+(\d+)/g
      let match
      
      while ((match = displayRegex.exec(xrandrOutput)) !== null) {
        const [, name, width, height, x, y] = match
        displays.push({
          name,
          bounds: {
            x: parseInt(x),
            y: parseInt(y),
            width: parseInt(width),
            height: parseInt(height)
          }
        })
      }
      
      if (displays.length > 0) {
        log.info(`Found ${displays.length} displays using xrandr`)
        return displays
      }
    }
    
    // Fallback to electron's screen module
    const displays = screen.getAllDisplays().map(display => ({
      name: `Display ${display.id}`,
      bounds: display.bounds
    }))
    
    log.info(`Found ${displays.length} displays using Electron screen API`)
    return displays
  } catch (error) {
    log.error('Failed to get Linux displays:', error)
    // Default to the primary display
    const primaryDisplay = screen.getPrimaryDisplay()
    return [{
      name: 'Primary Display',
      bounds: primaryDisplay.bounds
    }]
  }
}

// Modified function to crop screenshots using Electron's nativeImage
async function cropScreenshots(imageBuffer, displays) {
  try {
    const results = []
    
    // Create nativeImage from buffer
    const fullImage = nativeImage.createFromBuffer(imageBuffer)
    
    for (const display of displays) {
      const { width, height, x, y } = display
      
      // Crop the image for this display
      const croppedImage = fullImage.crop({ x, y, width, height })
      
      // Convert to data URL
      const dataUrl = croppedImage.toDataURL()
      
      // Process the cropped screenshot
      const processedImage = await processScreenshotForUpload(dataUrl)
      results.push(processedImage)
    }
    
    return results
  } catch (error) {
    log.error('Error cropping screenshots:', error)
    // Fall back to processing the full image
    const dataUrl = nativeImage.createFromBuffer(imageBuffer).toDataURL()
    const processedImage = await processScreenshotForUpload(dataUrl)
    return [processedImage]
  }
}

// Simplified function to process screenshots using only Electron's nativeImage
async function processScreenshotForUpload(dataUrl) {
  try {
    // Convert data URL to buffer
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    
    // Create native image from buffer
    let img = nativeImage.createFromBuffer(buffer)
    
    // Get original dimensions
    const { width, height } = img.getSize()
    
    // Calculate new dimensions with 819px constraint on shorter edge
    let newWidth = width
    let newHeight = height
    const targetShortEdge = 819
    
    if (width < height) {
      // Width is shorter
      if (width > targetShortEdge) {
        const aspectRatio = height / width
        newWidth = targetShortEdge
        newHeight = Math.round(newWidth * aspectRatio)
      }
    } else {
      // Height is shorter
      if (height > targetShortEdge) {
        const aspectRatio = width / height
        newHeight = targetShortEdge
        newWidth = Math.round(newHeight * aspectRatio)
      }
    }
    
    // Resize image if needed
    if (newWidth !== width || newHeight !== height) {
      img = img.resize({ width: newWidth, height: newHeight })
    }
    
    // Convert to JPEG with 70% quality
    const jpegOptions = { quality: 70 }
    const jpegBuffer = img.toJPEG(jpegOptions.quality)
    
    // Convert back to data URL
    return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`
  } catch (error) {
    console.error('Error processing screenshot:', error)
    // Return original as fallback
    return dataUrl
  }
}

module.exports = {
  captureAndSendScreenshot,
  checkScreenCapturePermission,
  getWaylandStatus: () => isWaylandSession
} 