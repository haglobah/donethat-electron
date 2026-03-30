#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

function runGit(args, options = {}) {
  const result = execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
  return typeof result === 'string' ? result.trim() : '';
}

function tryRunGit(args) {
  try {
    return runGit(args);
  } catch (error) {
    return null;
  }
}

function getPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version || typeof packageJson.version !== 'string') {
    throw new Error('package.json version is missing or invalid.');
  }
  return packageJson.version.trim();
}

function getTargetVersion() {
  const targetVersion = getPackageVersion();
  if (!targetVersion) {
    throw new Error('Release version is empty.');
  }
  return targetVersion;
}

function resolveRefCommit(ref) {
  const value = tryRunGit(['rev-parse', `${ref}^{}`]);
  return value || null;
}

function resolveRemoteTagCommit(tagName) {
  const output = tryRunGit(['ls-remote', 'origin', `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`]);
  if (!output) return null;

  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const peeledLine = lines.find(line => line.endsWith(`refs/tags/${tagName}^{}`));
  const directLine = lines.find(line => line.endsWith(`refs/tags/${tagName}`));
  const selectedLine = peeledLine || directLine;

  if (!selectedLine) return null;
  return selectedLine.split(/\s+/)[0] || null;
}

function ensureLocalTagMatches(tagName, currentCommit) {
  const localCommit = resolveRefCommit(tagName);
  if (!localCommit) {
    const message = `Release ${tagName}`;
    runGit(['tag', '-a', tagName, currentCommit, '-m', message]);
    console.log(`Created local tag ${tagName} at ${currentCommit}.`);
    return;
  }

  if (localCommit !== currentCommit) {
    throw new Error(`Local tag ${tagName} points to ${localCommit}, expected ${currentCommit}.`);
  }
}

function pushTag(tagName, currentCommit) {
  try {
    runGit(['push', 'origin', `refs/tags/${tagName}`], { stdio: 'inherit' });
    console.log(`Pushed tag ${tagName} to origin.`);
    return;
  } catch (error) {
    const remoteCommit = resolveRemoteTagCommit(tagName);
    if (remoteCommit === currentCommit) {
      console.log(`Tag ${tagName} was created concurrently on origin; continuing.`);
      return;
    }
    throw error;
  }
}

function main() {
  const targetVersion = getTargetVersion();
  const tagName = `v${targetVersion}`;
  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const remoteCommit = resolveRemoteTagCommit(tagName);

  if (remoteCommit) {
    if (remoteCommit !== currentCommit) {
      throw new Error(`Remote tag ${tagName} points to ${remoteCommit}, expected ${currentCommit}.`);
    }
    console.log(`Remote tag ${tagName} already points to ${currentCommit}.`);
    return;
  }

  ensureLocalTagMatches(tagName, currentCommit);
  pushTag(tagName, currentCommit);
}

try {
  main();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.error(`ensure-release-tag failed: ${message}`);
  process.exit(1);
}
