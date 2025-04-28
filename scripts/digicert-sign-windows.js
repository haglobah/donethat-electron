const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

exports.default = async function(configuration) {
  console.log(`Starting DigiCert code signing for: ${configuration.path}`);
  
  try {
    // DigiCert tools creates this configuration file automatically
    const pkcs11ConfigPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\smtools-windows-x64\\pkcs11properties.cfg';
    
    // Log environment variables (without sensitive values)
    console.log('Checking environment variables...');
    console.log('SM_HOST exists:', !!process.env.SM_HOST);
    console.log('SM_API_KEY exists:', !!process.env.SM_API_KEY);
    console.log('SM_CLIENT_CERT_FILE exists:', !!process.env.SM_CLIENT_CERT_FILE);
    console.log('SM_CLIENT_CERT_PASSWORD exists:', !!process.env.SM_CLIENT_CERT_PASSWORD);
    console.log('SM_CODE_SIGNING_CERT_SHA1_HASH exists:', !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH);
    
    // Check if configuration path exists
    console.log('PKCS11 config file exists:', fs.existsSync(pkcs11ConfigPath));
    
    // Run the signing command
    const cmd = `smctl sign --fingerprint "${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH}" --input "${configuration.path}" --config-file "${pkcs11ConfigPath}"`;
    console.log(`Executing command: ${cmd}`);
    
    execSync(cmd, { stdio: 'inherit' });
    
    console.log(`Successfully signed: ${configuration.path}`);
    return true;
  } catch (error) {
    console.error('Error during DigiCert code signing:', error.message);
    throw error;
  }
} 