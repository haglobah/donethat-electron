#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const packageInfo = require('../package.json');
const { version, name } = packageInfo;
const productName = packageInfo.build.productName;

// Find the file to sign
console.log('Starting Windows code signing process...');
console.log('Looking for binary in release directory...');

const releaseDir = path.resolve(__dirname, '..', 'release');
console.log(`Searching in directory: ${releaseDir}`);

// List the contents of the release directory
let files = [];
try {
  files = fs.readdirSync(releaseDir);
  console.log('Files in release directory:', files);
} catch (dirError) {
  console.error('Error reading release directory:', dirError);
}

// Try to find the built exe in various potential locations
let appFilePath = '';
const possibleLocations = [
  path.join(releaseDir, `${productName}-x64.exe`), // Main artifact
  path.join(releaseDir, `${productName}-arm64.exe`), // ARM artifact
  path.join(releaseDir, 'win-unpacked', `${productName}.exe`), // Unpacked dir
  path.join(releaseDir, 'win-x64-unpacked', `${productName}.exe`), // x64 unpacked dir
  path.join(releaseDir, 'win-arm64-unpacked', `${productName}.exe`) // ARM unpacked dir
];

console.log('Checking possible file locations:');
for (const location of possibleLocations) {
  console.log(`- Checking: ${location}`);
  if (fs.existsSync(location)) {
    appFilePath = location;
    console.log(`✓ Found binary at: ${appFilePath}`);
    break;
  }
}

if (!appFilePath) {
  console.error('Could not find the application binary to sign!');
  process.exit(1);
}

async function signApp() {
  console.log(`Will sign file: ${appFilePath}`);
  
  // Set default keypair alias if not provided in env
  const keypairAlias = process.env.SM_KEY_ALIAS || 'key_1263271287';
  console.log(`Using keypair alias: ${keypairAlias}`);
  
  // Get DigiCert tools directory - typically installed at this location
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const digicertToolsDir = path.join(programFiles, 'DigiCert', 'DigiCert One Signing Manager Tools');
  
  // Check if the directory exists
  if (!fs.existsSync(digicertToolsDir)) {
    throw new Error(`DigiCert One Signing Manager Tools not found at: ${digicertToolsDir}`);
  }
  
  console.log(`Found DigiCert tools at: ${digicertToolsDir}`);
  
  // Path to smctl.exe
  const smctlPath = path.join(digicertToolsDir, 'smctl.exe');
  if (!fs.existsSync(smctlPath)) {
    throw new Error(`SMCTL not found at: ${smctlPath}`);
  }
  
  // Check required environment variables
  const requiredEnvVars = ['SM_CLIENT_CERT_FILE_B64'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
  }

  // Display environment for debugging
  console.log('Environment variables:');
  if (process.env.SM_CODE_SIGNING_CERT_SHA1_HASH) {
    console.log(`- SM_CODE_SIGNING_CERT_SHA1_HASH: ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH.substring(0, 8)}...`);
  }
  console.log(`- SM_CLIENT_CERT_FILE_B64 length: ${process.env.SM_CLIENT_CERT_FILE_B64?.length || 0} chars`);

  // Create a temporary working directory
  const tempDir = path.join(os.tmpdir(), 'donethat-signing-' + Date.now());
  console.log(`Creating temporary directory: ${tempDir}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  try {
    // Create certificate file from base64
    console.log('Creating certificate file from base64...');
    const certPath = path.join(tempDir, 'Certificate_pkcs12.p12');
    const certBuffer = Buffer.from(process.env.SM_CLIENT_CERT_FILE_B64, 'base64');
    fs.writeFileSync(certPath, certBuffer);
    console.log(`Certificate file created at: ${certPath}`);
    
    // Set client cert environment variable
    process.env.SM_CLIENT_CERT_FILE = certPath;
    process.env.SM_CLIENT_CERT_PASSWORD = process.env.SM_CLIENT_CERT_PASSWORD || '';
    
    // Create PKCS11 configuration file if needed
    const pkcs11ConfigPath = path.join(tempDir, 'pkcs11properties.cfg');
    console.log('Creating PKCS11 configuration file...');
    
    // Create basic PKCS11 config file
    const pkcs11Config = `
library=${path.join(digicertToolsDir, 'smpkcs11.dll')}
name=DigiCertSM
`;
    fs.writeFileSync(pkcs11ConfigPath, pkcs11Config);
    console.log(`PKCS11 configuration file created at: ${pkcs11ConfigPath}`);
    
    // Try different signing approaches
    let success = false;
    let lastError = null;
    
    // First, try to sync certificates (Windows only)
    try {
      console.log('Syncing certificates to Windows certificate store...');
      const syncCommand = `"${smctlPath}" windows certsync --keypair-alias=${keypairAlias}`;
      console.log(`Executing: ${syncCommand}`);
      
      const syncResult = execSync(syncCommand, {
        encoding: 'utf8',
        timeout: 60000
      });
      
      console.log('Certificate sync result:', syncResult);
    } catch (syncError) {
      console.error('Warning: Certificate sync failed:', syncError.message);
      console.log('Continuing with signing attempt...');
    }
    
    // Attempt 1: Sign with keypair alias (preferred method according to docs)
    try {
      console.log('Attempt 1: Signing with keypair alias...');
      const signCommand = `"${smctlPath}" sign --keypair-alias ${keypairAlias} --input "${appFilePath}"`;
      console.log(`Executing: ${signCommand}`);
      
      const result = execSync(signCommand, {
        encoding: 'utf8',
        timeout: 300000
      });
      
      console.log('Sign command output:', result);
      success = true;
    } catch (error) {
      console.error('Signing with keypair alias failed:', error.message);
      lastError = error;
      
      // Attempt 2: Sign with keypair alias and config file
      try {
        console.log('Attempt 2: Signing with keypair alias and config file...');
        const signCommand = `"${smctlPath}" sign --keypair-alias ${keypairAlias} --input "${appFilePath}" --config-file "${pkcs11ConfigPath}"`;
        console.log(`Executing: ${signCommand}`);
        
        const result = execSync(signCommand, {
          encoding: 'utf8',
          timeout: 300000
        });
        
        console.log('Sign command output:', result);
        success = true;
      } catch (configError) {
        console.error('Signing with keypair alias and config file failed:', configError.message);
        lastError = configError;
        
        // Attempt 3: Use certificate fingerprint if available
        if (process.env.SM_CODE_SIGNING_CERT_SHA1_HASH) {
          try {
            console.log('Attempt 3: Signing with certificate fingerprint...');
            const signCommand = `"${smctlPath}" sign --fingerprint ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH} --input "${appFilePath}"`;
            console.log(`Executing: ${signCommand}`);
            
            const result = execSync(signCommand, {
              encoding: 'utf8',
              timeout: 300000
            });
            
            console.log('Sign command output:', result);
            success = true;
          } catch (fingerprintError) {
            console.error('Signing with certificate fingerprint failed:', fingerprintError.message);
            lastError = fingerprintError;
            
            // Attempt 4: Use certificate fingerprint with config file
            try {
              console.log('Attempt 4: Signing with certificate fingerprint and config file...');
              const signCommand = `"${smctlPath}" sign --fingerprint ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH} --input "${appFilePath}" --config-file "${pkcs11ConfigPath}"`;
              console.log(`Executing: ${signCommand}`);
              
              const result = execSync(signCommand, {
                encoding: 'utf8',
                timeout: 300000
              });
              
              console.log('Sign command output:', result);
              success = true;
            } catch (finalError) {
              console.error('Signing with certificate fingerprint and config file failed:', finalError.message);
              lastError = finalError;
            }
          }
        }
      }
    }
    
    if (!success) {
      throw new Error(`All signing approaches failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    
    // Verify the signature
    try {
      console.log('Verifying signature...');
      const verifyCommand = `"${smctlPath}" sign verify --input "${appFilePath}"`;
      console.log(`Executing: ${verifyCommand}`);
      
      const verifyResult = execSync(verifyCommand, {
        encoding: 'utf8',
        timeout: 60000
      });
      
      console.log('Verification result:', verifyResult);
    } catch (verifyError) {
      console.warn('Warning: Signature verification failed:', verifyError.message);
      console.log('This does not necessarily mean the signing failed.');
    }
    
    console.log(`✅ Signing successful!`);
    return true;
  } catch (error) {
    console.error('Error during signing process:', error);
    throw error;
  } finally {
    // Clean up
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary directory: ${tempDir}`);
    } catch (cleanupError) {
      console.warn('Warning: Failed to clean up temp directory:', cleanupError);
    }
  }
}

// Execute the signing process
signApp()
  .then(() => {
    console.log('✅ Code signing completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Code signing failed:', error);
    process.exit(1);
  });