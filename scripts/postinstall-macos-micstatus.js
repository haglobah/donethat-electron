#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'inherit', env: process.env });
  } catch (err) {
    console.error(`Error running command: ${cmd}`, err);
    process.exit(1);
  }
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('[postinstall-macos-micstatus] Non-macOS platform, skipping.');
    return;
  }

  console.log('[postinstall-macos-micstatus] Building Swift mic-monitor helper...');

  const sourcePath = path.join(process.cwd(), 'src-os/macos/active-mic.swift');
  const outputDir = path.join(process.cwd(), 'bin');
  const outputPath = path.join(outputDir, 'mic-monitor');
  const moduleCacheDir = path.join(process.cwd(), '.build/module-cache');

  if (!fs.existsSync(sourcePath)) {
    console.error(`[postinstall-macos-micstatus] Error: source file not found: ${sourcePath}`);
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(moduleCacheDir, { recursive: true });

  run(`xcrun swiftc -O -module-cache-path "${moduleCacheDir}" -framework CoreAudio -framework Foundation -framework AppKit "${sourcePath}" -o "${outputPath}"`);
  run(`chmod +x "${outputPath}"`);
  console.log(`[postinstall-macos-micstatus] Swift mic-monitor helper built: ${outputPath}`);
}

main();
