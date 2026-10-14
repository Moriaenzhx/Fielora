import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ForgeConfig } from '@electron-forge/shared-types';

const execute = promisify(execFile);
const bundleId = 'com.fielora.desktop';
// Packager 18 handles continueOnError before calling osx-sign; Forge 7's
// narrower public type omits that Packager option.
type SigningOptions = Exclude<NonNullable<ForgeConfig['packagerConfig']>['osxSign'], boolean | undefined> & { continueOnError: false };

// Local development only. This seals the final bundle, but does not establish
// Developer ID trust, notarization or an OS privacy grant. Do not replace the
// generated designated requirement with an identifier-only requirement.
export const macDevelopmentSigning: SigningOptions = {
  identity: '-',
  identityValidation: false, // '-' intentionally uses no certificate or keychain.
  continueOnError: false,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  optionsForFile: () => ({
    // Preserve the existing local-development runtime; do not grant device,
    // private TCC, debugging or library-validation exceptions to every binary.
    hardenedRuntime: false,
    entitlements: [],
    timestamp: 'none',
  }),
};

export async function verifyMacPackage(appPath: string): Promise<void> {
  const options = { encoding: 'utf8' as const, timeout: 60_000, maxBuffer: 1024 * 1024 };
  const contents = path.join(appPath, 'Contents');
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], options);
  // Core is currently an extraResource. Check its own code signature as well
  // as the enclosing resource seal; an outer signature alone is insufficient.
  await execute('/usr/bin/codesign', ['--verify', '--strict', path.join(contents, 'Resources', 'fielora-core')], options);
  const plist = await execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(contents, 'Info.plist')], options);
  const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=2', appPath], options);
  const signingId = /^Identifier=(.+)$/m.exec(signature.stderr)?.[1];
  if (plist.stdout.trim() !== bundleId || signingId !== bundleId) {
    throw new Error('Fielora macOS package signing identity does not match its bundle identifier');
  }
}
