const { desktopCapturer, nativeImage, screen, BrowserWindow } = require('electron');
const log = require('electron-log');

/**
 * Captures a screenshot of the display containing the focused window
 * @param {BrowserWindow} mainWindow - The main application window (used as fallback)
 * @returns {Promise<string|null>} - Data URL of the screenshot or null on error
 */
async function captureFeedbackScreenshot(mainWindow) {
  try {
    // Get all screen sources
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    
    if (sources.length === 0) {
      log.warn('No screen sources found for feedback screenshot');
      return null;
    }
    
    // Determine which display the focused window is on
    let targetSource = sources[0]; // Default to first
    
    // Get the focused window (main window)
    const focusedWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    
    if (focusedWindow) {
      const windowBounds = focusedWindow.getBounds();
      const windowCenterX = windowBounds.x + windowBounds.width / 2;
      const windowCenterY = windowBounds.y + windowBounds.height / 2;
      
      // Get all displays
      const displays = screen.getAllDisplays();
      
      // Find which display contains the window center
      const activeDisplay = displays.find(display => {
        const { x, y, width, height } = display.bounds;
        return windowCenterX >= x && windowCenterX < x + width &&
               windowCenterY >= y && windowCenterY < y + height;
      });
      
      if (activeDisplay) {
        // Try to match the display with a source
        // Sources are typically in the same order as displays, but we'll try to match by index
        const displayIndex = displays.indexOf(activeDisplay);
        if (displayIndex >= 0 && displayIndex < sources.length) {
          targetSource = sources[displayIndex];
        }
      }
    }
    
    // Convert thumbnail to data URL
    const dataUrl = targetSource.thumbnail.toDataURL();
    
    // Process the screenshot (compress and optimize)
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    let img = nativeImage.createFromBuffer(buffer);
    
    // Get original dimensions
    const { width, height } = img.getSize();
    
    // Calculate new dimensions with 819px constraint on shorter edge
    let newWidth = width;
    let newHeight = height;
    const targetShortEdge = 819;
    
    if (width < height) {
      if (width > targetShortEdge) {
        const aspectRatio = height / width;
        newWidth = targetShortEdge;
        newHeight = Math.round(newWidth * aspectRatio);
      }
    } else {
      if (height > targetShortEdge) {
        const aspectRatio = width / height;
        newHeight = targetShortEdge;
        newWidth = Math.round(newHeight * aspectRatio);
      }
    }
    
    // Resize image if needed
    if (newWidth !== width || newHeight !== height) {
      img = img.resize({ width: newWidth, height: newHeight });
    }
    
    // Convert to JPEG with 70% quality
    const jpegBuffer = img.toJPEG(70);
    const processedDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    
    return processedDataUrl;
  } catch (error) {
    log.error('[Feedback] Error capturing screenshot:', error);
    return null;
  }
}

module.exports = {
  captureFeedbackScreenshot
};

