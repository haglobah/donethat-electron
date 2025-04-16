// Audio recorder for the renderer process
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let isRecording = false;
let chunkTimestamps = [];
let MAX_BUFFER_DURATION_MS;

/**
 * Initialize audio recorder
 * @param {Object} config Configuration
 * @param {number} config.bufferDurationMs Buffer duration in ms
 * @throws {Error} If invalid parameters
 */
window.initAudioRecorder = function(config = {}) {
  if (!config.bufferDurationMs || typeof config.bufferDurationMs !== 'number' || config.bufferDurationMs <= 0) {
    const error = new Error('Audio recorder initialization failed: bufferDurationMs is required and must be a positive number');
    console.error(error);
    throw error;
  }
  
  MAX_BUFFER_DURATION_MS = config.bufferDurationMs;
};

/**
 * Start continuous recording
 * @returns {boolean} Success status
 */
window.startAudioRecording = async function() {
  if (isRecording) {
    return true;
  }
  
  try {
    audioChunks = [];
    chunkTimestamps = [];
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000
    });
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        const now = Date.now();
        audioChunks.push(event.data);
        chunkTimestamps.push(now);
        trimAudioBuffer();
      }
    };
    
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
    };
    
    mediaRecorder.start(1000);
    recordingStartTime = Date.now();
    isRecording = true;
    
    return true;
  } catch (error) {
    console.error('Error starting audio recording:', error);
    isRecording = false;
    return false;
  }
};

/**
 * Trim audio buffer to maximum duration
 */
function trimAudioBuffer() {
  if (audioChunks.length < 2 || chunkTimestamps.length < 2) return;
  
  const now = Date.now();
  const cutoffTime = now - MAX_BUFFER_DURATION_MS;
  
  let cutoffIndex = 0;
  for (let i = 0; i < chunkTimestamps.length; i++) {
    if (chunkTimestamps[i] >= cutoffTime) {
      cutoffIndex = i;
      break;
    }
  }
  
  if (cutoffIndex > 0) {
    audioChunks = audioChunks.slice(cutoffIndex);
    chunkTimestamps = chunkTimestamps.slice(cutoffIndex);
  }
}

/**
 * Get current audio buffer
 * @returns {Promise<Object>} Audio data
 */
window.stopAudioRecording = async function() {
  if (!isRecording || !mediaRecorder) {
    return null;
  }
  
  try {
    mediaRecorder.requestData();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const oldestTimestamp = chunkTimestamps[0] || recordingStartTime;
    const duration = Date.now() - oldestTimestamp;
    
    if (audioChunks.length === 0) {
      console.warn('No audio data captured');
      return null;
    }
    
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        resolve({
          base64Data: reader.result,
          mimeType: 'audio/webm',
          timeMs: duration
        });
      };
    });
  } catch (error) {
    console.error('Error getting audio buffer:', error);
    return null;
  }
};

/**
 * Stop recording completely
 */
window.shutdownAudioRecording = function() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
    mediaRecorder = null;
    isRecording = false;
    audioChunks = [];
    chunkTimestamps = [];
  }
};

module.exports = {
  startAudioRecording: window.startAudioRecording,
  stopAudioRecording: window.stopAudioRecording,
  shutdownAudioRecording: window.shutdownAudioRecording
}; 