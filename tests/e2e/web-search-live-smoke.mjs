import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {launchElectron,connectToFieloraApp,waitForExpression,captureScreenshot,cleanupElectronProcess} from './harness/electron-cdp-harness.mjs';

// Explicit, one-query public-network smoke. Never part of offline gates; never
// reads production settings, uses a model, retries or treats quota as PASS.
assert.equal(process.env.FIELORA_LIVE_WEB_SMOKE,'1','Opt in to one public Exa search');
assert.ok(process.env.FIELORA_PACKAGED_EXE,'Select the packaged desktop explicitly');
const root=path.resolve(import.meta.dirname,'../..');
const dataRoot=await mkdtemp(path.join(tmpdir(),'fielora-live-search-'));
const evidence=process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(),'fielora-live-search-evidence-'));
const output=[];let child,cdp;
const wait=e=>waitForExpression(cdp,e,{output,timeoutMs:40000});
const click=selector=>cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
try {
  await mkdir(evidence,{recursive:true});
  const launched=await launchElectron({root:path.join(root,'apps/desktop'),dataRoot,output,executablePath:process.env.FIELORA_PACKAGED_EXE,extraEnv:{FIELORA_WEB_SEARCH_FIXTURE:'0'}});
  child=launched.child;cdp=await connectToFieloraApp({port:launched.port,output,enablePage:true,timeoutMs:60000});
  await wait('window.fielora && window.fielora.core.getHealth().then(h=>h.state==="READY") && document.querySelector("[data-testid=settings-nav]")');
  const config=await cdp.eval('window.fielora.webSearch.config()'); assert.equal(config.credential_present,false);
  await click('[data-testid=settings-nav]');await wait('document.querySelector("[data-testid=settings-category-extensions]")');
  await click('[data-testid=settings-category-extensions]');await wait('document.querySelector("[data-testid=settings-extension-tab-web_search]")');
  await click('[data-testid=settings-extension-tab-web_search]');await wait('document.querySelector("[data-testid=web-search-test]") && !document.querySelector("[data-testid=web-search-test]").disabled');
  await click('[data-testid=web-search-test]');
  await wait('document.querySelector("[data-testid=web-search-probe]") && !document.querySelector("[data-testid=web-search-test]").disabled');
  const observed=await cdp.eval('(()=>{const e=document.querySelector("[data-testid=web-search-probe]");e.scrollIntoView({block:"center",behavior:"instant"});return {text:e.innerText,sources:[...e.querySelectorAll("a")].map(a=>({title:a.textContent,url:a.href}))}})()');
  const result={status:observed.sources.length>0?'PASS':'BLOCKED',checkedAt:new Date().toISOString(),config,...observed,scope:'Real packaged UI/Core/Exa, one keyless fixed-query search, no model, no retries'};
  await writeFile(path.join(evidence,'results.json'),JSON.stringify(result,null,2));await captureScreenshot(cdp,path.join(evidence,'live-search.png'));
  assert.ok(observed.sources.length>0,observed.text);assert.ok(observed.sources.every(s=>new URL(s.url).hostname.endsWith('rust-lang.org')));
  console.log('LIVE_PACKAGED_SEARCH=PASS '+JSON.stringify(observed));
} finally {
  if(cdp){await cdp.eval('setTimeout(()=>window.fielora.core.quit(),0);true').catch(()=>{});cdp.close();}
  if(child)await cleanupElectronProcess(child);
  await rm(dataRoot,{recursive:true,force:true});
}
