const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('electron-log');

let helperProcess = null;
let helperReady = false;
let stdoutBuffer = '';
let requestIdCounter = 0;
const pendingFlushes = new Map();

function resolveHelperPath() {
  const binaryName = 'system-audio-capture';
  const candidates = [
    path.resolve(process.cwd(), 'bin', binaryName),
    path.resolve(__dirname, '..', 'bin', binaryName),
    process.resourcesPath ? path.resolve(process.resourcesPath, 'bin', binaryName) : null,
    process.resourcesPath ? path.resolve(process.resourcesPath, 'app.asar.unpacked', 'bin', binaryName) : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return null;
}

function emitParseError(line, error) {
  log.warn('[MacSystemAudio] Failed to parse helper JSON line:', line, error && error.message);
}

function handleHelperMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'ready') {
    helperReady = true;
    return;
  }

  if (message.type === 'chunk' && message.requestId) {
    const pending = pendingFlushes.get(String(message.requestId));
    if (!pending) return;
    pendingFlushes.delete(String(message.requestId));
    pending.resolve(message);
    return;
  }

  if (message.type === 'error') {
    log.error('[MacSystemAudio] Helper error:', message);
    if (message.requestId) {
      const pending = pendingFlushes.get(String(message.requestId));
      if (pending) {
        pendingFlushes.delete(String(message.requestId));
        pending.reject(new Error(message.message || 'macOS system audio helper error'));
      }
    }
    return;
  }

  if (message.type === 'stopped') {
    helperReady = false;
    return;
  }
}

function handleStdoutChunk(chunk) {
  stdoutBuffer += chunk.toString('utf8');
  let idx = stdoutBuffer.indexOf('\n');
  while (idx >= 0) {
    const line = stdoutBuffer.slice(0, idx).trim();
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    if (line.length > 0) {
      try {
        handleHelperMessage(JSON.parse(line));
      } catch (error) {
        emitParseError(line, error);
      }
    }
    idx = stdoutBuffer.indexOf('\n');
  }
}

function failAllPending(error) {
  for (const [, pending] of pendingFlushes) {
    pending.reject(error);
  }
  pendingFlushes.clear();
}

async function start() {
  if (process.platform !== 'darwin') return false;
  if (helperProcess && helperReady) return true;
  if (helperProcess && !helperProcess.killed) return false;

  const helperPath = resolveHelperPath();
  if (!helperPath) {
    log.error('[MacSystemAudio] Helper binary not found');
    return false;
  }

  helperReady = false;
  stdoutBuffer = '';
  helperProcess = spawn(helperPath, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  helperProcess.stdout.on('data', handleStdoutChunk);
  helperProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString('utf8').trim();
    if (line) log.warn('[MacSystemAudio][stderr]', line);
  });
  helperProcess.on('exit', (code, signal) => {
    const error = new Error(`[MacSystemAudio] Helper exited (code=${code}, signal=${signal})`);
    helperReady = false;
    helperProcess = null;
    failAllPending(error);
  });

  const startDeadlineMs = Date.now() + 5000;
  while (!helperReady && helperProcess && Date.now() < startDeadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (!helperReady) {
    log.error('[MacSystemAudio] Helper did not become ready within timeout');
    return false;
  }
  return true;
}

function isRunning() {
  return !!(helperProcess && helperReady);
}

async function flushChunk() {
  if (!isRunning()) return null;
  requestIdCounter += 1;
  const requestId = String(requestIdCounter);

  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingFlushes.delete(requestId);
      reject(new Error('Timed out waiting for macOS system audio chunk'));
    }, 10000);

    pendingFlushes.set(requestId, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });

    try {
      helperProcess.stdin.write(`${JSON.stringify({ cmd: 'flush', requestId })}\n`);
    } catch (error) {
      pendingFlushes.delete(requestId);
      clearTimeout(timer);
      reject(error);
    }
  });

  if (!response || !response.path) return null;

  try {
    const buf = fs.readFileSync(response.path);
    try { fs.unlinkSync(response.path); } catch (_) {}
    if (!buf || buf.length === 0) return null;
    return {
      base64Data: buf.toString('base64'),
      mimeType: response.mimeType || 'audio/mp4',
      startMs: response.startMs || Date.now(),
      endMs: response.endMs || Date.now(),
      speechIntervals: []
    };
  } catch (error) {
    log.error('[MacSystemAudio] Failed to read chunk file:', error);
    return null;
  }
}

async function stop() {
  if (!helperProcess) return;
  try {
    helperProcess.stdin.write(`${JSON.stringify({ cmd: 'stop' })}\n`);
  } catch (_) {}

  const proc = helperProcess;
  const deadline = Date.now() + 1500;
  while (helperProcess === proc && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (helperProcess === proc) {
    try { proc.kill('SIGKILL'); } catch (_) {}
    helperProcess = null;
    helperReady = false;
  }
}

module.exports = {
  start,
  isRunning,
  flushChunk,
  stop
};
