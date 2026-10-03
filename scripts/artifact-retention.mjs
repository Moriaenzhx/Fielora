import { lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MARKER_FILE = '.fielora-retention.json';
const MARKER_KEYS = new Set(['version', 'kind', 'createdAt', 'status']);
const DELETABLE_KINDS = new Set(['development-package', 'portable-temporary']);
const DEFAULT_KEEP = 1;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function parseMarker(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !MARKER_KEYS.has(key))) return null;
  if (value.version !== 1 || !DELETABLE_KINDS.has(value.kind)) return null;
  if (value.status !== 'succeeded' && value.status !== 'failed') return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
  return Object.freeze({ version: 1, kind: value.kind, createdAt: value.createdAt, status: value.status });
}

async function readMarker(directory) {
  try {
    return parseMarker(JSON.parse(await readFile(path.join(directory, MARKER_FILE), 'utf8')));
  } catch {
    return null;
  }
}

function outputRootFor(repoRoot) {
  return path.resolve(repoRoot, 'apps', 'desktop', 'out');
}

function assertOutputBoundary(repoRoot, candidate) {
  const outputRoot = outputRootFor(repoRoot);
  const resolved = path.resolve(candidate);
  if (!isInside(outputRoot, resolved)) throw new Error(`Artifact path is outside the allowed output root: ${resolved}`);
  return resolved;
}

export async function planArtifactRetention({ repoRoot, keep = DEFAULT_KEEP }) {
  if (!Number.isInteger(keep) || keep < 1 || keep > 20) throw new Error('Artifact retention keep must be an integer from 1 to 20');
  const root = outputRootFor(path.resolve(repoRoot));
  let entries = [];
  try {
    const stats=await lstat(root);
    if(stats.isSymbolicLink() || await realpath(root)!==path.join(await realpath(repoRoot),'apps','desktop','out')) throw new Error('Artifact output root must not traverse symlinks');
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const eligible = [];
  let protectedCount = 0;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      protectedCount += 1;
      continue;
    }
    const candidate = assertOutputBoundary(repoRoot, path.join(root, entry.name));
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) {
      protectedCount += 1;
      continue;
    }
    const marker = await readMarker(candidate);
    if (!marker || marker.status !== 'succeeded') {
      protectedCount += 1;
      continue;
    }
    eligible.push({ path: candidate, marker });
  }

  const development = eligible
    .filter((item) => item.marker.kind === 'development-package')
    .sort((left, right) => Date.parse(right.marker.createdAt) - Date.parse(left.marker.createdAt) || left.path.localeCompare(right.path));
  const retained = development.slice(0, keep);
  const deletions = [
    ...development.slice(keep),
    ...eligible.filter((item) => item.marker.kind === 'portable-temporary'),
  ].sort((left, right) => left.path.localeCompare(right.path));

  return { repoRoot: path.resolve(repoRoot), root, keep, retained, deletions, protectedCount };
}

async function validateDeletion(plan, item) {
  const candidate = assertOutputBoundary(plan.repoRoot, item.path);
  if(await realpath(plan.root)!==path.join(await realpath(plan.repoRoot),'apps','desktop','out')) throw new Error('Artifact output root changed before cleanup');
  const stats = await lstat(candidate);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Artifact deletion target is not a safe directory: ${candidate}`);
  const marker = await readMarker(candidate);
  if (!marker || marker.status !== 'succeeded' || marker.kind !== item.marker.kind || marker.createdAt !== item.marker.createdAt) {
    throw new Error(`Artifact retention marker changed before cleanup: ${candidate}`);
  }
  return candidate;
}

export async function applyArtifactRetention(plan, { dryRun = true } = {}) {
  const deleted = [];
  for (const item of plan.deletions) {
    const candidate = await validateDeletion(plan, item);
    if (!dryRun) {
      await rm(candidate, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
      deleted.push(candidate);
    }
  }
  return deleted;
}

export async function markDevelopmentOutput({ repoRoot, createdAt = new Date().toISOString(), platform = process.platform, arch = process.arch }) {
  const outputRoot = outputRootFor(path.resolve(repoRoot));
  const target = assertOutputBoundary(repoRoot, path.join(outputRoot, `Fielora-${platform}-${arch}`));
  const stats = await lstat(target);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Development package output is not a safe directory');
  const marker = { version: 1, kind: 'development-package', createdAt, status: 'succeeded' };
  await writeFile(path.join(target, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  return target;
}

export async function verifyDevelopmentPayload(target, platform = process.platform) {
  const resources = platform === 'darwin' ? path.join(target, 'Fielora.app', 'Contents', 'Resources') : path.join(target, 'resources');
  const executable = platform === 'darwin' ? path.join(target, 'Fielora.app', 'Contents', 'MacOS', 'Fielora') : path.join(target, platform === 'win32' ? 'Fielora.exe' : 'Fielora');
  for (const file of [executable, path.join(resources, 'app.asar'), path.join(resources, platform === 'win32' ? 'fielora-core.exe' : 'fielora-core')]) {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0) throw new Error('Incomplete package; previous packages retained');
  }
}

// Promotion happens after Forge succeeds in a separate directory. On failure the old app stays usable.
export async function promoteDevelopmentPackage({repoRoot, stagedPath, platform = process.platform, arch = process.arch}) {
  const staged = assertOutputBoundary(repoRoot, stagedPath);
  const target = assertOutputBoundary(repoRoot,path.join(outputRootFor(repoRoot),`Fielora-${platform}-${arch}`));
  if(staged===target) throw new Error('Package staging and installed paths must differ');
  await planArtifactRetention({repoRoot}); // Reject symlinked output ancestors.
  const stagedStats=await lstat(staged);
  if(!stagedStats.isDirectory()||stagedStats.isSymbolicLink())throw new Error('Invalid staging directory');
  await verifyDevelopmentPayload(staged,platform);
  const previous=assertOutputBoundary(repoRoot,path.join(outputRootFor(repoRoot),`.previous-Fielora-${platform}-${arch}-${randomUUID()}`));
  let backedUp=false;
  try {
    try {
      const stats=await lstat(target);
      if(!stats.isDirectory()||stats.isSymbolicLink())throw new Error('Existing package is not a safe directory');
      await verifyDevelopmentPayload(target,platform);
      await rename(target,previous);backedUp=true;
      // The exact previous installation has been verified, including legacy unmarked packages.
      if(!await readMarker(previous))await writeFile(path.join(previous,MARKER_FILE),JSON.stringify({version:1,kind:'development-package',createdAt:new Date(0).toISOString(),status:'succeeded'}));
    } catch(error) {if(error?.code!=='ENOENT')throw error;}
    await rename(staged,target);
  } catch(error) {
    if(backedUp)await rename(previous,target);
    throw error;
  }
  return finalizeDevelopmentPackage({repoRoot,platform,arch});
}

// Called only after Forge exits successfully. Missing payloads never trigger cleanup.
export async function finalizeDevelopmentPackage({ repoRoot, platform = process.platform, arch = process.arch }) {
  const target = assertOutputBoundary(repoRoot, path.join(outputRootFor(repoRoot), `Fielora-${platform}-${arch}`));
  await verifyDevelopmentPayload(target,platform);
  await markDevelopmentOutput({repoRoot, platform, arch});
  const plan = await planArtifactRetention({repoRoot, keep:1});
  if (!plan.retained.some(item => item.path === target)) throw new Error('Package timestamp conflict; previous packages retained');
  const deleted = await applyArtifactRetention(plan, {dryRun:false});
  return {target, deleted};
}

function displayPath(repoRoot, candidate) {
  return path.relative(repoRoot, candidate).split(path.sep).join('/');
}

function parseCleanupArguments(arguments_) {
  let dryRun = true;
  let keep = DEFAULT_KEEP;
  for (const argument of arguments_) {
    if (argument === '--apply') dryRun = false;
    else if (argument === '--dry-run') dryRun = true;
    else if (argument.startsWith('--keep=')) keep = Number(argument.slice('--keep='.length));
    else throw new Error(`Unknown artifact retention argument: ${argument}`);
  }
  return { dryRun, keep };
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === 'finalize-development') {
    if(arguments_.length !== 1) throw new Error('finalize-development does not accept additional arguments');
    if(process.env.FIELORA_OUT_DIR) {console.log('PACKAGE_READY custom output retained; automatic cleanup applies to apps/desktop/out only');return;}
    const result = await finalizeDevelopmentPackage({repoRoot});
    console.log(`PACKAGE_READY ${displayPath(repoRoot,result.target)} old_packages_removed=${result.deleted.length} keep=1`);
    return;
  }
  if (arguments_[0] === 'mark-development') {
    if (arguments_.length !== 1) throw new Error('mark-development does not accept additional arguments');
    const target = await markDevelopmentOutput({ repoRoot });
    console.log(`ARTIFACT_MARKED ${displayPath(repoRoot, target)}`);
    return;
  }
  const { dryRun, keep } = parseCleanupArguments(arguments_);
  const plan = await planArtifactRetention({ repoRoot, keep });
  for (const item of plan.retained) console.log(`KEEP ${displayPath(repoRoot, item.path)}`);
  for (const item of plan.deletions) console.log(`${dryRun ? 'WOULD_DELETE' : 'DELETE'} ${displayPath(repoRoot, item.path)}`);
  await applyArtifactRetention(plan, { dryRun });
  console.log(`ARTIFACT_RETENTION mode=${dryRun ? 'dry-run' : 'apply'} keep=${keep} candidates=${plan.deletions.length} protected=${plan.protectedCount}`);
  console.log('FORMAL_EVIDENCE protected: artifacts/ is outside the cleanup root');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
