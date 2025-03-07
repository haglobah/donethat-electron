import dotenv from 'dotenv';
import { notarize } from 'electron-notarize';

dotenv.config();

export default async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;
    if (electronPlatformName !== 'darwin') {
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    console.log('Notarizing app', appName);
    
    try {
        await notarize({
            tool: 'notarytool',
            verbose: true,
            teamId: process.env.APPLETEAMID,
            appBundleId: 'com.donethat.app',
            appPath: `${appOutDir}/${appName}.app`,
            appleId: process.env.APPLEID,
            appleIdPassword: process.env.APPLEIDPASS,
        });
        console.log('Notarization completed successfully');
    } catch (error) {
        console.error('Notarization failed:', error);
        throw error;
    }
}