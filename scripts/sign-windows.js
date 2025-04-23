exports.default = async function(configuration) {
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');

    // Required environment variables
    const SM_API_KEY = process.env.SM_API_KEY;
    const SM_CLIENT_CERT_FILE = process.env.SM_CLIENT_CERT_FILE;
    const SM_CLIENT_CERT_PASSWORD = process.env.SM_CLIENT_CERT_PASSWORD;
    const SM_HOST = process.env.SM_HOST || 'https://one.digicert.com';
    const PKCS11_CONFIG = process.env.PKCS11_CONFIG || path.join(path.dirname(configuration.path), 'pkcs11properties.cfg');

    // Validate required environment variables
    if (!SM_API_KEY) throw new Error('SM_API_KEY environment variable is not set');
    if (!SM_CLIENT_CERT_FILE) throw new Error('SM_CLIENT_CERT_FILE environment variable is not set');
    if (!SM_CLIENT_CERT_PASSWORD) throw new Error('SM_CLIENT_CERT_PASSWORD environment variable is not set');

    // Create PKCS11 configuration file if it doesn't exist
    if (!fs.existsSync(PKCS11_CONFIG)) {
        const pkcs11Config = `name=signingmanager
library=C:\\Program Files\\DigiCert\\DigiCert Keylocker Tools\\smpkcs11.dll
slotListIndex=0`;
        fs.writeFileSync(PKCS11_CONFIG, pkcs11Config);
    }

    // Sign the file using jarsigner with PKCS11
    try {
        console.log('Signing file with jarsigner...');
        execSync(
            `jarsigner -keystore NONE -storepass NONE -storetype PKCS11 -sigalg SHA256withRSA -providerClass sun.security.pkcs11.SunPKCS11 -providerArg "${PKCS11_CONFIG}" -signedjar "${configuration.path}.signed" "${configuration.path}" signingmanager -tsa http://timestamp.digicert.com`,
            { stdio: 'inherit' }
        );

        // Replace original file with signed version
        fs.unlinkSync(configuration.path);
        fs.renameSync(`${configuration.path}.signed`, configuration.path);

        // Verify the signature
        console.log('Verifying signature...');
        execSync(
            `jarsigner -verify "${configuration.path}"`,
            { stdio: 'inherit' }
        );
    } catch (error) {
        console.error('Signing failed:', error);
        throw error;
    }
};