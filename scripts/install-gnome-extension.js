#!/usr/bin/env node
// Installs and enables the DoneThat Window Tracker GNOME Shell extension into
// the current user's profile, so active-window tracking works on GNOME Wayland.
//
// Usage: node scripts/install-gnome-extension.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UUID = 'donethat-window-tracker@donethat.ai';
const sourceDir = path.join(__dirname, '..', 'resources', 'gnome-extension', UUID);
const destDir = path.join(
  os.homedir(),
  '.local',
  'share',
  'gnome-shell',
  'extensions',
  UUID
);

if (!fs.existsSync(sourceDir)) {
  console.error(`[install-gnome-extension] Source not found: ${sourceDir}`);
  process.exit(1);
}

try {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(sourceDir, destDir, { recursive: true });
  console.log(`[install-gnome-extension] Installed to ${destDir}`);
} catch (err) {
  console.error('[install-gnome-extension] Failed to copy extension:', err.message);
  process.exit(1);
}

try {
  execFileSync('gnome-extensions', ['enable', UUID], { stdio: 'inherit' });
  console.log(`[install-gnome-extension] Enabled ${UUID}`);
} catch (_err) {
  console.warn(
    `[install-gnome-extension] Could not auto-enable. Run: gnome-extensions enable ${UUID}`
  );
}

console.log(
  '\nLog out and back in (Wayland sessions cannot hot-reload GNOME Shell) for the extension to take effect.'
);
