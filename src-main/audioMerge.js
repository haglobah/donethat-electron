const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const log = require('electron-log')

const execFileAsync = promisify(execFile)

let ffmpegPathCache

function getExtFromMime(mimeType) {
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (mime === 'audio/webm') return 'webm'
  if (mime === 'audio/mp4' || mime === 'audio/m4a' || mime === 'audio/x-m4a') return 'm4a'
  if (mime === 'audio/wav' || mime === 'audio/wave') return 'wav'
  if (mime === 'audio/ogg') return 'ogg'
  return 'bin'
}

function getFfmpegPath() {
  if (ffmpegPathCache !== undefined) return ffmpegPathCache
  try {
    // Optional runtime dependency; if missing, caller falls back.
    // eslint-disable-next-line global-require
    const p = require('ffmpeg-static')
    ffmpegPathCache = p || null
  } catch (_) {
    ffmpegPathCache = null
  }
  return ffmpegPathCache
}

async function mergeMicAndSystemChunks(micChunk, systemChunk) {
  if (!micChunk || !systemChunk) return null

  const ffmpegPath = getFfmpegPath()
  if (!ffmpegPath) {
    log.warn('[AudioMerge] ffmpeg-static not available, returning separate chunks')
    return null
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'donethat-audio-merge-'))
  const micIn = path.join(tmpDir, `mic.${getExtFromMime(micChunk.mimeType)}`)
  const systemIn = path.join(tmpDir, `system.${getExtFromMime(systemChunk.mimeType)}`)
  const outPath = path.join(tmpDir, 'merged.webm')

  try {
    fs.writeFileSync(micIn, Buffer.from(micChunk.base64Data, 'base64'))
    fs.writeFileSync(systemIn, Buffer.from(systemChunk.base64Data, 'base64'))

    const args = [
      '-y',
      '-i', micIn,
      '-i', systemIn,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0:duration=longest',
      '-c:a', 'libopus',
      '-b:a', '128k',
      outPath
    ]

    await execFileAsync(ffmpegPath, args)
    const out = fs.readFileSync(outPath)
    if (!out || out.length === 0) return null

    return {
      base64Data: out.toString('base64'),
      mimeType: 'audio/webm',
      startMs: Math.min(Number(micChunk.startMs || Date.now()), Number(systemChunk.startMs || Date.now())),
      endMs: Math.max(Number(micChunk.endMs || Date.now()), Number(systemChunk.endMs || Date.now())),
      speechIntervals: Array.isArray(micChunk.speechIntervals) ? micChunk.speechIntervals : []
    }
  } catch (error) {
    log.error('[AudioMerge] Failed to merge mic+system chunks:', error && error.message ? error.message : error)
    return null
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }
}

module.exports = {
  mergeMicAndSystemChunks
}
