import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { verifyMacPackage } from './macos-package.ts';

const execute = promisify(execFile);

test('macOS package gate rejects unsealed, tampered and mismatched identities using real codesign', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fielora-signature-gate-'));
  const app = path.join(root, 'Fielora.app');
  const contents = path.join(app, 'Contents');
  const core = path.join(contents, 'Resources', 'fielora-core');
  const resource = path.join(contents, 'Resources', 'app.asar');
  const sign = (target: string, identifier?: string) => execute('/usr/bin/codesign', [
    '--force', '--sign', '-', '--timestamp=none', ...(identifier ? ['--identifier', identifier] : []), target,
  ]);
  try {
    await mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await mkdir(path.dirname(core));
    await copyFile('/usr/bin/true', path.join(contents, 'MacOS', 'Fielora'));
    await copyFile('/usr/bin/true', core);
    await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.fielora.desktop</string>
<key>CFBundleExecutable</key><string>Fielora</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    await writeFile(resource, 'test resource');
    await assert.rejects(verifyMacPackage(app), 'An executable signature cannot certify a newly packaged bundle');
    await sign(core);
    await sign(app);
    await verifyMacPackage(app);

    await writeFile(resource, 'modified resource');
    await assert.rejects(verifyMacPackage(app), 'Modified resources must prevent promotion');
    await sign(app);
    await verifyMacPackage(app);

    await execute('/usr/bin/codesign', ['--remove-signature', core]);
    await sign(app);
    await assert.rejects(verifyMacPackage(app), 'An outer seal cannot hide an unsigned Core');
    await sign(core);
    await sign(app, 'Electron');
    await assert.rejects(verifyMacPackage(app), /signing identity does not match/, 'A valid signature with the wrong identity must be rejected');
    await sign(app, 'com.fielora.desktop');
    await verifyMacPackage(app);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
