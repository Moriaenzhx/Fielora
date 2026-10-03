import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = import.meta.dirname;
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');
const chrome = read('DesktopChrome.tsx');
const browser = read('BrowseScreen.tsx');
const library = read('LibraryScreen.tsx');
const settings = read('SettingsScreen.tsx');
const storage = read('StorageDataSettings.tsx');
const styles = read('styles.css');

test('global routes omit workspace controls while workspace contexts retain them', () => {
  assert.match(chrome, /route\.route === 'NOW' \|\| route\.route === 'LIBRARY' \|\| settingsRoute/);
  assert.match(chrome, /workspaceControlsVisible = !globalPageRoute \|\| toolsOpen/);
  assert.match(chrome, /workspaceControlsVisible && <aside className=\{`utility-control-dock/);
  assert.match(chrome, /data-surface-context=\{workspaceControlsVisible \? 'workspace' : 'global'\}/);
  assert.match(library, /collection-page/);
  assert.match(library, /在浏览网页时保存到资料库/);
});

test('Browser narrow layout keeps three toolbar columns and exposes complete menu copy', () => {
  assert.match(styles, /\.browser-toolbar \{[^\n]*grid-template-columns: auto minmax\(0,1fr\) auto/);
  assert.doesNotMatch(styles, /\.browser-toolbar \{[^\n]*grid-template-columns: auto minmax\((?:120|180)px,1fr\)/);
  assert.match(styles, /\.browser-toolbar-end \{[^\n]*flex-wrap: nowrap/);
  for (const label of ['新建标签页', '保存到资料库', '刷新页面', '关闭标签页', '浏览器设置']) assert.match(browser, new RegExp(label));
});

test('Browser settings use product copy and do not claim password persistence', () => {
  for (const phrase of ['启动时恢复浏览器', '启动 Fielora 时恢复上次打开的浏览页面', '搜索引擎', 'Cookie 和网站登录状态']) assert.match(settings, new RegExp(phrase));
  for (const internal of ['Browser Runtime', 'Browser Policy', 'Projects 右侧', 'Cookie、密码']) assert.doesNotMatch(settings, new RegExp(internal));
});

test('Storage UI reuses shared controls and keeps physical storage truth visible', () => {
  assert.match(storage, /import \{ Button, SettingsToggle \} from '\.\/UiPrimitives'/);
  assert.match(storage, /testId="backup-include-library-toggle"/);
  assert.doesNotMatch(storage, /type="checkbox"/);
  assert.doesNotMatch(storage, /从 Chrome 导入/);
  assert.match(storage, /storage-profile-metadata/);
  assert.doesNotMatch(storage, /Profile \{profile\?\.profile_id/);
  for (const label of ['主 SQLite 数据库', 'Agent 账本', '资料库 Blob 存储', '向量索引', '搜索索引', '内部仓库索引', '缓存']) assert.match(storage, new RegExp(label));
  assert.match(storage, /if \(state === 'NOT_PRESENT'\) return '未启用 \/ 不存在'/);
  assert.match(storage, /directoryDetails\.has\(detail\.id\) \? '打开' : '打开所在位置'/);
  assert.match(storage, /function StorageLocation/);
  assert.match(storage, /className="storage-location-path"/);
  assert.doesNotMatch(storage, /storage-root-row/);
  assert.match(storage, /Button variant="secondary"[^\n]*打开文件夹<\/Button><Button variant="ghost"[^\n]*更改位置<\/Button>/);
  assert.equal(storage.match(/>打开文件夹<\/Button>/g)?.length, 2);
  assert.match(storage, /Button variant="ghost"[^\n]*复制路径<\/Button>/);
});
