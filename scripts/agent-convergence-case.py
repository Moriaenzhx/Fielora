#!/usr/bin/env python3
"""Prepare/verify a local interactive task. Never invokes a provider or an Agent.

The oracle lives outside the Agent's project. A green project test suite alone
cannot satisfy it. All SQLite operations use private temporary databases.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sqlite3
import sys
import tempfile
import unittest

SOURCE = '''import json
import sqlite3

def connect(path):
    c = sqlite3.connect(path)
    c.executescript("""CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, client_id TEXT, contract INTEGER, paid INTEGER);
    CREATE TABLE IF NOT EXISTS issues(id INTEGER PRIMARY KEY, detail TEXT);""")
    return c

def outstanding(path, client_id):
    with connect(path) as c:
        rows = c.execute("SELECT contract,paid FROM projects WHERE client_id=?", (client_id,)).fetchall()
    return max(sum(a for a,b in rows) - sum(b for a,b in rows), 0)

def import_client(path, client_id, name):
    c = connect(path)
    old = c.execute("SELECT name FROM clients WHERE id=?", (client_id,)).fetchone()
    if old and old[0] != name:
        c.execute("INSERT INTO issues(detail) VALUES (?)", ("conflict:" + client_id,))
        c.close()
        return "conflict"
    c.execute("INSERT OR IGNORE INTO clients VALUES (?,?)", (client_id, name))
    c.commit()
    c.close()
    return "ok"

def export_all(path):
    with connect(path) as c:
        return {"clients":c.execute("SELECT id,name FROM clients ORDER BY id").fetchall(),
                "projects":c.execute("SELECT id,client_id,contract,paid FROM projects ORDER BY id").fetchall(),
                "issues":c.execute("SELECT id,detail FROM issues ORDER BY id").fetchall()}

def restore_all(path, data):
    with connect(path) as c:
        c.execute("DELETE FROM issues")
        c.execute("DELETE FROM projects")
        c.execute("DELETE FROM clients")
        c.executemany("INSERT INTO clients VALUES (?,?)", data.get("clients", []))
        c.executemany("INSERT INTO projects VALUES (?,?,?,?)", data.get("projects", []))
        c.executemany("INSERT INTO issues VALUES (?,?)", data.get("issues", []))
'''

SMOKE = '''import tempfile, unittest
from pathlib import Path
import ledger
class Smoke(unittest.TestCase):
 def test_summary(self):
  with tempfile.TemporaryDirectory() as d:
   self.assertGreaterEqual(ledger.outstanding(str(Path(d)/'db'), 'C006'), 0)
 def test_import(self):
  with tempfile.TemporaryDirectory() as d:
   db=str(Path(d)/'db')
   ledger.import_client(db,'C006','original')
   self.assertEqual(ledger.import_client(db,'C006','changed'),'conflict')
'''

REQUEST = '''请修复当前项目的三个问题，并补充能够区分这些缺陷的回归测试：
1. 客户待回款按每个项目 max(合同额-回款,0) 求和，超收不抵消其他项目欠款。
2. 同 ID 不同内容的客户导入必须保留原记录，并持久保存冲突；关闭连接并重新启动进程后仍存在。
3. 恢复备份先验证结构、类型、重复 ID 和关联，拒绝非法内容时完整保留数据库。合法备份完整替换，重复恢复不叠加。客户名称必须是字符串，金额必须是非负整数且不接受布尔值。
所有验证使用临时数据库，保留 input.csv。检查现有断言实际覆盖了什么，不要只凭退出码或返回计数判断完成；报告通过的场景与未验证范围。已经正确的行为只需补回归，不必人为改坏代码。
'''

FIXES = {
    "outstanding": (
        "return max(sum(a for a,b in rows) - sum(b for a,b in rows), 0)",
        "return sum(max(a-b, 0) for a,b in rows)"),
    "conflict": ("        c.close()\n        return \"conflict\"",
                 "        c.commit()\n        c.close()\n        return \"conflict\""),
    "restore": ("def restore_all(path, data):\n", '''def restore_all(path, data):
    if not isinstance(data, dict) or any(not isinstance(data.get(k), list) for k in ('clients','projects','issues')):
        raise ValueError('invalid structure')
    clients, projects, issues = data['clients'], data['projects'], data['issues']
    for row in clients:
        if not isinstance(row, (list, tuple)) or len(row)!=2 or any(not isinstance(v,str) or not v for v in row):
            raise ValueError('invalid client')
    for row in projects:
        if not isinstance(row, (list, tuple)) or len(row)!=4 or any(not isinstance(v,str) or not v for v in row[:2]) or any(type(v) is not int or v<0 for v in row[2:]):
            raise ValueError('invalid project')
    for row in issues:
        if not isinstance(row, (list, tuple)) or len(row)!=2 or type(row[0]) is not int or not isinstance(row[1],str):
            raise ValueError('invalid issue')
    if any(len({r[0] for r in rows}) != len(rows) for rows in (clients,projects,issues)):
        raise ValueError('duplicate id')
    if any(r[1] not in {c[0] for c in clients} for r in projects):
        raise ValueError('invalid association')
'''),
}


def oracle(project):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("case_ledger", project / "ledger.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class Acceptance(unittest.TestCase):
        def setUp(self):
            self.temp = tempfile.TemporaryDirectory()
            self.addCleanup(self.temp.cleanup)
            self.db = str(Path(self.temp.name) / "isolated.db")
            with contextlib.closing(module.connect(self.db)) as c:
                c.execute("INSERT INTO clients VALUES ('C006','original')")
                c.executemany("INSERT INTO projects VALUES (?,?,?,?)", [
                    ('over', 'C006', 10000, 13000), ('pending', 'C006', 15000, 0)])
                c.commit()

        def test_project_outstanding(self):
            self.assertEqual(module.outstanding(self.db, 'C006'), 15000)

        def test_conflict_survives_process_exit(self):
            subprocess.run([sys.executable, '-B', '-c',
                'import ledger,sys; assert ledger.import_client(sys.argv[1],"C006","changed")=="conflict"',
                self.db], cwd=project, check=True, timeout=10, capture_output=True)
            state = module.export_all(self.db)
            self.assertEqual(state['clients'], [('C006', 'original')])
            self.assertEqual(len(state['issues']), 1)
            self.assertIn('C006', state['issues'][0][1])

        def test_invalid_restore_preserves_all_content(self):
            valid = {'clients': [['new', 'valid']], 'projects': [['p', 'new', 90, 20]], 'issues': [[1, 'old issue']]}
            invalid = [{}, {'clients': []}, dict(valid, clients=None),
                dict(valid, clients=[['new', 12345]]),
                dict(valid, clients=[['new','valid'], ['new','duplicate']]),
                dict(valid, projects=[['p','missing',90,20]]),
                dict(valid, projects=[['p','new',True,20]]),
                dict(valid, projects=[['p','new',-1,20]]),
                dict(valid, issues=[[1,'one'],[1,'duplicate']])]
            original = module.export_all(self.db)
            for data in invalid:
                with self.subTest(data=data):
                    with self.assertRaises((ValueError, TypeError)):
                        module.restore_all(self.db, data)
                    self.assertEqual(module.export_all(self.db), original)

        def test_valid_restore_replaces_content_idempotently(self):
            data = {'clients': [['new', 'valid']], 'projects': [['p','new',90,20]], 'issues': [[8,'new issue']]}
            expected = {k: [tuple(r) for r in rows] for k, rows in data.items()}
            for _ in range(2):
                module.restore_all(self.db, data)
                self.assertEqual(module.export_all(self.db), expected)

        def test_restore_rolls_back_an_insertion_error(self):
            original = module.export_all(self.db)
            with contextlib.closing(module.connect(self.db)) as c:
                c.execute("CREATE TRIGGER reject_new BEFORE INSERT ON projects WHEN NEW.id='new-project' BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
                c.commit()
            with self.assertRaises(sqlite3.DatabaseError):
                module.restore_all(self.db, {'clients': [['new','valid']], 'projects': [['new-project','new',90,20]], 'issues': []})
            self.assertEqual(module.export_all(self.db), original)

        def test_original_input_unchanged(self):
            self.assertEqual((project / 'input.csv').read_bytes(), b'id,name\nC006,original\n')

    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance))
    return result, output.getvalue()


def prepare(project, source=SOURCE):
    project.mkdir(parents=True, exist_ok=False)
    (project / 'ledger.py').write_text(source)
    (project / 'test_smoke.py').write_text(SMOKE)
    (project / 'input.csv').write_bytes(b'id,name\nC006,original\n')
    (project / 'REQUEST.txt').write_text(REQUEST)
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(project.iterdir())}


def verify_regressions(project):
    """Run submitted tests in copies with controlled behavioral faults.

    Baseline must pass; each fault must cause an assertion failure (an import or
    runtime error does not demonstrate useful discrimination). No project file
    or live database is mutated by this verifier.
    """
    runner = r'''
import contextlib, json, sys, unittest
import ledger
variant = sys.argv[1]
if variant == 'outstanding':
 def wrong_summary(path, client_id):
  with contextlib.closing(ledger.connect(path)) as c:
   rows=c.execute('SELECT contract,paid FROM projects WHERE client_id=?',(client_id,)).fetchall()
  return max(sum(a-b for a,b in rows),0)
 ledger.outstanding=wrong_summary
elif variant == 'conflict':
 original=ledger.import_client
 def forget_conflict(path, client_id, name):
  result=original(path,client_id,name)
  with contextlib.closing(ledger.connect(path)) as c:
   c.execute('DELETE FROM issues'); c.commit()
  return result
 ledger.import_client=forget_conflict
elif variant == 'restore':
 original=ledger.restore_all
 def unsafe_restore(path, data):
  if data == {}:
   with contextlib.closing(ledger.connect(path)) as c:
    for table in ('issues','projects','clients'): c.execute('DELETE FROM '+table)
    c.commit()
   return
  return original(path,data)
 ledger.restore_all=unsafe_restore
result=unittest.TextTestRunner(verbosity=0).run(unittest.defaultTestLoader.discover('.'))
report={'variant':variant,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped)}
print('FIELORA_REGRESSION_RESULT='+json.dumps(report))
sys.exit(0 if result.testsRun>0 and (result.wasSuccessful() if variant=='baseline' else bool(result.failures) and not result.errors) else 1)
'''
    reports = []
    mutation_start = runner.index("if variant == 'outstanding':")
    mutation_end = runner.index('result=unittest.TextTestRunner')
    mutation = runner[mutation_start:mutation_end]
    runner = runner[:mutation_start] + runner[mutation_end:]
    with tempfile.TemporaryDirectory() as directory:
        for variant in ('baseline', 'outstanding', 'conflict', 'restore'):
            copy = Path(directory) / variant
            shutil.copytree(project, copy, ignore=shutil.ignore_patterns('__pycache__', '.git', '.venv'))
            if variant != 'baseline':
                # Faults apply to child interpreters too, so a genuine restart
                # regression is not incorrectly labelled an ineffective test.
                module = copy / 'ledger.py'
                module.write_text(module.read_text() + '\n\n# Isolated fault injection.\n'
                    + 'import contextlib, sys\nledger=sys.modules[__name__]\nvariant='
                    + repr(variant) + '\n' + mutation)
            process = subprocess.run([sys.executable, '-B', '-c', runner, variant], cwd=copy,
                capture_output=True, text=True, timeout=30)
            marker = next((line for line in reversed(process.stdout.splitlines())
                if line.startswith('FIELORA_REGRESSION_RESULT=')), None)
            report = json.loads(marker.split('=', 1)[1]) if marker else {'variant': variant, 'runner_result': 'unavailable'}
            report['discrimination_passed'] = process.returncode == 0
            reports.append(report)
    return reports


def self_test():
    fixed = SOURCE
    for before, after in FIXES.values():
        assert before in fixed
        fixed = fixed.replace(before, after, 1)
    reports = []
    with tempfile.TemporaryDirectory() as temp:
        cases = {'seed': SOURCE, 'correct': fixed}
        cases.update({name: fixed.replace(after, before, 1) for name, (before, after) in FIXES.items()})
        for name, code in cases.items():
            project = Path(temp) / name
            prepare(project, code)
            smoke = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_smoke'], cwd=project, capture_output=True, timeout=10)
            assert smoke.returncode == 0, smoke.stderr.decode()
            result, output = oracle(project)
            failures = [case.id().split('.')[-1] for case, _ in result.failures + result.errors]
            expected = {'seed': {'test_project_outstanding','test_conflict_survives_process_exit','test_invalid_restore_preserves_all_content'},
                'correct': set(), 'outstanding': {'test_project_outstanding'},
                'conflict': {'test_conflict_survives_process_exit'}, 'restore': {'test_invalid_restore_preserves_all_content'}}[name]
            # subTest IDs include parameters; compare the named test prefix.
            actual = {name.split(' (', 1)[0] for name in failures}
            assert actual == expected, output
            reports.append({'variant': name, 'project_smoke': 'PASS', 'oracle_failed_cases': sorted(actual)})
        weak = verify_regressions(Path(temp) / 'correct')
        assert [r['discrimination_passed'] for r in weak] == [True, False, False, False], weak
        # A submitted independent regression suite must detect all three
        # behavioral faults; this also checks the mutation runner itself.
        (Path(temp) / 'correct' / 'test_regression.py').write_text('''import unittest,tempfile,subprocess,sys
from pathlib import Path
import ledger
class Regression(unittest.TestCase):
 def test_summary(self):
  with tempfile.TemporaryDirectory() as d:
   db=str(Path(d)/'db')
   with ledger.connect(db) as c:
    c.executemany('INSERT INTO projects VALUES (?,?,?,?)',[('a','c',100,150),('b','c',60,0)])
   self.assertEqual(ledger.outstanding(db,'c'),60)
 def test_conflict(self):
  with tempfile.TemporaryDirectory() as d:
   db=str(Path(d)/'db'); ledger.import_client(db,'c','one')
   subprocess.run([sys.executable,'-B','-c','import ledger,sys; ledger.import_client(sys.argv[1],"c","two")',db],check=True)
   self.assertEqual(len(ledger.export_all(db)['issues']),1)
 def test_restore(self):
  with tempfile.TemporaryDirectory() as d:
   db=str(Path(d)/'db'); ledger.import_client(db,'c','one'); before=ledger.export_all(db)
   with self.assertRaises(ValueError): ledger.restore_all(db,{})
   self.assertEqual(ledger.export_all(db),before)
''')
        strong = verify_regressions(Path(temp) / 'correct')
        assert all(r['discrimination_passed'] for r in strong), strong
        reports.append({'weak_regressions': weak, 'strong_regressions': strong})
    print(json.dumps({'scope': 'Independent oracle discrimination; zero provider calls', 'status':'PASS', 'variants':reports}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify', 'verify-tests', 'self-test'])
    parser.add_argument('project', nargs='?', type=Path)
    parser.add_argument('--already-fixed', action='store_true', help='Prepare correct behavior with insufficient tests; interactive regression task')
    parser.add_argument('--case', choices=['ledger', 'detector', 'task-export', 'large-files', 'http-protection', 'cold-recovery', 'midrun-correction'], default='ledger')
    parser.add_argument('--control-evidence', type=Path, help='External controller receipts for lifecycle cases; never a file in the candidate project')
    args = parser.parse_args()
    if args.control_evidence is not None and args.case not in ('cold-recovery', 'midrun-correction'):
        parser.error('--control-evidence requires a lifecycle case')
    if args.case in ('cold-recovery', 'midrun-correction'):
        import agent_lifecycle_cases
        sys.exit(agent_lifecycle_cases.main(args.action, args.project, args.case, args.control_evidence))
    if args.case in ('large-files', 'http-protection'):
        import agent_typescript_cases
        sys.exit(agent_typescript_cases.main(args.action, args.project, args.case))
    if args.case == 'detector':
        import agent_detector_case
        sys.exit(agent_detector_case.main(args.action, args.project))
    if args.case == 'task-export':
        import agent_task_export_case
        sys.exit(agent_task_export_case.main(args.action, args.project))
    if args.action == 'self-test':
        self_test()
    elif args.project is None:
        parser.error('project path required')
    elif args.action == 'verify-tests':
        reports = verify_regressions(args.project.resolve())
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        sys.exit(0 if all(r['discrimination_passed'] for r in reports) else 1)
    elif args.action == 'prepare':
        source = SOURCE
        if args.already_fixed:
            for before, after in FIXES.values():
                source = source.replace(before, after, 1)
        hashes = prepare(args.project, source)
        if args.already_fixed:
            request = args.project / 'REQUEST.txt'
            request.write_text('当前实现已修复，现有烟测覆盖不足。请补充有区分能力的回归测试，保留已经正确的实现；不要为了先看到失败而人为改坏产品代码。\n\n验收行为如下：\n' + REQUEST.split('\n', 1)[1])
            hashes[request.name] = hashlib.sha256(request.read_bytes()).hexdigest()
        print(json.dumps({'project': str(args.project.resolve()), 'sha256': hashes}, ensure_ascii=False, indent=2))
    else:
        result, output = oracle(args.project.resolve())
        print(output)
        sys.exit(0 if result.wasSuccessful() else 1)
