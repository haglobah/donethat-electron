const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper function to get last N lines of output
function getLastNLines(output, n = 20) {
  if (!output) return '';
  const lines = output.split('\n');
  return lines.slice(-n).join('\n');
}

exports.default = async function(configuration) {
  try {
    // DigiCert tools creates this configuration file automatically
    const pkcs11ConfigPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\smtools-windows-x64\\pkcs11properties.cfg';
    const smctlLogPath = 'C:\\Users\\RUNNER~1\\.signingmanager\\logs\\smctl.log';
    
    if (!process.env.SM_KEYPAIR_ALIAS) {
      throw new Error('Build failed: SM_KEYPAIR_ALIAS environment variable is not set');
    }

    // Sign with keypair alias
    try {
      const cmd = `smctl sign --keypair-alias ${process.env.SM_KEYPAIR_ALIAS} --input "${configuration.path}" --config-file "${pkcs11ConfigPath}"`;
      const output = execSync(cmd, { encoding: 'utf8' });
      
      if (output.includes('FAILED')) {
        throw new Error('Signing failed - output indicates failure');
      }
    } catch (signingError) {
      console.error('Signing failed:', signingError.message);
      if (signingError.stderr) console.error('Signing stderr:', signingError.stderr);
      
      // Read and log SMCTL log file if it exists
      if (fs.existsSync(smctlLogPath)) {
        try {
          const logContent = fs.readFileSync(smctlLogPath, 'utf8');
          console.error('SMCTL log file contents (last 20 lines):\n', getLastNLines(logContent));
        } catch (logError) {
          console.error('Failed to read SMCTL log file:', logError.message);
        }
      }
      
      throw new Error('Build failed: Signing failed');
    }
    
    // Verify the signature
    try {
      const verifyCmd = `smctl sign verify --input "${configuration.path}"`;
      const verifyOutput = execSync(verifyCmd, { encoding: 'utf8' });
      
      if (verifyOutput.includes('FAILED') || verifyOutput.includes('No signature found')) {
        throw new Error('Signature verification failed');
      }
    } catch (verifyError) {
      console.error('Verification failed:', verifyError.message);
      if (verifyError.stderr) console.error('Verify stderr:', verifyError.stderr);
      
      // Read and log SMCTL log file if it exists
      if (fs.existsSync(smctlLogPath)) {
        try {
          const logContent = fs.readFileSync(smctlLogPath, 'utf8');
          console.error('SMCTL log file contents (last 20 lines):\n', getLastNLines(logContent));
        } catch (logError) {
          console.error('Failed to read SMCTL log file:', logError.message);
        }
      }
      
      throw new Error('Build failed: Signature verification failed');
    }
    
    return true;
  } catch (error) {
    throw error; // Re-throw the error to ensure the pipeline fails
  }
} 