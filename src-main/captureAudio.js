const { execSync, spawn } = require('child_process')
const log = require('electron-log')
const os = require('os')
const fs = require('fs')
const path = require('path')

// Variables to track audio capture
let isRecording = false
let micRecordingProcess = null
let sysAudioRecordingProcess = null
let audioFilePath = null
let sysAudioFilePath = null
let startTime = null
let recordingTimerId = null

/**
 * Mix two audio files into one using ffmpeg
 * @param {string} micAudioPath Path to microphone audio file
 * @param {string} sysAudioPath Path to system audio file
 * @returns {Promise<string|null>} Path to mixed audio file or null if failed
 */
async function mixAudioFiles(micAudioPath, sysAudioPath) {
  if (!micAudioPath && !sysAudioPath) {
    return null
  }
  
  // If we only have one file, just return that path
  if (!micAudioPath) return sysAudioPath
  if (!sysAudioPath) return micAudioPath
  
  try {
    // Create output file path
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
    const outputDir = path.dirname(micAudioPath)
    const outputPath = path.join(outputDir, `mixed_audio_${timestamp}.wav`)
    
    // Mix audio files using ffmpeg
    return new Promise((resolve, reject) => {
      const ffmpegArgs = [
        // Input files
        '-i', micAudioPath,
        '-i', sysAudioPath,
        // Filter to mix both inputs with volume adjustment
        '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2',
        // Output format
        '-c:a', 'pcm_s16le',
        // Overwrite existing file
        '-y',
        outputPath
      ]
      
      log.info(`Mixing audio files: ${micAudioPath} and ${sysAudioPath}`)
      
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs)
      
      // Handle process completion
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          log.info(`Successfully mixed audio to: ${outputPath}`)
          // Delete original files after successful mix
          try {
            fs.unlinkSync(micAudioPath)
            fs.unlinkSync(sysAudioPath)
          } catch (err) {
            log.warn('Failed to delete original audio files after mixing:', err)
          }
          resolve(outputPath)
        } else {
          log.error(`Audio mixing failed with code: ${code}`)
          // Return one of the original files if mixing fails
          resolve(micAudioPath)
        }
      })
      
      ffmpegProcess.on('error', (err) => {
        log.error('Error during audio mixing:', err)
        // Return one of the original files if mixing fails
        resolve(micAudioPath)
      })
    })
  } catch (error) {
    log.error('Error mixing audio files:', error)
    // Return one of the original files if an exception occurs
    return micAudioPath
  }
}

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
    
    // Create unique filenames
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
    audioFilePath = path.join(outputDir, `mic_recording_${timestamp}.wav`)
    sysAudioFilePath = path.join(outputDir, `sys_recording_${timestamp}.wav`)
    
    // Start recording based on platform
    if (process.platform === 'darwin') {
      // macOS: Use ffmpeg
      // For microphone on macOS
      try {
        micRecordingProcess = require('child_process').spawn('ffmpeg', [
          '-f', 'avfoundation',
          '-i', ':0', // Use default audio input device
          '-c:a', 'pcm_s16le',
          '-ar', sampleRate,
          '-ac', channels,
          audioFilePath
        ], {
          detached: true,
          stdio: 'ignore'
        })
        micRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start microphone recording on macOS:', error)
      }
      
      // For system audio on macOS using BlackHole or similar audio routing
      try {
        sysAudioRecordingProcess = require('child_process').spawn('ffmpeg', [
          '-f', 'avfoundation',
          '-i', '1:0', // This might need adjustment based on device numbering
          '-c:a', 'pcm_s16le',
          '-ar', sampleRate,
          '-ac', channels,
          sysAudioFilePath
        ], {
          detached: true,
          stdio: 'ignore'
        })
        sysAudioRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start system audio recording on macOS:', error)
      }
    } else if (process.platform === 'win32') {
      // Windows: Use PowerShell to execute ffmpeg
      // For microphone on Windows
      try {
        const micCommand = `Start-Process -NoNewWindow -FilePath 'ffmpeg' -ArgumentList '-f dshow -i audio=\\"default\\" -c:a pcm_s16le -ar ${sampleRate} -ac ${channels} "${audioFilePath}"'`
        
        micRecordingProcess = require('child_process').spawn('powershell', [
          '-Command',
          micCommand
        ], {
          detached: true,
          stdio: 'ignore'
        })
        micRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start microphone recording on Windows:', error)
      }
      
      // For system audio on Windows using loopback capture
      try {
        const sysCommand = `Start-Process -NoNewWindow -FilePath 'ffmpeg' -ArgumentList '-f dshow -i audio=\\"virtual-audio-capturer\\" -c:a pcm_s16le -ar ${sampleRate} -ac ${channels} "${sysAudioFilePath}"'`
        
        sysAudioRecordingProcess = require('child_process').spawn('powershell', [
          '-Command',
          sysCommand
        ], {
          detached: true,
          stdio: 'ignore'
        })
        sysAudioRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start system audio recording on Windows:', error)
      }
    } else if (process.platform === 'linux') {
      // Linux: Use arecord for mic and pacat for system audio
      // For microphone on Linux
      try {
        micRecordingProcess = require('child_process').spawn('arecord', [
          '-f', 'S16_LE',
          '-c', channels,
          '-r', sampleRate,
          '-d', Math.ceil(maxDuration / 1000), // Convert ms to seconds
          audioFilePath
        ], {
          detached: true,
          stdio: 'ignore'
        })
        micRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start microphone recording on Linux:', error)
      }
      
      // For system audio on Linux using PulseAudio
      try {
        sysAudioRecordingProcess = require('child_process').spawn('bash', [
          '-c',
          `pacat --record --device=@DEFAULT_MONITOR@ | sox -t raw -r 44100 -e signed -b 16 -c 2 - "${sysAudioFilePath}" trim 0 ${Math.ceil(maxDuration / 1000)}`
        ], {
          detached: true,
          stdio: 'ignore'
        })
        sysAudioRecordingProcess.unref()
      } catch (error) {
        log.error('Failed to start system audio recording on Linux:', error)
      }
    } else {
      log.error('Unsupported platform for audio recording')
      return false
    }
    
    // Track recording state
    startTime = Date.now()
    isRecording = true
    
    // Set a timer to stop recording after maxDuration
    recordingTimerId = setTimeout(() => {
      stopRecording().catch(error => {
        log.error('Error stopping recording after timeout:', error)
      })
    }, maxDuration)
    
    log.info(`Started audio recording (microphone and system)`)
    return true
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
    
    // Different stop methods based on platform and recording type
    if (micRecordingProcess) {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        micRecordingProcess.kill('SIGTERM')
      }
      micRecordingProcess = null
    }
    
    if (sysAudioRecordingProcess) {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        sysAudioRecordingProcess.kill('SIGTERM')
      }
      sysAudioRecordingProcess = null
    }
    
    if (process.platform === 'win32') {
      // Windows: We need to find and kill the ffmpeg process
      try {
        execSync('taskkill /f /im ffmpeg.exe', { stdio: 'ignore' })
      } catch (killError) {
        log.warn('Could not kill ffmpeg process, may have already ended:', killError)
      }
    }
    
    // Calculate recording duration
    const endTime = Date.now()
    const duration = endTime - startTime
    
    // Reset state
    isRecording = false
    
    // Verify files exist and have content
    let micFileValid = false
    let sysFileValid = false
    let micFilePath = null
    let sysFilePath = null
    
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      const stats = fs.statSync(audioFilePath)
      micFileValid = stats.size > 0
      
      if (micFileValid) {
        micFilePath = audioFilePath
      } else {
        log.warn(`Microphone audio file is empty: ${audioFilePath}`)
        fs.unlinkSync(audioFilePath)
      }
    }
    
    if (sysAudioFilePath && fs.existsSync(sysAudioFilePath)) {
      const stats = fs.statSync(sysAudioFilePath)
      sysFileValid = stats.size > 0
      
      if (sysFileValid) {
        sysFilePath = sysAudioFilePath
      } else {
        log.warn(`System audio file is empty: ${sysAudioFilePath}`)
        fs.unlinkSync(sysAudioFilePath)
      }
    }
    
    log.info(`Finished audio recording, duration: ${duration}ms`)
    
    // Mix the audio files if both are valid
    let mixedFilePath = null
    if (micFileValid || sysFileValid) {
      try {
        mixedFilePath = await mixAudioFiles(micFilePath, sysFilePath)
      } catch (mixError) {
        log.error('Error mixing audio files:', mixError)
        // Keep original mic file if mixing fails
        mixedFilePath = micFilePath
      }
      
      // Return recording information with just one file
      return {
        filePath: mixedFilePath,
        duration
      }
    } else {
      log.warn('No valid audio files created during recording')
      return null
    }
  } catch (error) {
    log.error('Error stopping audio recording:', error)
    return null
  } finally {
    // Always reset state
    startTime = null
    audioFilePath = null
    sysAudioFilePath = null
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