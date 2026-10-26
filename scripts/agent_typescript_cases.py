"""Dependency-free TypeScript tasks. Hidden oracles never enter prepared projects.

Candidate code runs in disposable copies with a minimal environment. This is an
operator evaluator for trusted local work, not a hostile-code sandbox.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


LARGE_REQUEST = '''修复现有 TypeScript 收支报表中的计算和筛选错误，并补充真正调用业务函数的回归测试。
接口保持不变：rules.ts 的 signedCents(row)，report.ts 的 summarize(rows, options)。
金额是非负整数分；kind 为 charge 或 refund，退款记为负数。只汇总 status=posted 的记录。
options.from / to 是可选 YYYY-MM-DD，日期上下界均包含；owner 未提供时不限，提供时精确匹配，包括空字符串。
按 owner 汇总，结果为 {owner, cents} 数组，按 owner 字符串升序（使用 JavaScript < 比较）；净额为零的分组仍保留。
输入行和数组不能被修改。两个大文件中 BEGIN REGISTRY / END REGISTRY 之间是既有静态注册表，必须逐字保留；data/rows.json 和本需求也原样保留。
使用 Node.js 24 原生 TypeScript 和 node:test，不安装第三方包。运行 node --test，报告实际验证结果和未验证范围。仅在当前项目内工作。
'''

HTTP_REQUEST = '''修复 TypeScript 库 sync.ts 的 syncInventory(url, destination, {timeoutMs})，保持导出接口。
从 HTTP GET 读取库存 JSON 数组，成功时写入 destination，返回记录数量。每条记录必须有非空字符串 sku 和非负整数 quantity，sku 不能重复。
只接受 2xx；非 2xx 抛出 code=HTTP_ERROR；非法 JSON 或不合法数据抛出 code=INVALID_DATA；到期抛出 code=TIMEOUT；其他网络错误抛出 code=NETWORK_ERROR。
timeoutMs 覆盖请求和完整响应体读取，单位毫秒。不得自动重试。任何上述失败都必须逐字保留已有目标文件；目标原先不存在时也不得留下文件。
只有整个响应读取并验证通过后才能替换文件；返回前文件必须已可读取。不能修改调用者传入对象。保留 data/inventory.json 和本需求原样。
使用 Node.js 24 内置 fetch、文件 API 和 node:test，不增加依赖。补充真实本地 HTTP 服务、临时文件的测试，运行 node --test，报告实际覆盖与限制。仅在当前项目内工作。
'''

ROW_TYPE = "export type Row = {owner: string; date: string; cents: number; kind: 'charge'|'refund'; status: 'posted'|'draft'};\n"
OPTIONS = "export type Options = {from?: string; to?: string; owner?: string};\n"


def registry(name):
    # Distinct configuration entries create realistic bounded-read pressure.
    rows = ['// BEGIN REGISTRY', 'export const ' + name + ' = {']
    for index in range(240):
        rows.extend(['  "R%04d": {' % index, '    label: "Region %04d",' % index,
                     '    basisPoints: %d,' % (index * 7 % 2400), '  },'])
    return '\n'.join(rows + ['} as const;', '// END REGISTRY', ''])


RULES_BODY = '''export function signedCents(row: Row): number {
  return row.cents;
}
'''
REPORT_BODY = '''export function summarize(rows: Row[], options: Options = {}): {owner: string; cents: number}[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (options.from && row.date <= options.from) continue;
    if (options.to && row.date >= options.to) continue;
    if (options.owner && row.owner !== options.owner) continue;
    totals.set(row.owner, (totals.get(row.owner) ?? 0) + signedCents(row));
  }
  return [...totals].map(([owner, cents]) => ({owner, cents}));
}
'''
RULES_REFERENCE = RULES_BODY.replace('return row.cents;', "return row.kind === 'refund' ? -row.cents : row.cents;")
REPORT_REFERENCE = '''export function summarize(rows: Row[], options: Options = {}): {owner: string; cents: number}[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'posted') continue;
    if (options.from !== undefined && row.date < options.from) continue;
    if (options.to !== undefined && row.date > options.to) continue;
    if (options.owner !== undefined && row.owner !== options.owner) continue;
    totals.set(row.owner, (totals.get(row.owner) ?? 0) + signedCents(row));
  }
  return [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([owner, cents]) => ({owner, cents}));
}
'''
HTTP_SEED = '''import {writeFile} from 'node:fs/promises';
export async function syncInventory(url: string, destination: string, options: {timeoutMs: number}): Promise<number> {
  const response = await fetch(url);
  const rows = await response.json();
  await writeFile(destination, JSON.stringify(rows));
  return rows.length;
}
'''
HTTP_REFERENCE = '''import {writeFile} from 'node:fs/promises';
export async function syncInventory(url: string, destination: string, options: {timeoutMs: number}): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const fail = (code: string) => Object.assign(new Error(code), {code});
  let rows: unknown;
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw fail('HTTP_ERROR');
    const text = await response.text();
    try { rows = JSON.parse(text); } catch { throw fail('INVALID_DATA'); }
    const seen = new Set<string>();
    if (!Array.isArray(rows) || !rows.every(row => {
      if (!row || typeof row.sku !== 'string' || row.sku.length === 0 ||
          !Number.isInteger(row.quantity) || row.quantity < 0 || seen.has(row.sku)) return false;
      seen.add(row.sku); return true;
    })) throw fail('INVALID_DATA');
  } catch (error) {
    if (controller.signal.aborted) throw fail('TIMEOUT');
    if (['HTTP_ERROR', 'INVALID_DATA'].includes((error as {code?: string}).code ?? '')) throw error;
    throw fail('NETWORK_ERROR');
  } finally { clearTimeout(timer); }
  await writeFile(destination, JSON.stringify(rows));
  return (rows as unknown[]).length;
}
'''
SMOKE_LARGE = '''import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize} from './report.ts';
test('one charge', () => assert.deepEqual(summarize([{owner:'A', date:'2026-01-01', cents:12, kind:'charge', status:'posted'}]), [{owner:'A', cents:12}]));
test('empty', () => assert.deepEqual(summarize([]), []));
'''
SMOKE_HTTP = '''import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syncInventory} from './sync.ts';
test('basic successful request', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'inventory-'));
 const server = createServer((_req, res) => res.end('[{"sku":"A","quantity":1}]'));
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  assert.equal(await syncInventory(`http://127.0.0.1:${(server.address() as {port:number}).port}`, join(dir,'stock'), {timeoutMs:1000}), 1);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'stock'), 'utf8')), [{sku:'A',quantity:1}]);
 } finally {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, {recursive:true, force:true});}
});
'''

ORACLE_HEADER = '''import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root = process.argv[2];
const outcomes = [];
async function check(name, fn) {
 try {await fn(); outcomes.push({name, passed:true});}
 catch (e) {outcomes.push({name, passed:false, kind:e?.code === 'ERR_ASSERTION' ? 'ASSERTION' : 'RUNTIME', error:String(e).slice(0,400)});}
}
'''
LARGE_ORACLE = ORACLE_HEADER + '''const {summarize} = await import(pathToFileURL(join(root, 'report.ts')));
const {signedCents} = await import(pathToFileURL(join(root, 'rules.ts')));
const row = (owner, cents, extra={}) => ({owner, cents, date:'2026-02-10', kind:'charge', status:'posted', ...extra});
await check('refund function', () => assert.equal(signedCents(row('A', 43, {kind:'refund'})), -43));
await check('draft excluded', () => assert.deepEqual(summarize([row('A',9,{status:'draft'})]), []));
await check('inclusive dates', () => assert.deepEqual(summarize([row('A',17)], {from:'2026-02-10',to:'2026-02-10'}), [{owner:'A',cents:17}]));
await check('date range', () => assert.deepEqual(summarize([row('A',2,{date:'2026-02-09'}),row('A',7),row('B',11,{date:'2026-02-11'})], {from:'2026-02-10',to:'2026-02-10'}), [{owner:'A',cents:7}]));
await check('empty owner exact', () => assert.deepEqual(summarize([row('',5),row('A',3)],{owner:''}), [{owner:'',cents:5}]));
await check('combined filters', () => assert.deepEqual(summarize([row('a',5),row('A',3),row('a',7,{status:'draft'})],{owner:'a',to:'2026-02-10'}), [{owner:'a',cents:5}]));
await check('ordered net totals', () => assert.deepEqual(summarize([row('中',4),row('Z',10),row('Z',13,{kind:'refund'}),row('A',8)]), [{owner:'A',cents:8},{owner:'Z',cents:-3},{owner:'中',cents:4}]));
await check('zero group', () => assert.deepEqual(summarize([row('N',19),row('N',19,{kind:'refund'})]), [{owner:'N',cents:0}]));
await check('input untouched', () => {const rows=[row('B',4),row('A',8)]; const before=structuredClone(rows); summarize(rows,{owner:'A'}); assert.deepEqual(rows,before);});
await check('empty result', () => assert.deepEqual(summarize([row('A',1)],{owner:'unknown'}), []));
console.log(JSON.stringify({outcomes, passed:outcomes.every(x=>x.passed)}));
'''
HTTP_ORACLE = ORACLE_HEADER + '''import {createServer} from 'node:http';
import {readFile, writeFile, mkdtemp, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const {syncInventory} = await import(pathToFileURL(join(root, 'sync.ts')));
const dir = await mkdtemp(join(tmpdir(), 'inventory-oracle-'));
const destination = join(dir,'saved.json');
const original = Buffer.from('  [{"sku":"unchanged","quantity":71}]\\n');
let calls = 0;
let respond = (_req, res) => res.end('[]');
const timers = new Set();
const server = createServer((req,res) => {calls++; respond(req,res);});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}`;
async function failure(name, code, handler, address=url, exists=true) {
 await check(name, async () => {
  if (exists) await writeFile(destination, original); else await rm(destination,{force:true});
  respond=handler; const before=calls; let caught;
  const options={timeoutMs:100};
  const start=performance.now();
  try {await syncInventory(address,destination,options);} catch (e) {caught=e;}
  assert.equal(caught?.code,code,'stable error code');
  assert.deepEqual(options,{timeoutMs:100});
  if (code==='TIMEOUT') assert.ok(performance.now()-start < 1200,'timeout enforced');
  if (exists) assert.deepEqual(await readFile(destination),original,'existing bytes preserved');
  else {let present=true; try {await access(destination);} catch {present=false;} assert.equal(present,false);}
  assert.equal(calls-before,address===url ? 1 : 0,'no retry');
 });
}
try {
 await check('success complete data', async () => {
  const rows=[{sku:'B,中',quantity:0},{sku:'A',quantity:17}];
  respond=(_q,r)=>r.end(JSON.stringify(rows)); const before=calls;
  await writeFile(destination,original);
  assert.equal(await syncInventory(url,destination,{timeoutMs:1000}),2);
  assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),rows); assert.equal(calls-before,1);
 });
 await failure('503 preserves data','HTTP_ERROR',(_q,r)=>{r.statusCode=503;r.end('[{"sku":"bad","quantity":1}]');});
 await failure('malformed JSON','INVALID_DATA',(_q,r)=>r.end('{'));
 for (const [name, body] of [
  ['wrong shape',{}],['string quantity',[{sku:'A',quantity:'2'}]],['negative quantity',[{sku:'A',quantity:-1}]],
  ['fraction quantity',[{sku:'A',quantity:1.5}]],['duplicate sku',[{sku:'A',quantity:1},{sku:'A',quantity:2}]],
  ['empty sku',[{sku:'',quantity:1}]],['missing quantity',[{sku:'A'}]],['boolean quantity',[{sku:'A',quantity:true}]]
 ]) await failure(name,'INVALID_DATA',(_q,r)=>r.end(JSON.stringify(body)));
 const delayed = (headers) => (_q,r)=>{if(headers){r.writeHead(200);r.write('[');} const t=setTimeout(()=>r.end(headers ? ']' : '[]'),600);timers.add(t);};
 await failure('headers timeout','TIMEOUT',delayed(false));
 await failure('body timeout','TIMEOUT',delayed(true));
 // Bind then close a unique port instead of assuming any fixed port is unused.
 const unused=createServer(); await new Promise(resolve=>unused.listen(0,'127.0.0.1',resolve));
 const port=unused.address().port; await new Promise(resolve=>unused.close(resolve));
 await failure('network failure','NETWORK_ERROR',()=>{},`http://127.0.0.1:${port}`);
 await failure('failed new destination absent','INVALID_DATA',(_q,r)=>r.end('null'),url,false);
 await check('empty inventory success',async()=>{respond=(_q,r)=>r.end('[]'); assert.equal(await syncInventory(url,destination,{timeoutMs:1000}),0);assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),[]);});
} finally {for(const timer of timers) clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({outcomes,passed:outcomes.every(x=>x.passed)}));
'''


def files_for(case, reference=False):
    files = {'package.json': '{"private":true,"type":"module","scripts":{"test":"node --test"},"engines":{"node":">=24"}}\n'}
    if case == 'large-files':
        files.update({'rules.ts': ROW_TYPE + registry('feeRegistry') + (RULES_REFERENCE if reference else RULES_BODY),
                      'report.ts': "import {signedCents, type Row} from './rules.ts';\n" + OPTIONS + registry('reportRegistry') + (REPORT_REFERENCE if reference else REPORT_BODY),
                      'existing.test.ts': SMOKE_LARGE, 'REQUEST.txt': LARGE_REQUEST,
                      'data/rows.json': '[{"owner":"Example","cents":100,"date":"2026-01-01","kind":"charge","status":"posted"}]\n'})
    elif case == 'http-protection':
        files.update({'sync.ts': HTTP_REFERENCE if reference else HTTP_SEED, 'existing.test.ts': SMOKE_HTTP,
                      'REQUEST.txt': HTTP_REQUEST, 'data/inventory.json': '[{"sku":"KEEP","quantity":3}]\n'})
    else:
        raise ValueError('unknown case')
    return files


def prepare(project, case):
    project.mkdir(parents=True, exist_ok=False)
    files = files_for(case)
    for name, content in files.items():
        target = project / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    return {name: hashlib.sha256((project / name).read_bytes()).hexdigest() for name in files}


def safe_environment():
    return {name: os.environ[name] for name in ('PATH', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG') if name in os.environ}


def run_node(project, source=None):
    with tempfile.TemporaryDirectory(prefix='fielora-ts-oracle-') as folder:
        copied = Path(folder) / 'project'
        shutil.copytree(project, copied, ignore=shutil.ignore_patterns('.git', 'node_modules'))
        if source is None:
            args = ['node', '--test']
        else:
            runner = Path(folder) / 'oracle.mjs'
            runner.write_text(source, encoding='utf-8')
            args = ['node', str(runner), str(copied)]
        try:
            result = subprocess.run(args, cwd=copied, env=safe_environment(), capture_output=True, text=True, timeout=25)
        except subprocess.TimeoutExpired:
            return {'passed': False, 'kind': 'TIMEOUT'}
        if source is None:
            return {'passed': result.returncode == 0, 'scope': 'Submitted tests only; independent coverage not inferred',
                    'stdout': result.stdout[-6000:], 'stderr': result.stderr[-2000:]}
        if result.returncode != 0:
            return {'passed': False, 'kind': 'RUNTIME', 'stderr': result.stderr[-2000:]}
        return json.loads(result.stdout.strip().splitlines()[-1])


def oracle(project, case):
    report = run_node(project, LARGE_ORACLE if case == 'large-files' else HTTP_ORACLE)
    checks = report.setdefault('outcomes', [])
    for name, content in files_for(case).items():
        if not (name == 'REQUEST.txt' or name.startswith('data/')):
            continue
        passed = (project / name).is_file() and (project / name).read_bytes() == content.encode('utf-8')
        checks.append({'name': 'protected ' + name, 'passed': passed, 'kind': 'ASSERTION'})
    if case == 'large-files':
        for filename, name in [('rules.ts', 'feeRegistry'), ('report.ts', 'reportRegistry')]:
            text = (project / filename).read_text(encoding='utf-8')
            checks.append({'name': 'protected registry ' + filename, 'passed': registry(name) in text, 'kind': 'ASSERTION'})
    report['passed'] = report.get('passed', False) and all(check['passed'] for check in checks)
    return report


def self_test(case):
    with tempfile.TemporaryDirectory(prefix='fielora-ts-selftest-') as folder:
        project = Path(folder) / 'project'
        prepare(project, case)
        assert run_node(project)['passed'], 'seed smoke must pass'
        seed = oracle(project, case)
        assert not seed['passed'], 'unfinished seed must fail independent acceptance'
        references = files_for(case, reference=True)
        for name, content in references.items():
            (project / name).write_text(content, encoding='utf-8')
        good = oracle(project, case)
        assert good['passed'], good
        faults = [
            ('refund_sign', 'rules.ts', "row.kind === 'refund' ? -row.cents : row.cents", 'row.cents'),
            ('draft_included', 'report.ts', "if (row.status !== 'posted') continue;", ''),
            ('exclusive_lower_date', 'report.ts', 'row.date < options.from', 'row.date <= options.from'),
            ('exclusive_upper_date', 'report.ts', 'row.date > options.to', 'row.date >= options.to'),
            ('empty_owner_ignored', 'report.ts', 'options.owner !== undefined', '!!options.owner'),
            ('wrong_order', 'report.ts', 'a < b ? -1 : a > b ? 1 : 0', 'a < b ? 1 : a > b ? -1 : 0'),
        ] if case == 'large-files' else [
            ('http_error_ignored', 'sync.ts', "if (!response.ok) throw fail('HTTP_ERROR');", ''),
            ('negative_accepted', 'sync.ts', 'row.quantity < 0 || ', ''),
            ('duplicate_accepted', 'sync.ts', 'seen.has(row.sku)', 'false'),
            ('timeout_ignored', 'sync.ts', 'options.timeoutMs);', '2000);'),
            ('wrong_error_code', 'sync.ts', "throw fail('INVALID_DATA')", "throw fail('HTTP_ERROR')"),
            ('data_destroyed_before_validation', 'sync.ts', 'const controller = new AbortController();', "await writeFile(destination, '[]');\n  const controller = new AbortController();"),
        ]
        rejected = []
        for name, filename, before, after in faults:
            content = references[filename]
            assert before in content, name
            (project / filename).write_text(content.replace(before, after), encoding='utf-8')
            bad = oracle(project, case)
            failed = [row for row in bad['outcomes'] if not row['passed']]
            assert failed and all(row['kind'] == 'ASSERTION' for row in failed), (name, bad)
            rejected.append(name)
            (project / filename).write_text(content, encoding='utf-8')
        return {'status': 'PASS', 'case': case, 'checks': len(good['outcomes']), 'reference_passed': True,
                'unfinished_seed_rejected': True, 'rejected_faults': rejected, 'real_model': 'NOT_RUN'}


def main(action, project, case):
    if action == 'self-test':
        record = self_test(case)
    elif project is None:
        raise ValueError('project path required')
    elif action == 'prepare':
        record = {'sha256': prepare(project, case), 'real_model': 'NOT_RUN'}
    elif action == 'verify-tests':
        record = run_node(project)
    else:
        record = oracle(project, case)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0 if record.get('passed', True) else 1
