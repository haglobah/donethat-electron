import dotenv from 'dotenv';
import { notarize } from 'electron-notarize';

dotenv.config();

export default async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') {
        return;
    }

    // Skip notarization if required variables are missing
    const teamId = process.env.APPLETEAMID || process.env.APPLE_TEAM_ID;
    const appleId = process.env.APPLEID || process.env.APPLE_ID;
    const appleIdPassword = process.env.APPLEIDPASS || process.env.APPLE_ID_PASSWORD;

    if (!teamId || !appleId || !appleIdPassword) {
        console.log('Skipping notarization: missing required environment variables');
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    console.log('Notarizing app', appName);
    
    try {
        await notarize({
            tool: 'notarytool',
            verbose: true,
            teamId: teamId,
            appBundleId: 'com.donethat.app',
            appPath: `${appOutDir}/${appName}.app`,
            appleId: appleId,
            appleIdPassword: appleIdPassword,
        });
        console.log('Notarization completed successfully');
    } catch (error) {
        console.error('Notarization failed:', error);
        // Don't throw error to allow builds to continue in CI environment
        // unless we explicitly want to enforce notarization
        if (process.env.ENFORCE_NOTARIZATION === 'true') {
            throw error;
        }
    }
}