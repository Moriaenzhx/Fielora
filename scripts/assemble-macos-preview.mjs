// Bounded recovery for unreliable large local uploads. The fixed digests are
// from the signed, locally-tested archives at product commit 9790077c5eaa524.
// GITHUB_TOKEN stays in the process environment; downloaded bytes are not run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = 'Moriaenzhx/Fielora';
const tag = 'v0.1.0-preview.20261007';
const prefix = 'macos-upload-9790077-';
const expected = [
  { ext: 'dmg', size: 148528316, count: 36, sha: 'ff3cb920e20a5298e4ab307efe62b5be7f026c0573de74f019741354e1c0f1c0' },
  { ext: 'zip', size: 131669510, count: 32, sha: 'c5cc4ccf5d06a552dc47aa315880eb136bf406848f733977b9152acc7356d25c' },
];
assert.equal(process.env.GITHUB_REPOSITORY, repo);
assert.ok(process.env.RUNNER_TEMP);
const work = path.join(process.env.RUNNER_TEMP, 'fielora-preview-parts');
mkdirSync(work, { recursive: true });
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
// Draft releases are addressed by ID: tag lookup can hide drafts from the
// Actions installation token even when contents:write can read the draft ID.
const releaseId = 405373624;
const getRelease = () => JSON.parse(gh('api', `repos/${repo}/releases/${releaseId}`));
const release = getRelease();
assert.equal(release.tag_name, tag);
assert.equal(release.draft, true, 'Never replace an already-public release');
assert.equal(release.prerelease, true);
const temporary = release.assets.filter(a => /^macos-upload-9790077-(dmg|zip)\.part\d{4}$/.test(a.name));
assert.equal(temporary.length, 68, 'All parts must be present before assembly');
for (const item of expected) {
  for (let index = 0; index < item.count; index++) {
    const name = `${prefix}${item.ext}.part${String(index).padStart(4, '0')}`;
    const part = temporary.find(a => a.name === name);
    assert.equal(part?.state, 'uploaded', name);
    assert.equal(part.size, Math.min(4 * 1024 * 1024, item.size - index * 4 * 1024 * 1024), name);
  }
}
for (const asset of temporary) {
  const bytes = execFileSync('gh', ['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`], { maxBuffer: 6 * 1024 * 1024 });
  assert.equal(bytes.length, asset.size);
  writeFileSync(path.join(work, asset.name), bytes);
}
const assembled = [];
for (const item of expected) {
  const destination = path.join(work, `Fielora-0.1.0-preview.20261007-macos-arm64.${item.ext}`);
  const hash = createHash('sha256');
  let size = 0;
  writeFileSync(destination, '');
  for (let index = 0; index < item.count; index++) {
    const name = `${prefix}${item.ext}.part${String(index).padStart(4, '0')}`;
    const bytes = readFileSync(path.join(work, name));
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, temporary.find(a => a.name === name).digest);
    hash.update(bytes);
    size += bytes.length;
    appendFileSync(destination, bytes);
  }
  assert.equal(size, item.size);
  assert.equal(hash.digest('hex'), item.sha, 'Must match the locally-tested archive byte-for-byte');
  assembled.push(destination);
  console.log(`ASSEMBLED_VERIFIED ${path.basename(destination)}`);
}
assert.equal(getRelease().draft, true);
for (const file of assembled) {
  const existing = getRelease().assets.find(a => a.name === path.basename(file));
  const expectedHash = `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
  if (existing) {
    assert.equal(existing.digest, expectedHash, 'Never replace different release content');
    continue;
  }
  const response = JSON.parse(gh('api', '--method', 'POST', '-H', 'Content-Type: application/octet-stream', '--input', file, `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${path.basename(file)}`));
  assert.equal(response.digest, expectedHash);
}
const uploaded = getRelease();
for (const item of expected) {
  const asset = uploaded.assets.find(a => a.name === `Fielora-0.1.0-preview.20261007-macos-arm64.${item.ext}`);
  assert.equal(asset?.state, 'uploaded');
  assert.equal(asset.size, item.size);
  assert.equal(asset.digest, `sha256:${item.sha}`);
}
// These are exact IDs of the temporary parts created for this draft upload.
for (const asset of temporary) gh('api', '--method', 'DELETE', `repos/${repo}/releases/assets/${asset.id}`);
console.log('PREVIEW_ASSETS_READY: draft retained for final publication check');
