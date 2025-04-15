const { execSync } = require('child_process')
const log = require('electron-log')
const os = require('os')
const fs = require('fs')
const path = require('path')

// Variables to track audio capture
let isRecording = false
let recordingProcess = null
let audioFilePath = null
let startTime = null
let recordingTimerId = null

/**
 * Check if the application has permission to record audio
 * @returns {Promise<boolean>} True if permission is granted
 */
async function checkPermission() {
  try {
    if (process.platform === 'darwin') {
      // macOS: Check for microphone permissions
      try {
        // Attempt to get a list of audio devices - this will fail if no permission
        execSync('osascript -e "set devs to input volume of (get volume settings)"', { stdio: 'ignore' })
        return true
      } catch (error) {
        log.error('Audio capture permission check failed on macOS:', error)
        return false
      }
    } else if (process.platform === 'win32') {
      // Windows: No direct permission check available
      // Best effort - check if we can access audio devices
      try {
        const script = `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SystemInformation]::TerminalServerSession
        `
        execSync(`powershell -Command "${script}"`, { stdio: 'ignore' })
        return true
      } catch (error) {
        log.error('Audio capture permission check failed on Windows:', error)
        return false
      }
    } else if (process.platform === 'linux') {
      // Linux: Check for audio device access
      try {
        execSync('arecord -L', { stdio: 'ignore' })
        return true
      } catch (error) {
        log.error('Audio capture permission check failed on Linux:', error)
        return false
      }
    }
    
    return false
  } catch (error) {
    log.error('Error checking audio capture permission:', error)
    return false
  }
}

/**
 * Start recording audio
 * @param {Object} options Recording options
 * @param {string} options.outputDir Directory to save recordings (default: os.tmpdir())
 * @param {number} options.maxDurationMs Maximum recording duration in ms (default: 5 minutes)
 * @param {number} options.sampleRate Sample rate in Hz (default: 44100)
 * @param {number} options.channels Number of channels (default: 1)
 * @returns {Promise<boolean>} True if recording started successfully
 */
async function startRecording(options = {}) {
  if (isRecording) {
    log.warn('Audio recording already in progress')
    return false
  }
  
  try {
    // Set up recording parameters
    const outputDir = options.outputDir || os.tmpdir()
    const maxDuration = options.maxDurationMs || 5 * 60 * 1000 // 5 minutes default
    const sampleRate = options.sampleRate || 44100
    const channels = options.channels || 1
    
    // Create unique filename
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
    audioFilePath = path.join(outputDir, `audio_recording_${timestamp}.wav`)
    
    // Start recording based on platform
    if (process.platform === 'darwin') {
      // macOS: Use sox or avfoundation
      try {
        // Try to use sox first
        try {
          recordingProcess = require('child_process').spawn('sox', [
            '-d', // Use default audio device
            '-c', channels,
            '-r', sampleRate,
            audioFilePath
          ], {
            detached: true,
            stdio: 'ignore'
          })
        } catch (soxError) {
          // Fallback to ffmpeg
          recordingProcess = require('child_process').spawn('ffmpeg', [
            '-f', 'avfoundation',
            '-i', ':0', // Use default audio device
            '-c:a', 'pcm_s16le',
            '-ar', sampleRate,
            '-ac', channels,
            audioFilePath
          ], {
            detached: true,
            stdio: 'ignore'
          })
        }
      } catch (error) {
        log.error('Failed to start audio recording on macOS:', error)
        return false
      }
    } else if (process.platform === 'win32') {
      // Windows: Use PowerShell to execute ffmpeg
      try {
        const command = `Start-Process -NoNewWindow -FilePath 'ffmpeg' -ArgumentList '-f dshow -i audio=\\"default\\" -c:a pcm_s16le -ar ${sampleRate} -ac ${channels} "${audioFilePath}"'`
        
        recordingProcess = require('child_process').spawn('powershell', [
          '-Command',
          command
        ], {
          detached: true,
          stdio: 'ignore'
        })
      } catch (error) {
        log.error('Failed to start audio recording on Windows:', error)
        return false
      }
    } else if (process.platform === 'linux') {
      // Linux: Use arecord
      try {
        recordingProcess = require('child_process').spawn('arecord', [
          '-f', 'S16_LE',
          '-c', channels,
          '-r', sampleRate,
          '-d', Math.ceil(maxDuration / 1000), // Convert ms to seconds
          audioFilePath
        ], {
          detached: true,
          stdio: 'ignore'
        })
      } catch (error) {
        log.error('Failed to start audio recording on Linux:', error)
        return false
      }
    } else {
      log.error('Unsupported platform for audio recording')
      return false
    }
    
    // Setup process event handlers
    if (recordingProcess) {
      recordingProcess.unref() // Don't wait for this process
      
      startTime = Date.now()
      isRecording = true
      
      // Set a timer to stop recording after maxDuration
      recordingTimerId = setTimeout(() => {
        stopRecording().catch(error => {
          log.error('Error stopping recording after timeout:', error)
        })
      }, maxDuration)
      
      log.info(`Started audio recording to ${audioFilePath}`)
      return true
    }
    
    return false
  } catch (error) {
    log.error('Error starting audio recording:', error)
    return false
  }
}

/**
 * Stop the current audio recording
 * @returns {Promise<{filePath: string, duration: number} | null>} Recording info or null if failed
 */
async function stopRecording() {
  if (!isRecording) {
    return null
  }
  
  try {
    // Clear any existing timer
    if (recordingTimerId) {
      clearTimeout(recordingTimerId)
      recordingTimerId = null
    }
    
    // Different stop methods based on platform
    if (recordingProcess) {
      // Default approach: kill the process
      if (process.platform === 'darwin') {
        recordingProcess.kill('SIGTERM')
      } else if (process.platform === 'win32') {
        // Windows: We need to find and kill the ffmpeg process
        try {
          execSync('taskkill /f /im ffmpeg.exe', { stdio: 'ignore' })
        } catch (killError) {
          log.warn('Could not kill ffmpeg process, may have already ended:', killError)
        }
      } else {
        recordingProcess.kill('SIGTERM')
      }
      
      recordingProcess = null
    }
    
    // Calculate recording duration
    const endTime = Date.now()
    const duration = endTime - startTime
    
    // Reset state
    isRecording = false
    
    // Verify file exists and has content
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      const stats = fs.statSync(audioFilePath)
      
      if (stats.size > 0) {
        log.info(`Finished audio recording: ${audioFilePath}, duration: ${duration}ms`)
        
        // Return recording information
        return {
          filePath: audioFilePath,
          duration
        }
      } else {
        log.warn(`Audio file is empty: ${audioFilePath}`)
        fs.unlinkSync(audioFilePath) // Delete empty file
        return null
      }
    } else {
      log.warn('Audio file does not exist after recording')
      return null
    }
  } catch (error) {
    log.error('Error stopping audio recording:', error)
    return null
  } finally {
    // Always reset state
    startTime = null
    audioFilePath = null
    isRecording = false
  }
}

/**
 * Get the current recording status
 * @returns {Object} Status object with recording info
 */
function getStatus() {
  if (!isRecording) {
    return {
      recording: false
    }
  }
  
  // Calculate current duration
  const currentTime = Date.now()
  const duration = currentTime - startTime
  
  return {
    recording: true,
    filePath: audioFilePath,
    duration,
    startTime
  }
}

/**
 * Convert an audio file to text using platform-specific tools
 * Note: This requires external services or tools to be installed
 * @param {string} audioFilePath Path to the audio file
 * @param {Object} options Transcription options
 * @param {string} options.language Language code (default: 'en-US')
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio(audioFilePath, options = {}) {
  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    throw new Error('Invalid audio file path')
  }
  
  const language = options.language || 'en-US'
  
  try {
    // This is a placeholder for actual transcription
    // In a real implementation, you would:
    // 1. Send the audio to a service like Google Speech-to-Text, AWS Transcribe, etc.
    // 2. Or use a local library like Vosk
    
    log.info(`Transcription would process: ${audioFilePath} in language ${language}`)
    
    // Placeholder implementation - replace with actual transcription
    return `[Transcription not implemented - would process ${path.basename(audioFilePath)}]`
  } catch (error) {
    log.error('Error transcribing audio:', error)
    throw error
  }
}

module.exports = {
  checkPermission,
  startRecording,
  stopRecording,
  getStatus,
  transcribeAudio
} 