const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const log = require('electron-log');

const SAFE_STORAGE_PREFIX = 'safe:';
const SAFE_STORAGE_RETRY_ATTEMPTS = 3;
const SAFE_STORAGE_RETRY_DELAY_MS = 75;

// Use a combination of machine-specific and app-specific data for the encryption key
function deriveEncryptionKey() {
  const machineId = require('os').hostname();
  const appPath = app.getPath('userData');
  const salt = 'donethat-gemini-key-v1'; // Version the salt for future updates
  
  // Create a deterministic key from machine-specific data
  const keyMaterial = `${machineId}:${appPath}:${salt}`;
  return crypto.createHash('sha256').update(keyMaterial).digest();
}

function getEncryptionScheme(value) {
  if (typeof value !== 'string') return 'unknown';
  if (value.startsWith(SAFE_STORAGE_PREFIX)) return 'safe';
  if (/^[0-9a-f]+:[0-9a-f]+$/i.test(value)) return 'legacy';
  return 'unknown';
}

function isLegacyEncryptedData(value) {
  return getEncryptionScheme(value) === 'legacy';
}

function encryptLegacyData(data) {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return iv.toString('hex') + ':' + encrypted;
}

function decryptLegacyData(encryptedData) {
  const key = deriveEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 2) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

function decryptSafeStorageData(encryptedData) {
  const payload = encryptedData.slice(SAFE_STORAGE_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(payload, 'base64'));
}

function decryptDataInternal(encryptedData) {
  const scheme = getEncryptionScheme(encryptedData);

  if (scheme === 'safe') {
    return decryptSafeStorageData(encryptedData);
  }

  if (scheme === 'legacy') {
    return decryptLegacyData(encryptedData);
  }

  throw new Error('Invalid encrypted data format');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Encrypt data
function encryptData(data) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(data);
      return SAFE_STORAGE_PREFIX + encrypted.toString('base64');
    }

    return encryptLegacyData(data);
  } catch (error) {
    log.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

// Decrypt data
function decryptData(encryptedData) {
  try {
    return decryptDataInternal(encryptedData);
  } catch (error) {
    log.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

async function decryptDataWithRetry(encryptedData, options = {}) {
  const scheme = getEncryptionScheme(encryptedData);
  if (scheme !== 'safe') {
    return decryptData(encryptedData);
  }

  const attempts = Number.isInteger(options.attempts) ? options.attempts : SAFE_STORAGE_RETRY_ATTEMPTS;
  const delayMs = Number.isInteger(options.delayMs) ? options.delayMs : SAFE_STORAGE_RETRY_DELAY_MS;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return decryptDataInternal(encryptedData);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  log.error('Decryption failed after retries:', lastError);
  throw new Error('Failed to decrypt data');
}

module.exports = {
  encryptData,
  decryptData,
  decryptDataWithRetry,
  isLegacyEncryptedData
};
