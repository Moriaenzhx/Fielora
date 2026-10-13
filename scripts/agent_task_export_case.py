"""Offline cross-file feature case; reference and oracle stay outside the project.

This prepares an unfinished CLI project, not a model run. All acceptance commands
execute in temporary copies. It is an operator evaluator, not a hostile-code sandbox.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REQUEST = '''请为这个现有 Python 任务清单工具增加筛选与 CSV 导出功能。

使用方式：
python3 cli.py --data data/tasks.json list [--status all|open|done] [--owner 姓名]
python3 cli.py --data data/tasks.json export [--status all|open|done] [--owner 姓名]
省略 --data 时仍使用 data/tasks.json。

行为要求：
1. list 保持 JSON 数组输出及原有四个字段；export 向标准输出写 CSV，表头固定为 id,title,status,owner。
2. 两个命令共用相同筛选规则：status 默认 all；owner 未提供时不限，提供时按完整字符串精确匹配、区分大小写，空字符串也可作为筛选值。两个条件同时提供时须同时满足。
3. 两种输出均按 id 字符串升序排列。没有匹配项时，list 输出 []，export 只输出表头，退出码均为 0。
4. 中文、逗号、双引号和换行等字段内容必须在 CSV 解析后完整保留，不可丢字段或改变内容。
5. 非法 status、输入文件不存在或 JSON 无法解析时，退出码为 2，错误说明写入标准错误，标准输出为空，不输出 Python traceback。
6. 成功或失败都不得改写输入数据。保留现有功能，使用 Python 标准库，不新增第三方依赖。

请完成相关源码修改，补充实际调用业务代码和命令行的 unittest，验证正常、组合筛选、空结果、特殊字符及失败路径；测试使用临时数据，保留 data/tasks.json 和本需求文件原样。运行测试后简要报告实际修改、结果及未验证范围。仅在当前项目内工作。
'''

SAMPLE = [
    {'id': 'T003', 'title': '发布说明', 'status': 'done', 'owner': '小林'},
    {'id': 'T001', 'title': '校对, "草稿"\n第二行', 'status': 'open', 'owner': '小林'},
    {'id': 'T004', 'title': '文档整理', 'status': 'open', 'owner': 'Sam'},
    {'id': 'T002', 'title': '测试记录', 'status': 'done', 'owner': '小周'},
]
DATA = json.dumps(SAMPLE, ensure_ascii=False, indent=2) + '\n'

STORE = '''import json
from pathlib import Path


def load_tasks(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))
'''
SERVICE = '''from store import load_tasks


def list_tasks(path):
    return load_tasks(path)
'''
CLI = '''import argparse
import json
from service import list_tasks


def main():
    parser = argparse.ArgumentParser(description='任务清单')
    parser.add_argument('--data', default='data/tasks.json')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('list')
    args = parser.parse_args()
    print(json.dumps(list_tasks(args.data), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
'''
SMOKE = '''import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from service import list_tasks


class ExistingBehavior(unittest.TestCase):
    def test_service_reads_tasks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tasks.json'
            rows = [{'id': 'X1', 'title': '阅读', 'status': 'open', 'owner': '小王'}]
            path.write_text(json.dumps(rows), encoding='utf-8')
            self.assertEqual(list_tasks(path), rows)

    def test_cli_lists_json(self):
        result = subprocess.run([sys.executable, '-B', 'cli.py', 'list'],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)), 4)


if __name__ == '__main__':
    unittest.main()
'''
README = '''# 任务清单：跨文件功能验收项目

样本标识：task-export-v1。Python 3 标准库项目，无需安装依赖。
这是一个新的独立项目，和“测试”目录下的工作室/检测器项目无关。

- store.py：读取 JSON 文件。
- service.py：现有任务列表业务入口。
- cli.py：命令行入口，目前只有 list。
- test_existing.py：现有行为测试。
- data/tasks.json：需原样保留的示例数据。
- REQUEST.txt：本次完整功能需求。

现有运行命令：python3 cli.py list
测试命令：python3 -m unittest discover -v

项目故意尚未实现 REQUEST.txt 中的新功能；现有测试通过不代表新需求完成。
'''


def prepare(project):
    project.mkdir(parents=True, exist_ok=False)
    files = {'store.py': STORE, 'service.py': SERVICE, 'cli.py': CLI,
             'test_existing.py': SMOKE, 'README.md': README,
             'REQUEST.txt': REQUEST, 'data/tasks.json': DATA}
    for name, content in files.items():
        target = project / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
    return {name: hashlib.sha256((project / name).read_bytes()).hexdigest() for name in files}


def copy_project(project, destination):
    shutil.copytree(project, destination, ignore=shutil.ignore_patterns('__pycache__', '.git', '.venv'))


def submitted_tests(project):
    """Report submitted unittest results only; no claim of independent coverage."""
    with tempfile.TemporaryDirectory(prefix='task-export-tests-') as folder:
        copied = Path(folder) / 'project'
        copy_project(project, copied)
        result_path = Path(folder) / 'result.json'
        runner = '''import json, sys, unittest
from pathlib import Path
suite = unittest.defaultTestLoader.discover('.')
result = unittest.TestResult()
suite.run(result)
Path(sys.argv[1]).write_text(json.dumps({'count': result.testsRun,
 'failures': [t.id() for t,_ in result.failures], 'errors': [t.id() for t,_ in result.errors],
 'skipped': [t.id() for t,_ in result.skipped], 'success': result.wasSuccessful()}))
sys.exit(0 if result.wasSuccessful() else 1)
'''
        process = subprocess.run([sys.executable, '-B', '-c', runner, str(result_path)],
                                 cwd=copied, capture_output=True, text=True, timeout=30)
        record = json.loads(result_path.read_text())
        record['returncode'] = process.returncode
        record['scope'] = 'Submitted tests only; independent behavior is checked by verify'
        record['passed'] = (process.returncode == 0 and record['success'] and record['count'] > 0
                            and not any(record[k] for k in ('failures', 'errors', 'skipped')))
        return record


def oracle(project):
    # A different dataset ensures the implementation is not scored on seed constants.
    rows = [
        {'id': 'A20', 'title': '一,二', 'status': 'done', 'owner': '小林'},
        {'id': 'A03', 'title': '他说"完成"\n还需核对', 'status': 'open', 'owner': '小林'},
        {'id': 'A11', 'title': '部署', 'status': 'open', 'owner': 'Sam'},
        {'id': 'A01', 'title': '归档', 'status': 'done', 'owner': 'sam'},
        {'id': 'A09', 'title': '待认领', 'status': 'open', 'owner': ''},
    ]
    ordered = [rows[i] for i in (3, 1, 4, 2, 0)]
    fields = ['id', 'title', 'status', 'owner']
    with tempfile.TemporaryDirectory(prefix='task-export-oracle-') as folder:
        copied = Path(folder) / 'project'
        copy_project(project, copied)

        class Acceptance(unittest.TestCase):
            def setUp(self):
                self.data = copied / '_external_input.json'
                self.data.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')

            def command(self, command, *flags, data=None, default=False):
                path = data or self.data
                seed = copied / 'data/tasks.json'
                before = path.read_bytes() if path.exists() else None
                seed_before = seed.read_bytes()
                args = [sys.executable, '-B', 'cli.py']
                if not default:
                    args += ['--data', str(path)]
                process = subprocess.run(args + [command, *flags], cwd=copied,
                                         capture_output=True, text=True, encoding='utf-8', timeout=10)
                self.assertEqual(path.read_bytes() if path.exists() else None, before,
                                 '命令改写了输入文件')
                self.assertEqual(seed.read_bytes(), seed_before, '命令改写了示例数据')
                return process

            def output(self, command, *flags, **kwargs):
                process = self.command(command, *flags, **kwargs)
                self.assertEqual(process.returncode, 0, process.stderr)
                self.assertEqual(process.stderr, '')
                if command == 'list':
                    return json.loads(process.stdout)
                parsed = list(csv.reader(io.StringIO(process.stdout, newline='')))
                self.assertTrue(parsed, 'CSV 缺少表头')
                self.assertEqual(parsed[0], fields)
                self.assertTrue(all(len(row) == 4 for row in parsed[1:]))
                return [dict(zip(fields, row)) for row in parsed[1:]]

            def rejected(self, command, *flags, **kwargs):
                process = self.command(command, *flags, **kwargs)
                self.assertEqual(process.returncode, 2)
                self.assertEqual(process.stdout, '')
                self.assertTrue(process.stderr.strip())
                self.assertNotIn('Traceback (most recent call last)', process.stderr)

            def test_default_list_sorted(self):
                self.assertEqual(self.output('list'), ordered)

            def test_status(self):
                for status, expected in [('open', [rows[1], rows[4], rows[2]]),
                                         ('done', [rows[3], rows[0]]), ('all', ordered)]:
                    with self.subTest(status=status):
                        self.assertEqual(self.output('list', '--status', status), expected)

            def test_owner_exact_case_sensitive_and_empty(self):
                for owner, expected in [('小林', [rows[1], rows[0]]), ('小', []),
                                        ('Sam', [rows[2]]), ('sam', [rows[3]]), ('', [rows[4]])]:
                    with self.subTest(owner=owner):
                        self.assertEqual(self.output('list', '--owner', owner), expected)

            def test_combined_filters(self):
                self.assertEqual(self.output('list', '--status', 'open', '--owner', '小林'), [rows[1]])

            def test_csv_special_characters_and_order(self):
                self.assertEqual(self.output('export'), ordered)

            def test_csv_uses_same_filters(self):
                for flags, expected in [(['--owner', '小林'], [rows[1], rows[0]]),
                                        (['--status', 'done'], [rows[3], rows[0]]),
                                        (['--status', 'all'], ordered),
                                        (['--owner', '小林', '--status', 'open'], [rows[1]]),
                                        (['--owner', ''], [rows[4]])]:
                    with self.subTest(flags=flags):
                        self.assertEqual(self.output('export', *flags), expected)

            def test_no_match(self):
                for command in ('list', 'export'):
                    self.assertEqual(self.output(command, '--owner', '不存在'), [])
                    self.assertEqual(self.output(command, '--owner', 'Sam', '--status', 'done'), [])

            def test_invalid_status(self):
                for command in ('list', 'export'):
                    self.rejected(command, '--status', 'archived')

            def test_missing_file(self):
                for command in ('list', 'export'):
                    self.rejected(command, data=copied / 'missing.json')

            def test_invalid_json(self):
                self.data.write_text('{broken', encoding='utf-8')
                for command in ('list', 'export'):
                    self.rejected(command)

            def test_seed_and_request_preserved(self):
                self.assertEqual((copied / 'data/tasks.json').read_bytes(), DATA.encode())
                self.assertEqual((copied / 'REQUEST.txt').read_bytes(), REQUEST.encode())

            def test_default_data_path(self):
                expected = [SAMPLE[i] for i in (1, 3, 0, 2)]
                for command in ('list', 'export'):
                    self.assertEqual(self.output(command, default=True), expected)

        output = io.StringIO()
        result = unittest.TextTestRunner(stream=output, verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance))
        return result, output.getvalue()


# Reference implementation is used only by offline grader self-tests.
REFERENCE_SERVICE = '''import csv
import io
from store import load_tasks


def list_tasks(path, status='all', owner=None):
    if status not in ('all', 'open', 'done'):
        raise ValueError('非法状态')
    tasks = load_tasks(path)
    selected = [task for task in tasks
                if (status == 'all' or task['status'] == status)
                and (owner is None or task['owner'] == owner)]
    return sorted(selected, key=lambda task: task['id'])


def export_tasks(path, status='all', owner=None):
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=['id', 'title', 'status', 'owner'])
    writer.writeheader()
    writer.writerows(list_tasks(path, status, owner))
    return output.getvalue()
'''
REFERENCE_CLI = '''import argparse
import json
import sys
from service import list_tasks, export_tasks


def main():
    parser = argparse.ArgumentParser(description='任务清单')
    parser.add_argument('--data', default='data/tasks.json')
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('list', 'export'):
        command = commands.add_parser(name)
        command.add_argument('--status', choices=['all', 'open', 'done'], default='all')
        command.add_argument('--owner')
    args = parser.parse_args()
    try:
        if args.command == 'list':
            output = json.dumps(list_tasks(args.data, args.status, args.owner), ensure_ascii=False) + '\\n'
        else:
            output = export_tasks(args.data, args.status, args.owner)
    except (OSError, ValueError) as error:
        print('读取失败：' + str(error), file=sys.stderr)
        return 2
    sys.stdout.write(output)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
'''


def self_test():
    with tempfile.TemporaryDirectory(prefix='task-export-selftest-') as folder:
        project = Path(folder) / 'project'
        prepare(project)
        baseline_tests = submitted_tests(project)
        assert baseline_tests['passed'], baseline_tests
        missing, _ = oracle(project)
        assert not missing.wasSuccessful(), '未实现的种子不应通过新需求验收'
        (project / 'service.py').write_text(REFERENCE_SERVICE, encoding='utf-8')
        (project / 'cli.py').write_text(REFERENCE_CLI, encoding='utf-8')
        reference, output = oracle(project)
        assert reference.wasSuccessful(), output
        assert submitted_tests(project)['passed']
        # Each mutation must trigger a genuine assertion, without oracle runtime errors.
        faults = [
            ('ignored_owner', 'service.py', "owner is None or task['owner'] == owner", 'True'),
            ('unsorted', 'service.py', "sorted(selected, key=lambda task: task['id'])", 'selected'),
            ('or_instead_of_and', 'service.py', "and (owner is None", 'or (owner is None'),
            ('export_ignores_filters', 'service.py', 'writer.writerows(list_tasks(path, status, owner))',
             'writer.writerows(list_tasks(path))'),
            ('missing_csv_header', 'service.py', 'writer.writeheader()', 'pass'),
            ('wrong_error_exit', 'cli.py', 'return 2', 'return 0'),
            ('input_write', 'service.py', 'tasks = load_tasks(path)',
             "tasks = load_tasks(path)\n    from pathlib import Path\n    Path(path).write_text('[]')"),
        ]
        rejected = []
        for name, filename, before, after in faults:
            target = project / filename
            original = target.read_text(encoding='utf-8')
            assert original.count(before) == 1, name
            target.write_text(original.replace(before, after, 1), encoding='utf-8')
            bad, output = oracle(project)
            assert bad.failures and not bad.errors, (name, output)
            rejected.append(name)
            target.write_text(original, encoding='utf-8')
    return {'status': 'PASS', 'scope': 'Offline fixture/oracle self-test; real model NOT_RUN',
            'cases': reference.testsRun, 'baseline_tests': baseline_tests['count'],
            'unfinished_seed_rejected': True, 'reference_passed': True, 'rejected_faults': rejected}


def main(action, project):
    sys.dont_write_bytecode = True
    if action == 'self-test':
        print(json.dumps(self_test(), ensure_ascii=False, indent=2))
        return 0
    if project is None:
        raise ValueError('project path required')
    if action == 'prepare':
        print(json.dumps(prepare(project), ensure_ascii=False, indent=2))
        return 0
    if action == 'verify-tests':
        record = submitted_tests(project)
        print(json.dumps(record, ensure_ascii=False, indent=2))
        return 0 if record['passed'] else 1
    result, output = oracle(project)
    print(output)
    return 0 if result.wasSuccessful() else 1
