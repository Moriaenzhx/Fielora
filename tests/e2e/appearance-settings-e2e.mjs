import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureScreenshot,
  cleanupElectronProcess,
  connectToFieloraApp,
  launchElectron,
  waitForChildExit,
  waitForExpression,
} from './harness/electron-cdp-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const dataRoot = await mkdtemp(path.join(tmpdir(), 'fielora-appearance-'));
const visualReview = process.env.FIELORA_E2E_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'fielora-appearance-evidence-'));
let child;
let cdp;
let originalPreferenceStorage;
let preferenceStorageRestored = false;
const output = [];

const wait = (cdp, expression, timeout = 20_000) => waitForExpression(cdp, expression, { timeoutMs: timeout, output });

async function assertCornerContinuity(cdp, tolerance = 2) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const pixels = await cdp.eval(`(async()=>{
    const image=new Image();image.src='data:image/png;base64,${data}';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    const rect=document.querySelector('.settings-content').getBoundingClientRect();
    const scale=image.width/innerWidth;
    const sample=(x,y)=>[...context.getImageData(Math.floor(x*scale),Math.floor(y*scale),1,1).data];
    return {navigation:sample(rect.left-14,rect.top+3),corner:sample(rect.left+3,rect.top+3)};
  })()`);
  assert.ok(pixels.corner.every((value, index) => Math.abs(value - pixels.navigation[index]) <= tolerance), `Rounded corner must share the navigation backing: ${JSON.stringify(pixels)}`);
}

// Compare exposed chrome pixels with one uninterrupted window-sized paint.
// Covers both edges of the sidebar, the titlebar join and the content corner.
async function assertWindowCanvas(cdp, contentSelector) {
  const points = await cdp.eval(`(()=>{
    const nav=document.querySelector('[data-brand-chrome="navigation"]').getBoundingClientRect();
    const content=document.querySelector(${JSON.stringify(contentSelector)}).getBoundingClientRect();
    return [nav.top+2,nav.top+nav.height*.4,nav.top+nav.height*.7,nav.bottom-8]
      .flatMap(y=>[[nav.left+2,y],[nav.right-2,y]])
      .concat([[content.left+2,content.top+2],[nav.left+2,nav.top-2]]);
  })()`);
  const actual = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  let reference;
  try {
    await cdp.eval(`(()=>{const ref=document.createElement('div');ref.id='canvas-pixel-reference';
      Object.assign(ref.style,{position:'fixed',inset:'0',zIndex:'2147483647',pointerEvents:'none',
      background:getComputedStyle(document.querySelector('.desktop-frame')).background});document.body.append(ref);
      document.querySelector('.desktop-frame').style.visibility='hidden';})()`);
    reference = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  } finally {
    await cdp.eval(`document.getElementById('canvas-pixel-reference')?.remove();document.querySelector('.desktop-frame').style.removeProperty('visibility')`);
  }
  const differences = await cdp.eval(`(async()=>{
    const sample=async(data)=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);const scale=image.width/innerWidth;
      return ${JSON.stringify(points)}.map(([x,y])=>[...context.getImageData(Math.floor(x*scale),Math.floor(y*scale),1,1).data]);};
    const actual=await sample(${JSON.stringify(actual)}),reference=await sample(${JSON.stringify(reference)});
    return actual.map((pixel,i)=>({point:${JSON.stringify(points)}[i],actual:pixel,reference:reference[i]}))
      .filter(({actual,reference})=>actual.some((v,i)=>Math.abs(v-reference[i])>2));
  })()`);
  assert.deepEqual(differences, [], `Chrome must show one continuous window canvas: ${JSON.stringify(differences)}`);
}

async function assertNativeGlassHover(cdp) {
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await wait(cdp, `innerWidth===outerWidth && document.querySelector('.conversation-composer')`);
  await cdp.send('Page.bringToFront');
  const webBlur = await cdp.eval(`[...document.querySelectorAll('*')].filter(e=>{
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).backdropFilter!=='none';
  }).map(e=>e.className)`);
  assert.deepEqual(webBlur, [], 'Native vibrancy must not be combined with web backdrop filters');
  const controls = ['new-conversation', 'now-nav', 'library-nav', 'settings-nav'];
  const snapshot = () => cdp.eval(`(${JSON.stringify(controls)}).map(id=>{
    const s=getComputedStyle(document.querySelector('[data-testid="'+id+'"]'));return [s.backgroundColor,s.backgroundImage];
  })`);
  await cdp.eval(`document.activeElement?.blur()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });
  await new Promise(resolve => setTimeout(resolve, 200));
  const idle = await snapshot();
  assert.ok(idle.every(([color,image])=>color==='rgba(0, 0, 0, 0)'&&image==='none'), JSON.stringify(idle));
  const hoverColors = [];
  for (let pass=0;pass<3;pass++) {
    for (const id of controls) {
      const point=await cdp.eval(`(()=>{const r=document.querySelector('[data-testid="${id}"]').getBoundingClientRect();return{x:r.x+r.width*.7,y:r.y+r.height/2}})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await wait(cdp, `document.querySelector('[data-testid="${id}"]').matches(':hover')`);
      await new Promise(resolve=>setTimeout(resolve, 200));
      hoverColors.push(await cdp.eval(`getComputedStyle(document.querySelector('[data-testid="${id}"]')).backgroundColor`));
    }
  }
  assert.equal(new Set(hoverColors).size, 1, 'Sidebar actions must use the same hover fill');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(await snapshot(), idle, 'Leaving controls must restore their transparent backgrounds');
  await assertWindowCanvas(cdp, '.conversation-column');
  await captureScreenshot(cdp, path.join(visualReview, 'conversation-after-sidebar-hover.png'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

try {
  await mkdir(visualReview, { recursive: true });
  const launched = await launchElectron({ root, dataRoot, output, executablePath: process.env.FIELORA_PACKAGED_APP ?? '' });
  child = launched.child;
  cdp = await connectToFieloraApp({ ...launched, enablePage: true });
  await wait(cdp, `document.querySelector('[data-testid="project-workspace"]')`);
  originalPreferenceStorage = await cdp.eval(`({current:localStorage.getItem('fielora.ui.preferences.v2'),legacy:localStorage.getItem('fielora.ui.preferences.v1')})`);
  await cdp.eval(`localStorage.removeItem('fielora.ui.preferences.v2');localStorage.removeItem('fielora.ui.preferences.v1');location.reload()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(cdp, `document.querySelector('[data-testid="project-workspace"]')`);
  await wait(cdp, `['light','dark'].includes(document.documentElement.dataset.effectiveAppearance)`);
  const initialAppearance = await cdp.eval(`({
    theme:document.documentElement.dataset.officialTheme,
    language:document.documentElement.dataset.designLanguage,
    mode:document.documentElement.dataset.appearanceMode,
    effective:document.documentElement.dataset.effectiveAppearance,
    material:document.documentElement.dataset.material,
  })`);
  assert.deepEqual({ theme: initialAppearance.theme, language: initialAppearance.language, material: initialAppearance.material }, { theme: 'fielora', language: 'fielora-glass', material: 'glass' });
  assert.equal(initialAppearance.mode, 'light');
  assert.equal(initialAppearance.effective, 'light');
  // The former empty-project fixture had no composer, so it missed the native
  // vibrancy + web backdrop-filter combination on the actual conversation page.
  await cdp.eval(`window.fieloraTest.createProject({title:'Appearance fixture',goal:'Verify conversation chrome',root_path:${JSON.stringify(dataRoot)}})`);
  await cdp.eval(`location.reload()`);
  await wait(cdp, `document.querySelector('[data-testid="new-conversation"]')`);
  await cdp.eval(`document.querySelector('[data-testid="new-conversation"]').click()`);
  await wait(cdp, `document.querySelector('.conversation-composer')`);


  await cdp.send('Page.bringToFront');
  // Native hit testing remains bounded by the real window, not the larger
  // screenshot viewport. Exercise pointer input at the actual window size.
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await wait(cdp, `innerWidth===outerWidth`);
  await cdp.send('Page.bringToFront');
  await wait(cdp, `document.querySelector('[data-testid="utility-rail"] button')`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });
  await wait(cdp, `getComputedStyle(document.querySelector('[data-testid="utility-rail"]')).opacity==='0'`);
  const corner = await cdp.eval(`(()=>{const r=document.querySelector('[data-testid="utility-rail"] button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...corner });
  await wait(cdp, `getComputedStyle(document.querySelector('[data-testid="utility-rail"]')).opacity==='1'`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });
  await wait(cdp, `getComputedStyle(document.querySelector('[data-testid="utility-rail"]')).opacity==='0'`);
  await cdp.eval(`document.querySelector('[data-testid="utility-rail"] button').focus()`);
  await wait(cdp, `getComputedStyle(document.querySelector('[data-testid="utility-rail"]')).opacity==='1'`);
  await cdp.eval(`document.activeElement.blur()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await assertWindowCanvas(cdp, '.conversation-column');
  await captureScreenshot(cdp, path.join(visualReview, 'project-continuous-canvas.png'));
  // Exercise the custom palette at both narrow and wide window sizes.
  await cdp.eval(`document.documentElement.style.setProperty('--fl-brand-chrome-canvas', 'linear-gradient(135deg, #F2ECF0, #FFFFFF 45%, #FDF7F8)')`);
  for (const width of [920, 1440]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await assertWindowCanvas(cdp, '.conversation-column');
  }
  await captureScreenshot(cdp, path.join(visualReview, 'project-custom-gradient.png'));
  await cdp.eval(`document.documentElement.style.removeProperty('--fl-brand-chrome-canvas')`);


  await cdp.eval(`document.querySelector('[data-testid="settings-nav"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="settings-screen"]')`);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="ui-language"]').closest('.ui-select').dataset.value`), 'SYSTEM');
  await cdp.eval(`document.querySelector('[data-testid="ui-language"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="ui-language-option-EN"]')`);
  await cdp.eval(`document.querySelector('[data-testid="ui-language-option-EN"]').click()`);
  await wait(cdp, `document.documentElement.lang==='en'&&document.querySelector('[data-testid="settings-general"] h1').innerText==='General'`);
  assert.equal(await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).languagePreference`), 'EN');
  await cdp.eval(`document.querySelector('[data-testid="ui-language"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="ui-language-option-ZH_CN"]')`);
  await cdp.eval(`document.querySelector('[data-testid="ui-language-option-ZH_CN"]').click()`);
  await wait(cdp, `document.documentElement.lang==='zh-CN'&&document.querySelector('[data-testid="settings-general"] h1').innerText==='常规'`);
  assert.equal(await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).languagePreference`), 'ZH_CN');
  const settingsRails = [];
  for (const [category, section] of [['general', 'settings-general'], ['shortcuts', 'settings-shortcuts'], ['appearance', 'settings-appearance']]) {
    await cdp.eval(`document.querySelector('[data-testid="settings-category-${category}"]').click()`);
    await wait(cdp, `document.querySelector('[data-testid="${section}"]')`);
    settingsRails.push(await cdp.eval(`(()=>{const rect=document.querySelector('[data-testid="${section}"]').getBoundingClientRect();return{left:rect.left,width:rect.width};})()`));
  }
  assert.equal(Math.max(...settingsRails.map((rail) => rail.left)) - Math.min(...settingsRails.map((rail) => rail.left)) <= 1, true, JSON.stringify(settingsRails));
  assert.equal(Math.max(...settingsRails.map((rail) => rail.width)) - Math.min(...settingsRails.map((rail) => rail.width)) <= 1, true, JSON.stringify(settingsRails));
  await cdp.eval(`document.querySelector('[data-testid="settings-category-appearance"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="settings-appearance"]')`);
  assert.equal(await cdp.eval(`document.querySelectorAll('.appearance-mode-control [role="radio"]').length`), 0);
  assert.equal(await cdp.eval(`document.querySelectorAll('.theme-preview-card').length`), 0);
  assert.equal(await cdp.eval(`Boolean(document.querySelector('[data-testid="official-theme-card"],[data-testid="appearance-import-theme"],.advanced-theme-section'))`), false);
  assert.equal(await cdp.eval(`document.querySelector('[data-testid="settings-appearance"]').innerText.includes('Glass 不是一个主题选项')`), false);
  assert.equal(await cdp.eval(`['appearance-sidebar-background-summary','appearance-workspace-background-hex','appearance-ui-font','appearance-ui-font-size','appearance-code-font','appearance-code-font-size','appearance-surface-contrast','appearance-action-color-hex','appearance-reduced-motion','appearance-high-contrast','appearance-smooth-scrolling','appearance-reset'].every((id)=>document.querySelector('[data-testid="'+id+'"]'))`), true);
  assert.equal(await cdp.eval(`document.querySelectorAll('input[type="color"]').length`), 0);
  assert.equal(await cdp.eval(`Boolean(document.querySelector('[data-testid="settings-screen"]')) && !document.querySelector('.project-context-controls:not([hidden]),.utility-control-dock')`), true);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false });
  const settingsScroll = await cdp.eval(`(()=>{const content=document.querySelector('.settings-content');const style=getComputedStyle(content);return{overflowY:style.overflowY,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight};})()`);
  assert.equal(settingsScroll.overflowY, 'auto');
  assert.equal(settingsScroll.scrollHeight > settingsScroll.clientHeight, true);
  await cdp.eval(`document.querySelector('.settings-content').scrollTo({ top: document.querySelector('.settings-content').scrollHeight, behavior: 'instant' })`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await cdp.eval(`document.querySelector('.settings-content').scrollTop > 0`), true);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.eval(`document.querySelector('.settings-content').scrollTo({ top: 0, behavior: 'instant' })`);
  await wait(cdp, `document.documentElement.dataset.effectiveAppearance==='light'`);
  const sidebarDefault = await cdp.eval(`(()=>{const stored=JSON.parse(localStorage.getItem('fielora.ui.preferences.v2'));return{summary:document.querySelector('[data-testid="appearance-sidebar-background-summary"]').textContent,override:stored.appearance.sidebarBackgroundOverride,gradientOverride:stored.appearance.sidebarBackgroundGradientOverride};})()`);
  assert.deepEqual(sidebarDefault, { summary: '主题渐变', override: null, gradientOverride: null });
  const chromeContinuity = await cdp.eval(`(()=>{const element=document.querySelector('[data-brand-chrome="top"]');const top=getComputedStyle(element);const transition=getComputedStyle(element,'::after');const navigation=getComputedStyle(document.querySelector('.settings-navigation[data-brand-chrome="navigation"]'));const area=navigator.windowControlsOverlay?.getTitlebarAreaRect();return{topImage:top.backgroundImage,navigationImage:navigation.backgroundImage,transitionImage:transition.backgroundImage,transitionRight:Number.parseFloat(transition.right),nativeControlsWidth:area?innerWidth-area.x-area.width:null,caption:document.documentElement.style.getPropertyValue('--fl-brand-chrome-caption'),override:document.documentElement.style.getPropertyValue('--fl-sidebar-background')};})()`);
  assert.equal(chromeContinuity.topImage, chromeContinuity.navigationImage);
  if (process.platform !== 'darwin') assert.equal(chromeContinuity.transitionImage.includes('rgb(255, 239, 242)'), true, JSON.stringify(chromeContinuity));
  if (process.platform !== 'darwin' && chromeContinuity.nativeControlsWidth !== null) assert.equal(Math.abs(chromeContinuity.transitionRight - chromeContinuity.nativeControlsWidth) <= 1, true, JSON.stringify(chromeContinuity));
  assert.equal(chromeContinuity.caption, '#FFEFF2');
  assert.equal(chromeContinuity.override, '');
  await captureScreenshot(cdp, path.join(visualReview, 'appearance-refined-light-1440.png'));
  await assertCornerContinuity(cdp, 4);
  await assertWindowCanvas(cdp, '.settings-content');
  if (process.platform === 'darwin') {
    await cdp.eval(`document.querySelector('[data-testid="appearance-translucent-sidebar"]').click()`);
    await wait(cdp, `document.documentElement.dataset.translucentSidebar==='true'`);
    await wait(cdp, `JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.translucentSidebar===true`);
    const glass = await cdp.eval(`(()=>{const nav=getComputedStyle(document.querySelector('.settings-navigation'));const root=getComputedStyle(document.querySelector('.desktop-frame'));const content=getComputedStyle(document.querySelector('.settings-content'));return{nav:nav.backgroundColor,root:root.backgroundColor,content:content.backgroundColor};})()`);
    assert.match(glass.root, /0\.28/);
    assert.equal(glass.nav, 'rgba(0, 0, 0, 0)');
    assert.equal(glass.content, 'rgb(255, 255, 255)');
    await assertCornerContinuity(cdp);
    await captureScreenshot(cdp, path.join(visualReview, 'appearance-translucent.png'));
    await cdp.eval(`document.querySelector('[data-testid="appearance-high-contrast"]').click()`);
    await wait(cdp, `document.documentElement.dataset.translucentSidebar==='false'`);
    await cdp.eval(`document.querySelector('[data-testid="appearance-high-contrast"]').click()`);
    await wait(cdp, `document.documentElement.dataset.translucentSidebar==='true'`);
    await cdp.eval(`location.reload()`);
    await wait(cdp, `document.querySelector('[data-testid="settings-nav"]') && document.documentElement.dataset.translucentSidebar==='true'`);
    await assertNativeGlassHover(cdp);
    await assertWindowCanvas(cdp, '.conversation-column');
    await captureScreenshot(cdp, path.join(visualReview, 'project-translucent-canvas.png'));
    await cdp.eval(`document.querySelector('[data-testid="settings-nav"]').click()`);
    await wait(cdp, `document.querySelector('[data-testid="settings-category-appearance"]')`);
    await cdp.eval(`document.querySelector('[data-testid="settings-category-appearance"]').click()`);
    await wait(cdp, `document.querySelector('[data-testid="appearance-translucent-sidebar"]')`);
    await cdp.eval(`document.querySelector('[data-testid="appearance-translucent-sidebar"]').click()`);
    await wait(cdp, `document.documentElement.dataset.translucentSidebar==='false'`);
    assert.equal(await cdp.eval(`window.fielora.window.setTitlebarTheme('LIGHT','#FFFFFF','invalid').then(()=>false,()=>true)`), true);
  }

  const customizationGeometry = await cdp.eval(`(()=>{const rows=[...document.querySelectorAll('.appearance-customization-card .appearance-setting-row:not(.appearance-material-row)')];const controls=rows.map((row)=>row.lastElementChild.getBoundingClientRect());const heading=document.querySelector('#appearance-customization-title');const description=heading.nextElementSibling;return{rowHeights:rows.map((row)=>row.getBoundingClientRect().height),controlHeights:controls.map((rect)=>rect.height),copyHeights:rows.map((row)=>row.firstElementChild.getBoundingClientRect().height),rowBoxSizing:rows.map((row)=>getComputedStyle(row).boxSizing),rowPadding:rows.map((row)=>getComputedStyle(row).padding),controlLefts:controls.map((rect)=>rect.left),controlRights:controls.map((rect)=>rect.right),descriptionBelowTitle:description.getBoundingClientRect().top>=heading.getBoundingClientRect().bottom};})()`);
  assert.equal(Math.max(...customizationGeometry.rowHeights) <= 62, true, JSON.stringify(customizationGeometry));
  assert.equal(Math.max(...customizationGeometry.controlLefts) - Math.min(...customizationGeometry.controlLefts) <= 1, true, JSON.stringify(customizationGeometry));
  assert.equal(Math.max(...customizationGeometry.controlRights) - Math.min(...customizationGeometry.controlRights) <= 1, true, JSON.stringify(customizationGeometry));
  assert.equal(customizationGeometry.descriptionBelowTitle, true);

  await cdp.eval(`document.activeElement?.blur()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });
  await cdp.eval(`(()=>{const input=document.querySelector('[data-testid="appearance-surface-contrast"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(cdp, `JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.surfaceContrast===0 && document.documentElement.style.getPropertyValue('--fl-brand-chrome-active').includes('0.00%') && document.documentElement.style.getPropertyValue('--fl-brand-chrome-selection-shadow')==='none' && getComputedStyle(document.querySelector('[data-testid="settings-category-appearance"]')).boxShadow==='none'`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const lowContrastNavigation = await cdp.eval(`(()=>{const button=document.querySelector('[data-testid="settings-category-appearance"]');const style=getComputedStyle(button);return{background:style.backgroundColor,shadow:style.boxShadow,activeToken:style.getPropertyValue('--fl-brand-chrome-active'),shadowToken:style.getPropertyValue('--fl-brand-chrome-selection-shadow')};})()`);
  await cdp.eval(`(()=>{const input=document.querySelector('[data-testid="appearance-surface-contrast"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(cdp, `JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.surfaceContrast===100 && document.documentElement.style.getPropertyValue('--fl-brand-chrome-active').includes('29.00%') && document.documentElement.style.getPropertyValue('--fl-brand-chrome-selection-shadow').includes('12.00%') && getComputedStyle(document.querySelector('[data-testid="settings-category-appearance"]')).boxShadow!=='none'`);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const highContrastNavigation = await cdp.eval(`(()=>{const button=document.querySelector('[data-testid="settings-category-appearance"]');const style=getComputedStyle(button);return{background:style.backgroundColor,shadow:style.boxShadow,activeToken:style.getPropertyValue('--fl-brand-chrome-active'),shadowToken:style.getPropertyValue('--fl-brand-chrome-selection-shadow')};})()`);
  const contrastNavigationEvidence = JSON.stringify({ lowContrastNavigation, highContrastNavigation });
  assert.notEqual(highContrastNavigation.background, lowContrastNavigation.background, contrastNavigationEvidence);
  assert.equal(lowContrastNavigation.shadow, 'none', contrastNavigationEvidence);
  assert.notEqual(highContrastNavigation.shadow, 'none', contrastNavigationEvidence);
  await cdp.eval(`(()=>{const input=document.querySelector('[data-testid="appearance-surface-contrast"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'42');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(cdp, `JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.surfaceContrast===42 && document.documentElement.style.getPropertyValue('--fl-brand-chrome-selection-shadow')===''`);

  const light = await cdp.eval(`(()=>{const content=getComputedStyle(document.querySelector('.settings-content'));const navigation=getComputedStyle(document.querySelector('.settings-navigation'));return{content:content.backgroundColor,navigation:navigation.backgroundColor};})()`);
  assert.notEqual(light.content, light.navigation);

  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await wait(cdp, `document.documentElement.dataset.effectiveAppearance==='light'`);
  await cdp.eval(`document.querySelector('[data-testid="appearance-sidebar-background-mode"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-sidebar-background-mode-option-SOLID"]')`);
  await cdp.eval(`document.querySelector('[data-testid="appearance-sidebar-background-mode-option-SOLID"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-sidebar-background-hex"]:not([readonly])')`);
  await cdp.eval(`(()=>{const input=document.querySelector('[data-testid="appearance-sidebar-background-hex"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'#DDEEFF');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(cdp, `document.documentElement.style.getPropertyValue('--fl-brand-chrome-canvas')==='#DDEEFF'`);
  await wait(cdp, `getComputedStyle(document.querySelector('[data-brand-chrome="top"]')).backgroundColor===getComputedStyle(document.querySelector('.settings-navigation[data-brand-chrome="navigation"]')).backgroundColor`);
  const customSidebar = await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.sidebarBackgroundOverride`);
  assert.equal(customSidebar, '#DDEEFF');
  const customChromeContinuity = await cdp.eval(`(()=>{const element=document.querySelector('[data-brand-chrome="top"]');const top=getComputedStyle(element);const transition=getComputedStyle(element,'::after');const navigation=getComputedStyle(document.querySelector('.settings-navigation[data-brand-chrome="navigation"]'));return{topImage:top.backgroundImage,navImage:navigation.backgroundImage,topColor:top.backgroundColor,navColor:navigation.backgroundColor,transitionImage:transition.backgroundImage,caption:document.documentElement.style.getPropertyValue('--fl-brand-chrome-caption'),legacy:document.documentElement.style.getPropertyValue('--fl-sidebar-background')};})()`);
  assert.equal(customChromeContinuity.topColor, customChromeContinuity.navColor, JSON.stringify(customChromeContinuity));
  assert.equal(customChromeContinuity.caption, '#DDEEFF');
  if (process.platform !== 'darwin') assert.equal(customChromeContinuity.transitionImage.includes('rgb(221, 238, 255)'), true, JSON.stringify(customChromeContinuity));
  assert.equal(customChromeContinuity.legacy, '');
  await assertWindowCanvas(cdp, '.settings-content');

  await cdp.eval(`document.querySelector('[data-testid="appearance-sidebar-background-picker"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-sidebar-background-popover"]')`);
  const pickerGeometry = await cdp.eval(`(()=>{const rect=document.querySelector('[data-testid="appearance-sidebar-background-popover"]').getBoundingClientRect();return{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()`);
  assert.equal(pickerGeometry.left >= 12 && pickerGeometry.top >= 12 && pickerGeometry.right <= pickerGeometry.viewportWidth - 12 && pickerGeometry.bottom <= pickerGeometry.viewportHeight - 12, true, JSON.stringify(pickerGeometry));
  await captureScreenshot(cdp, path.join(visualReview, 'appearance-color-picker-bounded-light-1440.png'));
  await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await wait(cdp, `!document.querySelector('[data-testid="appearance-sidebar-background-popover"]')`);

  await cdp.eval(`document.querySelector('[data-testid="appearance-workspace-background-mode"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-workspace-background-mode-option-GRADIENT"]')`);
  await cdp.eval(`document.querySelector('[data-testid="appearance-workspace-background-mode-option-GRADIENT"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-workspace-background-from-hex"]') && document.querySelector('[data-testid="appearance-workspace-background-to-hex"]')`);
  await cdp.eval(`(()=>{for(const [id,value] of [['appearance-workspace-background-from-hex','#FFFDF8'],['appearance-workspace-background-to-hex','#EEF7FF']]){const input=document.querySelector('[data-testid="'+id+'"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await wait(cdp, `document.documentElement.style.getPropertyValue('--fl-surface-content').includes('#FFFDF8') && document.documentElement.style.getPropertyValue('--fl-surface-content').includes('#EEF7FF')`);
  const workspaceGradient = await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.workspaceBackgroundGradientOverride`);
  assert.deepEqual(workspaceGradient, { from: '#FFFDF8', to: '#EEF7FF', bottomLeft: '#F7F2FC' });
  await captureScreenshot(cdp, path.join(visualReview, 'appearance-gradient-picker-light-1440.png'));

  await cdp.eval(`document.querySelector('[data-testid="appearance-reduced-motion"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-reduced-motion-option-REDUCE"]')`);
  await cdp.eval(`document.querySelector('[data-testid="appearance-reduced-motion-option-REDUCE"]').click()`);
  await wait(cdp, `document.documentElement.dataset.reduceMotion==='true'`);
  const persisted = await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2'))`);
  assert.equal(persisted.appearance.themePreference, 'LIGHT');
  assert.equal(persisted.appearance.reducedMotionPreference, 'REDUCE');

  await cdp.eval(`document.documentElement.dataset.material='solid'`);
  await wait(cdp, `getComputedStyle(document.querySelector('.settings-navigation')).backdropFilter==='none'`);
  const fallback = await cdp.eval(`(()=>{const style=getComputedStyle(document.querySelector('.settings-navigation'));return{backdrop:style.backdropFilter,background:style.backgroundColor,backgroundImage:style.backgroundImage,color:style.color};})()`);
  assert.equal(fallback.backdrop, 'none');
  assert.equal(await cdp.eval(`getComputedStyle(document.querySelector('.desktop-frame')).backgroundColor`), 'rgb(221, 238, 255)');
  await assertWindowCanvas(cdp, '.settings-content');
  await cdp.eval(`document.documentElement.dataset.material='glass'`);

  await cdp.eval(`document.querySelector('[data-testid="appearance-reset"]').click()`);
  await wait(cdp, `document.querySelector('[data-testid="appearance-reset-dialog"]')`);
  await cdp.eval(`document.querySelector('[data-testid="appearance-reset-dialog"] .dialog-confirm').click()`);
  await wait(cdp, `!JSON.parse(localStorage.getItem('fielora.ui.preferences.v2')).appearance.sidebarBackgroundOverride`);
  const reset = await cdp.eval(`JSON.parse(localStorage.getItem('fielora.ui.preferences.v2'))`);
  assert.equal(reset.appearance.themePreference, 'LIGHT');
  assert.equal(reset.appearance.reducedMotionPreference, 'REDUCE');
  assert.equal(reset.appearance.sidebarBackgroundOverride, null);
  assert.equal(reset.appearance.sidebarBackgroundGradientOverride, null);
  assert.equal(reset.appearance.workspaceBackgroundOverride, null);
  assert.equal(reset.appearance.workspaceBackgroundGradientOverride, null);
  assert.equal(reset.appearance.uiFontSize, 15);
  assert.equal(reset.appearance.codeFontSize, 13);
  assert.equal(reset.appearance.surfaceContrast, 42);
  assert.equal(reset.appearance.actionColorOverride, null);

  await cdp.eval(`(()=>{const saved=${JSON.stringify(originalPreferenceStorage)};if(saved.current===null)localStorage.removeItem('fielora.ui.preferences.v2');else localStorage.setItem('fielora.ui.preferences.v2',saved.current);if(saved.legacy===null)localStorage.removeItem('fielora.ui.preferences.v1');else localStorage.setItem('fielora.ui.preferences.v1',saved.legacy);})()`);
  preferenceStorageRestored = true;
  await cdp.eval('void window.fielora.core.quit()');
  cdp.close();
  await waitForChildExit(child);
  console.log('Fielora Glass appearance settings e2e: PASS');
} finally {
  if (cdp && !preferenceStorageRestored && originalPreferenceStorage) {
    try {
      await cdp.eval(`(()=>{const saved=${JSON.stringify(originalPreferenceStorage)};if(saved.current===null)localStorage.removeItem('fielora.ui.preferences.v2');else localStorage.setItem('fielora.ui.preferences.v2',saved.current);if(saved.legacy===null)localStorage.removeItem('fielora.ui.preferences.v1');else localStorage.setItem('fielora.ui.preferences.v1',saved.legacy);})()`);
    } catch {}
  }
  await cleanupElectronProcess(child);
  await rm(dataRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}
