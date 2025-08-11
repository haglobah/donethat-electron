const log = require('electron-log')
const { ipcMain } = require('electron')
const voiceToText = require('./voiceToText')

// Variables to track audio capture
let isRecording = false
let mainWindow = null

/**
 * Initialize audio capture module
 * @param {BrowserWindow} window Main window
 * @param {Object} config Configuration
 * @param {number} config.bufferDurationMs Buffer duration in ms
 * @throws {Error} If parameters invalid
 */
function initialize(window, config = {}) {
  if (!window) {
    throw new Error('Audio capture initialization failed: window is required');
  }
  
  if (!config.bufferDurationMs || typeof config.bufferDurationMs !== 'number' || config.bufferDurationMs <= 0) {
    throw new Error('Audio capture initialization failed: bufferDurationMs is required and must be a positive number');
  }
  
  mainWindow = window;
  
  // Set up IPC handlers
  ipcMain.handle('audio-capture-result', async (event, audioData) => {
    return await processAudioFromRenderer(audioData);
  });
  
  // Listen for audio device changes from renderer
  ipcMain.on('audio-device-changed', (event, info) => {
    log.info('Audio device change detected:', info);
    // No need to do anything here - renderer handles the restart
  });
  
  // Initialize the renderer-side audio recorder with configuration
  mainWindow.webContents.executeJavaScript(
    `window.initAudioRecorder && window.initAudioRecorder({
      bufferDurationMs: ${config.bufferDurationMs}
    });`
  ).catch(error => {
    log.error('Error initializing audio recorder in renderer:', error);
    throw error; // Re-throw to propagate the error
  });
}

/**
 * Process audio data from renderer
 * @param {Object} audioData Audio data
 * @returns {Promise<{transcript: string}>} Audio processing result
 */
async function processAudioFromRenderer(audioData) {
  try {
    // Convert base64 to buffer for transcription
    const audioBuffer = Buffer.from(audioData.base64Data.split(',')[1], 'base64');
    
    // Transcribe audio locally
    const transcript = await voiceToText.transcribeAudioBuffer(audioBuffer);
    
    return {
      transcript
    };
  } catch (error) {
    log.error('Error processing audio from renderer:', error);
    return null;
  }
}

/**
 * Check microphone permission
 * @returns {Promise<boolean>} Permission status
 */
async function checkPermission() {
  // We'll use the renderer to check permissions
  if (!mainWindow) return false;
  
  try {
    return await mainWindow.webContents.executeJavaScript(
      `new Promise(resolve => {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            // Immediately stop all tracks to release the microphone
            const tracks = stream.getTracks();
            tracks.forEach(track => {
              if (track.kind === 'audio') {
                track.stop();
              }
            });
            // Make sure all tracks are stopped before resolving
            setTimeout(() => resolve(true), 100);
          })
          .catch(err => {
            console.error("Microphone permission denied:", err);
            resolve(false);
          });
      })`
    );
  } catch (error) {
    log.error('Error checking audio permission:', error);
    return false;
  }
}

/**
 * Start continuous recording
 * @returns {Promise<boolean>} Success status
 */
async function startRecording() {
  if (isRecording) {
    return true;
  }
  
  if (!mainWindow) {
    log.error('Cannot start audio recording: main window not initialized');
    return false;
  }
  
  try {
    // Ask renderer to start continuous recording
    const started = await mainWindow.webContents.executeJavaScript(
      `window.startAudioRecording && window.startAudioRecording();`
    );
    
    if (!started) {
      log.error('Failed to start audio recording in renderer');
      return false;
    }
    
    // Update recording state
    isRecording = true;
    
    return true;
  } catch (error) {
    log.error('Error starting audio recording:', error);
    return false;
  }
}

/**
 * Get current buffer without stopping recording
 * @returns {Promise<{filePath: string, duration: number} | null>} Recording info
 */
async function stopRecording() {
  if (!isRecording) {
    log.warn('No audio recording in progress');
    return null;
  }
  
  try {
    if (!mainWindow) {
      log.error('Cannot get audio buffer: main window not initialized');
      return null;
    }
    
    // Ask renderer to provide the current buffer without stopping recording
    const audioData = await mainWindow.webContents.executeJavaScript(
      'window.stopAudioRecording && window.stopAudioRecording();'
    );
    
    if (!audioData) {
      log.warn('No audio data received from renderer');
      return null;
    }
    
    // Process audio data for transcription
    const audioResult = audioData ? await processAudioFromRenderer(audioData) : null;
    
    if (!audioResult) {
      log.warn('Failed to process audio data from renderer');
      return null;
    }    
    // Return recording information
    return {
      transcript: audioResult.transcript,
      duration: audioData.timeMs
    };
  } catch (error) {
    log.error('Error retrieving audio buffer:', error);
    return null;
  }
}

/**
 * Stop recording completely when shutting down
 * @returns {Promise<boolean>} Success status
 */
async function shutdownRecording() {
  if (!isRecording) {
    return true;
  }
  
  try {
    if (!mainWindow) {
      log.warn('Cannot shut down recording: main window not initialized');
      isRecording = false;
      return true;
    }
    
    // Ask renderer to completely stop recording
    await mainWindow.webContents.executeJavaScript(
      'window.shutdownAudioRecording && window.shutdownAudioRecording();'
    );
    
    isRecording = false;
    return true;
  } catch (error) {
    log.error('Error shutting down audio recording:', error);
    isRecording = false;
    return false;
  }
}

/**
 * Get recording status
 * @returns {Object} Status object
 */
function getStatus() {
  return {
    recording: isRecording,
    voiceToTextAvailable: voiceToText.getStatus().available
  };
}

module.exports = {
  initialize,
  checkPermission,
  startRecording,
  stopRecording,
  shutdownRecording,
  getStatus,
} 