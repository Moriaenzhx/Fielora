import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyArtifactRetention, finalizeDevelopmentPackage, promoteDevelopmentPackage, markDevelopmentOutput, planArtifactRetention } from './artifact-retention.mjs';

async function exists(candidate) {
  try { await access(candidate); return true; } catch { return false; }
}

async function fixtureDirectory(root, name, marker) {
  const directory = path.join(root, 'apps', 'desktop', 'out', name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'payload.txt'), name);
  if (marker) await writeFile(path.join(directory, '.fielora-retention.json'), JSON.stringify({ version: 1, ...marker }));
  return directory;
}

test('artifact retention is dry-run first and only deletes allowlisted temp fixtures', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'fielora-retention-'));
  const outside = path.join(path.dirname(fixtureRoot), `${path.basename(fixtureRoot)}-outside`);
  try {
    const oldOne = await fixtureDirectory(fixtureRoot, 'dev-old-one', { kind: 'development-package', createdAt: '2026-01-01T00:00:00.000Z', status: 'succeeded' });
    const oldTwo = await fixtureDirectory(fixtureRoot, 'dev-old-two', { kind: 'development-package', createdAt: '2026-02-01T00:00:00.000Z', status: 'succeeded' });
    const recentOne = await fixtureDirectory(fixtureRoot, 'dev-recent-one', { kind: 'development-package', createdAt: '2026-03-01T00:00:00.000Z', status: 'succeeded' });
    const recentTwo = await fixtureDirectory(fixtureRoot, 'dev-recent-two', { kind: 'development-package', createdAt: '2026-04-01T00:00:00.000Z', status: 'succeeded' });
    const portable = await fixtureDirectory(fixtureRoot, 'portable-success', { kind: 'portable-temporary', createdAt: '2026-05-01T00:00:00.000Z', status: 'succeeded' });
    const failedEvidence = await fixtureDirectory(fixtureRoot, 'failed-evidence', { kind: 'development-package', createdAt: '2025-01-01T00:00:00.000Z', status: 'failed' });
    const unmarked = await fixtureDirectory(fixtureRoot, 'unmarked-history');
    const formalEvidence = path.join(fixtureRoot, 'artifacts', 'phase04', 'freeze', 'evidence.json');
    await mkdir(path.dirname(formalEvidence), { recursive: true });
    await writeFile(formalEvidence, '{}');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'sentinel.txt'), 'keep');

    const plan = await planArtifactRetention({ repoRoot: fixtureRoot, keep: 2 });
    assert.deepEqual(plan.deletions.map((item) => path.basename(item.path)), ['dev-old-one', 'dev-old-two', 'portable-success']);
    assert.deepEqual(plan.retained.map((item) => path.basename(item.path)), ['dev-recent-two', 'dev-recent-one']);

    assert.deepEqual(await applyArtifactRetention(plan, { dryRun: true }), []);
    for (const candidate of [oldOne, oldTwo, recentOne, recentTwo, portable, failedEvidence, unmarked, formalEvidence, outside]) {
      assert.equal(await exists(candidate), true);
    }

    await assert.rejects(() => applyArtifactRetention({
      ...plan,
      deletions: [{ path: outside, marker: { kind: 'development-package', createdAt: '2026-01-01T00:00:00.000Z' } }],
    }, { dryRun: false }), /outside the allowed output root/);
    assert.equal(await exists(outside), true);

    assert.deepEqual((await applyArtifactRetention(plan, { dryRun: false })).map((item) => path.basename(item)), ['dev-old-one', 'dev-old-two', 'portable-success']);
    for (const candidate of [oldOne, oldTwo, portable]) assert.equal(await exists(candidate), false);
    for (const candidate of [recentOne, recentTwo, failedEvidence, unmarked, formalEvidence, outside]) assert.equal(await exists(candidate), true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('development marker only targets the exact packaged output inside the repo', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'fielora-retention-marker-'));
  try {
    const output = path.join(fixtureRoot, 'apps', 'desktop', 'out', 'Fielora-win32-x64');
    await mkdir(output, { recursive: true });
    assert.equal(await markDevelopmentOutput({ platform: 'win32', arch: 'x64', repoRoot: fixtureRoot, createdAt: '2026-06-01T00:00:00.000Z' }), output);
    const marker = JSON.parse(await readFile(path.join(output, '.fielora-retention.json'), 'utf8'));
    assert.deepEqual(marker, { version: 1, kind: 'development-package', createdAt: '2026-06-01T00:00:00.000Z', status: 'succeeded' });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});


test('successful package removes old managed packages; incomplete package preserves them', async () => {
  const repoRoot=await mkdtemp(path.join(tmpdir(),'fielora-retention-finalize-'));
  try {
    const old=await fixtureDirectory(repoRoot,'previous-mac-package',{kind:'development-package',createdAt:'2026-01-01T00:00:00.000Z',status:'succeeded'});
    const unknown=await fixtureDirectory(repoRoot,'unmarked-user-files');
    const target=await fixtureDirectory(repoRoot,'Fielora-darwin-arm64');
    await assert.rejects(()=>finalizeDevelopmentPackage({repoRoot,platform:'darwin',arch:'arm64'}));
    assert.equal(await exists(old),true);
    for(const file of ['MacOS/Fielora','Resources/app.asar','Resources/fielora-core']) {
      const output=path.join(target,'Fielora.app','Contents',file);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,'fixture');
    }
    const result=await finalizeDevelopmentPackage({repoRoot,platform:'darwin',arch:'arm64'});
    assert.deepEqual(result.deleted,[old]);assert.equal(await exists(target),true);assert.equal(await exists(unknown),true);
    assert.equal((await planArtifactRetention({repoRoot})).keep,1);
  } finally {await rm(repoRoot,{recursive:true,force:true});}
});


test('staged package promotion replaces the previous app only after validating the new payload', async()=>{
 const repoRoot=await mkdtemp(path.join(tmpdir(),'fielora-promotion-'));
 try {
  const old=await fixtureDirectory(repoRoot,'Fielora-darwin-arm64');
  const staged=await fixtureDirectory(repoRoot,'.package-staging-test/Fielora-darwin-arm64');
  async function payload(root,text){for(const file of ['MacOS/Fielora','Resources/app.asar','Resources/fielora-core']){const dest=path.join(root,'Fielora.app','Contents',file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,text);}}
  await payload(old,'old');
  await assert.rejects(()=>promoteDevelopmentPackage({repoRoot,stagedPath:staged,platform:'darwin',arch:'arm64'}));
  assert.equal(await readFile(path.join(old,'Fielora.app','Contents','MacOS','Fielora'),'utf8'),'old');
  await payload(staged,'new');
  const result=await promoteDevelopmentPackage({repoRoot,stagedPath:staged,platform:'darwin',arch:'arm64'});
  assert.equal(await readFile(path.join(old,'Fielora.app','Contents','MacOS','Fielora'),'utf8'),'new');
  assert.equal(result.deleted.length,1);assert.equal(await exists(staged),false);
 }finally{await rm(repoRoot,{recursive:true,force:true});}
});
