import assert from 'node:assert/strict';
import test from 'node:test';
import { installedFontMenu } from './font-menu.ts';

test('font menus reflect only native families, preserve installed legacy selections and isolate monospace choices', () => {
  const catalog = { install_directory: '/fonts', families: [{family:'PingFang SC',monospace:false},{family:'Menlo',monospace:true},{family:'Academy Engraved LET',monospace:false}] };
  const ui = installedFontMenu(catalog, 'PINGFANG_SC', false, 'System');
  assert.equal(ui.value, 'LOCAL:PingFang SC');
  assert.deepEqual(ui.options.map(f => f.label), ['System', 'Academy Engraved LET', 'Menlo', 'PingFang SC']);
  const missing = installedFontMenu(catalog, 'MICROSOFT_YAHEI', false, 'System');
  assert.equal(missing.value, 'SYSTEM');
  assert.equal(missing.missing, true);
  assert.deepEqual(missing.options, ui.options);
  assert.deepEqual(installedFontMenu(catalog, 'LOCAL:Menlo', true, 'System').options.map(f => f.label), ['System', 'Menlo']);
  assert.equal(installedFontMenu(null, 'PINGFANG_SC', false, 'System').missing, false);
});
