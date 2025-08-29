const crypto = require('crypto');
const { app } = require('electron');
const log = require('electron-log');

// Use a combination of machine-specific and app-specific data for the encryption key
function deriveEncryptionKey() {
  const machineId = require('os').hostname();
  const appPath = app.getPath('userData');
  const salt = 'donethat-gemini-key-v1'; // Version the salt for future updates
  
  // Create a deterministic key from machine-specific data
  const keyMaterial = `${machineId}:${appPath}:${salt}`;
  return crypto.createHash('sha256').update(keyMaterial).digest();
}

// Encrypt data
function encryptData(data) {
  try {
    const key = deriveEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data as hex string
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    log.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

// Decrypt data
function decryptData(encryptedData) {
  try {
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
  } catch (error) {
    log.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

module.exports = {
  encryptData,
  decryptData
};
