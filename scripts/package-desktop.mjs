import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { planArtifactRetention, promoteDevelopmentPackage } from './artifact-retention.mjs';

const repoRoot=path.resolve(import.meta.dirname,'..');
const desktop=path.join(repoRoot,'apps','desktop');
const require=createRequire(path.join(desktop,'package.json'));
const forgePackage=require.resolve('@electron-forge/cli/package.json');
const manifest=JSON.parse(await readFile(forgePackage,'utf8'));
const forge=path.resolve(path.dirname(forgePackage),manifest.bin['electron-forge']);
async function run(env) {
  const child=spawn(process.execPath,[forge,'package',...process.argv.slice(2)],{cwd:desktop,env,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(code??1));});
  if(code!==0)throw new Error(`Packaging failed (${code}); previous package retained`);
}
if(process.env.FIELORA_OUT_DIR || process.argv.length>2) {
  // Explicit custom/cross-target output keeps Forge's behavior and is not automatically deleted.
  await run(process.env);
} else {
  const out=path.join(desktop,'out');await mkdir(out,{recursive:true});
  await planArtifactRetention({repoRoot});
  const staging=await mkdtemp(path.join(out,'.package-staging-'));
  try {
    await run({...process.env,FIELORA_OUT_DIR:staging});
    const result=await promoteDevelopmentPackage({repoRoot,stagedPath:path.join(staging,`Fielora-${process.platform}-${process.arch}`)});
    await rm(staging,{recursive:true,force:false});
    console.log(`PACKAGE_READY ${path.relative(repoRoot,result.target)} old_packages_removed=${result.deleted.length} keep=1`);
  } catch(error) {console.error(`Package diagnostics retained: ${staging}`);throw error;}
}
