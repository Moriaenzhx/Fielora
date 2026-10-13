"""Offline case for the real failure: green tests that never call the detector.

Used by agent-convergence-case.py --case detector. No provider calls. The oracle
and its controlled variants stay outside the interactive project.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = '''def detected(result, target, applied):
    if not applied or result.get('parse_error'):
        return False
    target_failed = any(target in test_id for test_id, _ in result.get('failures', []))
    other_errors = [test_id for test_id, _ in result.get('errors', []) if target not in test_id]
    return target_failed and not other_errors
'''

SMOKE = '''import unittest
class Smoke(unittest.TestCase):
 def test_exit_code_contradiction(self):
  result = {'failures': [('suite.Case.test_target', 'AssertionError')], 'returncode': 0}
  self.assertTrue(bool(result['failures']))
  self.assertEqual(result['returncode'], 0)
'''

REQUEST = '''请修复 detector.py 的突变检测判断，并用外层测试证明检测器自身能拒绝误报。
保留 detected(result, target, applied) 接口与 input.csv。只有实际注入、精确目标测试的断言失败、没有任何运行错误，且结构化结果与退出码一致，才返回 True。
result 的字段为 tests_run（正整数）、failures/errors（测试完整 ID 和异常文本的二元列表）、success（布尔值）、returncode（整数，成功为 0，失败为 1）。不接受缺失/错误类型、空测试、退出码矛盾。target 是完整测试 ID，applied 必须为 True。output 只是日志，不参与判定。
外层 unittest 必须调用被测试的真正函数；既有正确检出的正例，也有目标名相似、目标运行错误、无注入、无关断言失败、日志含 FAIL 等反例。不要通过复制判断逻辑、固定返回值或仅断言输入字典完成测试。报告实际覆盖范围。
'''


def correct(result, target, applied):
    if applied is not True or not isinstance(result, dict) or result.get('parse_error'):
        return False
    if type(result.get('tests_run')) is not int or result['tests_run'] <= 0:
        return False
    for key in ('failures', 'errors'):
        rows = result.get(key)
        if not isinstance(rows, list) or any(not isinstance(r, (list, tuple)) or len(r) != 2
                or not all(isinstance(v, str) for v in r) for r in rows):
            return False
    return (not result['errors'] and result.get('success') is False
            and type(result.get('returncode')) is int and result['returncode'] == 1
            and any(test_id == target for test_id, _ in result['failures']))


TARGET = 'suite.Case.test_target'


def cases():
    base = dict(tests_run=2, failures=[(TARGET, 'AssertionError')], errors=[], success=False, returncode=1)
    return [
        ('positive', base, True, True),
        ('exit_contradiction', dict(base, returncode=0), True, False),
        ('success_contradiction', dict(base, success=True), True, False),
        ('substring', dict(base, failures=[(TARGET + '_unrelated', 'AssertionError')]), True, False),
        ('target_error', dict(base, errors=[(TARGET, 'RuntimeError')]), True, False),
        ('other_error', dict(base, errors=[('suite.Other.test', 'ImportError')]), True, False),
        ('unrelated_failure', dict(base, failures=[('suite.Other.test', 'AssertionError')]), True, False),
        ('no_injection', base, False, False),
        ('zero_tests', dict(base, tests_run=0), True, False),
        ('boolean_count', dict(base, tests_run=True), True, False),
        ('boolean_exit', dict(base, returncode=True), True, False),
        ('log_only', dict(base, failures=[], success=True, returncode=0, output='FAIL: ' + TARGET), True, False),
        ('missing_fields', {}, True, False),
        ('malformed_failures', dict(base, failures='FAIL'), True, False),
    ]


def prepare(project):
    project.mkdir(parents=True, exist_ok=False)
    for name, content in {'detector.py': SOURCE, 'test_detector.py': SMOKE,
                          'REQUEST.txt': REQUEST, 'input.csv': 'id,name\nC006,original\n'}.items():
        (project / name).write_text(content, encoding='utf-8')
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(project.iterdir())}


def load(project):
    spec = importlib.util.spec_from_file_location('detector_candidate', project / 'detector.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def oracle(project):
    # The caller chooses an isolated project. These are trusted local test
    # programs, not a sandbox for hostile Python.
    module = load(project)

    class Acceptance(unittest.TestCase):
        def test_real_entry_point(self):
            for name, payload, applied, expected in cases():
                with self.subTest(case=name):
                    self.assertIs(module.detected(payload, TARGET, applied), expected)

        def test_input_preserved(self):
            self.assertEqual((project / 'input.csv').read_text(), 'id,name\nC006,original\n')

    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance))
    return result, output.getvalue()


def verify_tests(project):
    runner = '''import json, sys, unittest
from pathlib import Path
import detector
original = detector.detected
variant = sys.argv[1]
if variant == 'always_accept': detector.detected = lambda result,target,applied: True
if variant == 'always_reject': detector.detected = lambda result,target,applied: False
if variant == 'ignore_exit':
 detector.detected = lambda result,target,applied: original(dict(result, returncode=1) if isinstance(result,dict) else result,target,applied)
if variant == 'ignore_target_error':
 detector.detected = lambda result,target,applied: original(dict(result, errors=[]) if isinstance(result,dict) else result,target,applied)
if variant == 'substring':
 def colliding(result,target,applied):
  rows = result.get('failures') if isinstance(result,dict) else None
  if isinstance(rows,list) and all(isinstance(row,(list,tuple)) and len(row)==2 and all(isinstance(v,str) for v in row) for row in rows):
   result = dict(result, failures=[(target if target in i else i,e) for i,e in rows])
  return original(result,target,applied)
 detector.detected = colliding
suite = unittest.defaultTestLoader.discover('.', pattern='test*.py')
result = unittest.TestResult()
suite.run(result)
Path(sys.argv[2]).write_text(json.dumps({'count':result.testsRun,'failures':[t.id() for t,_ in result.failures],
 'errors':[t.id() for t,_ in result.errors], 'skipped':[t.id() for t,_ in result.skipped],
 'expected_failures':[t.id() for t,_ in result.expectedFailures],
 'unexpected_successes':[t.id() for t in result.unexpectedSuccesses], 'success':result.wasSuccessful()}))
sys.exit(0 if result.wasSuccessful() else 1)
'''
    reports = []
    for variant in ['baseline', 'always_accept', 'always_reject', 'ignore_exit', 'ignore_target_error', 'substring']:
        with tempfile.TemporaryDirectory(prefix='detector-score-') as d:
            copied = Path(d) / 'project'
            shutil.copytree(project, copied, ignore=shutil.ignore_patterns('__pycache__', '.git'))
            output = Path(d) / 'result.json'
            try:
                p = subprocess.run([sys.executable, '-B', '-c', runner, variant, str(output)], cwd=copied,
                                   capture_output=True, text=True, timeout=30)
                result = json.loads(output.read_text())
                passed = (result['count'] > 0 and not any(result[k] for k in
                    ['errors', 'skipped', 'expected_failures', 'unexpected_successes']) and
                    ((p.returncode == 0 and result['success'] and not result['failures']) if variant == 'baseline'
                     else (p.returncode == 1 and not result['success'] and bool(result['failures']))))
                reports.append(dict(variant=variant, discrimination_passed=passed, result=result, exit_code=p.returncode))
            except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                reports.append(dict(variant=variant, discrimination_passed=False, error=str(error)))
    return reports


def self_test():
    import inspect
    with tempfile.TemporaryDirectory() as d:
        project = Path(d) / 'case'
        prepare(project)
        bad, _ = oracle(project)
        assert not bad.wasSuccessful()
        weak = verify_tests(project)
        assert [r['discrimination_passed'] for r in weak] == [True, False, False, False, False, False], weak
        (project / 'detector.py').write_text(inspect.getsource(correct).replace('def correct(', 'def detected('))
        good, output = oracle(project)
        assert good.wasSuccessful(), output
        rows = repr(cases())
        (project / 'test_detector.py').write_text('import unittest, detector\nclass Regression(unittest.TestCase):\n'
            ' def test_actual_function(self):\n'
            f'  for name, payload, applied, expected in {rows}:\n'
            '   with self.subTest(case=name):\n'
            f'    self.assertIs(detector.detected(payload, {TARGET!r}, applied), expected)\n'
            f'    self.assertIs(detector.detected(result=payload, target={TARGET!r}, applied=applied), expected)\n'
            ' def test_invalid_input_preserves_call_contract(self):\n'
            f'  self.assertFalse(detector.detected(result=None, target={TARGET!r}, applied=True))\n')
        strong = verify_tests(project)
        assert all(r['discrimination_passed'] for r in strong), strong
    return dict(status='PASS', scope='Offline oracle self-test; no model calls', cases=len(cases()), weak=weak, strong=strong)


def main(action, project):
    sys.dont_write_bytecode = True
    if action == 'self-test':
        print(json.dumps(self_test(), ensure_ascii=False, indent=2))
        return 0
    if project is None:
        raise ValueError('project path required')
    if action == 'prepare':
        print(json.dumps(prepare(project), indent=2))
        return 0
    if action == 'verify-tests':
        reports = verify_tests(project)
        print(json.dumps(reports, indent=2))
        return 0 if all(r['discrimination_passed'] for r in reports) else 1
    result, output = oracle(project)
    print(output)
    return 0 if result.wasSuccessful() else 1
