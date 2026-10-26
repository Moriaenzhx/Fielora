"""Real project assets for cold recovery and mid-run correction.

Behavior oracles and controller evidence are separate: a correct final file cannot
prove that a process was restarted or that a correction reached the same Run.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import agent_task_export_case as export
from agent_typescript_cases import safe_environment


DIRECTION = '''调整需求：export 的输出改为 JSON Lines，不再输出 CSV 或表头；每个匹配任务占一个物理行，解析后保留 id,title,status,owner 四字段及原始内容。没有匹配时标准输出完全为空。list 仍输出 JSON 数组。原来的组合筛选、id 排序、错误退出码、数据保护和测试要求保持。请在当前任务中完成这项变更，不要开启另一项独立任务。'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(project, case):
    # Recovery control and the later direction stay outside the seed. The model
    # receives the ordinary task, not foreknowledge of the controller intervention.
    return export.prepare(project)


def controller_plan(case):
    common = {'case': case, 'status': 'PREPARED_NOT_RUN', 'same_run_required': True,
              'trigger': 'First confirmed project source write, before terminal completion; pause at safe boundary with no in-flight tool.',
              'missed_trigger': 'INVALID_OBSERVATION; record the attempt, do not silently replace it.',
              'raw_evidence': 'Keep engine events, controller process observations and file snapshots outside the candidate project.'}
    if case == 'cold-recovery':
        common.update({'action': 'Record completed effects and hashes; pause; shut down host; prove exit; start a new process with the same data directory; confirm preserved hashes before resuming the same Run/session.',
                       'unknown_effects': 'No unknown effects may be replayed; this case only claims recovery at a safe checkpoint, not arbitrary crash recovery.'})
    else:
        common.update({'action': 'Pause, deliver direction through the supported user-message/resume path on the same Run/session; verify admission and next actual model request before completion.',
                       'direction': DIRECTION, 'direction_sha256': digest(DIRECTION.encode('utf-8'))})
    return common


def corrected_oracle(project):
    rows = [{'id': 'Z9', 'title': '一,二', 'status': 'done', 'owner': 'Amy'},
            {'id': 'A2', 'title': '他说"好"\n第二行', 'status': 'open', 'owner': 'Amy'},
            {'id': 'B4', 'title': '保留', 'status': 'open', 'owner': ''},
            {'id': 'A1', 'title': '大小写', 'status': 'open', 'owner': 'amy'}]
    ordered = [rows[i] for i in (3, 1, 2, 0)]
    with tempfile.TemporaryDirectory(prefix='direction-oracle-') as folder:
        copied = Path(folder) / 'project'
        export.copy_project(project, copied)

        class Acceptance(unittest.TestCase):
            def command(self, command, *flags, content=None, missing=False):
                source = copied / '_operator_data.json'
                if missing:
                    source.unlink(missing_ok=True)
                else:
                    source.write_text(json.dumps(rows, ensure_ascii=False) if content is None else content, encoding='utf-8')
                before = source.read_bytes() if source.exists() else None
                seed = (copied / 'data/tasks.json').read_bytes()
                result = subprocess.run([sys.executable, '-B', 'cli.py', '--data', str(source), command, *flags],
                                        cwd=copied, env=safe_environment(), capture_output=True, text=True, timeout=10)
                self.assertEqual(source.read_bytes() if source.exists() else None, before)
                self.assertEqual((copied / 'data/tasks.json').read_bytes(), seed)
                return result

            def output(self, command, *flags):
                result = self.command(command, *flags)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, '')
                try:
                    return json.loads(result.stdout) if command == 'list' else [json.loads(line) for line in result.stdout.splitlines()]
                except ValueError:
                    self.fail('实际输出不符合请求的 JSON / JSON Lines 格式')

            def test_json_lines_and_special_chars(self):
                self.assertEqual(self.output('export'), ordered)

            def test_list_remains_json(self):
                self.assertEqual(self.output('list'), ordered)

            def test_combined_filter(self):
                for command in ('export', 'list'):
                    self.assertEqual(self.output(command, '--status', 'open', '--owner', 'Amy'), [rows[1]])

            def test_empty_owner(self):
                self.assertEqual(self.output('export', '--owner', ''), [rows[2]])

            def test_empty_export_is_empty_bytes(self):
                result = self.command('export', '--owner', 'nobody')
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))

            def test_invalid_status(self):
                result = self.command('export', '--status', 'invalid')
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, '')
                self.assertTrue(result.stderr)
                self.assertNotIn('Traceback', result.stderr)

            def test_invalid_data(self):
                for kwargs in ({'content': '{'}, {'missing': True}):
                    result = self.command('export', **kwargs)
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(result.stdout, '')
                    self.assertTrue(result.stderr)
                    self.assertNotIn('Traceback', result.stderr)

        stream = io.StringIO()
        result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Acceptance))
        return result, stream.getvalue()


def assess_control(record, case):
    """Check controller evidence consistency, never model self-reported recovery."""
    issues = []
    events = record.get('events', [])
    expected = ['START', 'EFFECT_CONFIRMED', 'PAUSED']
    expected += (['PROCESS_EXITED', 'PROCESS_STARTED', 'RESUMED', 'POST_RESUME_ACTION']
                 if case == 'cold-recovery' else ['DIRECTION_ADMITTED', 'NEXT_MODEL_INPUT'])
    expected += ['COMPLETED']
    if [e.get('kind') for e in events] != expected:
        return ['CONTROL_EVENT_SEQUENCE_INVALID']
    if not events[0].get('run_id') or any(e.get('run_id') != events[0]['run_id'] for e in events):
        issues.append('SAME_RUN_NOT_PROVEN')
    if any(type(e.get('at_ms')) is not int for e in events) or any(a.get('at_ms', 0) > b.get('at_ms', 0) for a, b in zip(events, events[1:])):
        issues.append('CHRONOLOGY_INVALID')
    if any(not e.get('evidence_ref') for e in events):
        issues.append('RAW_EVIDENCE_REFERENCE_REQUIRED')
    if events[2].get('in_flight_tools') != 0:
        issues.append('SAFE_PAUSE_NOT_PROVEN')
    effect = events[1]
    if not effect.get('tool_call_id') or not effect.get('path') or not valid_hash(effect.get('sha256')):
        issues.append('CONFIRMED_EFFECT_MISSING')
    if record.get('unknown_effects_replayed') != 0:
        issues.append('UNKNOWN_REPLAY_NOT_EXCLUDED')
    if case == 'cold-recovery':
        old, new = events[3], events[4]
        if not old.get('process_instance') or not new.get('process_instance') or old['process_instance'] == new['process_instance'] or old.get('exit_observed') is not True:
            issues.append('COLD_PROCESS_RESTART_NOT_PROVEN')
        if new.get('preserved_effects', {}).get(effect.get('path')) != effect.get('sha256'):
            issues.append('PRESERVED_EFFECT_NOT_PROVEN')
        if not events[6].get('tool_call_id') or events[6]['tool_call_id'] == effect.get('tool_call_id'):
            issues.append('POST_RESUME_PROGRESS_NOT_PROVEN')
    else:
        direction_hash = digest(DIRECTION.encode('utf-8'))
        if events[3].get('direction_sha256') != direction_hash or not events[3].get('message_id'):
            issues.append('DIRECTION_ADMISSION_NOT_PROVEN')
        if events[4].get('direction_sha256') != direction_hash or events[4].get('message_id') != events[3].get('message_id') or not events[4].get('request_id'):
            issues.append('ACTUAL_MODEL_INPUT_NOT_PROVEN')
    return issues


def valid_hash(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def control_evidence(path, project, case):
    if path is None:
        return {'passed': False, 'status': 'NOT_RUN', 'issues': ['CONTROL_EVIDENCE_REQUIRED']}
    path = path.resolve()
    if path == project.resolve() or project.resolve() in path.parents:
        return {'passed': False, 'issues': ['CONTROL_EVIDENCE_MUST_BE_OUTSIDE_PROJECT']}
    record = json.loads(path.read_text(encoding='utf-8'))
    issues = assess_control(record, case)
    refs = record.get('raw_evidence', {})
    for event in record.get('events', []):
        ref = event.get('evidence_ref')
        entry = refs.get(ref, {})
        relative = Path(entry.get('path', ''))
        target = (path.parent / relative).resolve()
        if not str(relative) or relative.is_absolute() or path.parent not in target.parents or project.resolve() in target.parents:
            issues.append('RAW_EVIDENCE_PATH_INVALID')
        elif not target.is_file() or digest(target.read_bytes()) != entry.get('sha256'):
            issues.append('RAW_EVIDENCE_HASH_MISMATCH')
    return {'passed': not issues, 'issues': sorted(set(issues)), 'scope': 'Controller observations with linked raw evidence; operator must retain/audit engine receipts.'}


def reference(project, corrected):
    service = export.REFERENCE_SERVICE
    if corrected:
        service = service.split('def export_tasks')[0] + '''def export_tasks(path, status='all', owner=None):
    import json
    return ''.join(json.dumps(row, ensure_ascii=False) + '\\n' for row in list_tasks(path, status, owner))
'''
    (project / 'service.py').write_text(service, encoding='utf-8')
    (project / 'cli.py').write_text(export.REFERENCE_CLI, encoding='utf-8')


def self_test(case):
    with tempfile.TemporaryDirectory(prefix='lifecycle-selftest-') as folder:
        project = Path(folder) / 'project'
        prepare(project, case)
        run_oracle = export.oracle if case == 'cold-recovery' else corrected_oracle
        seed, _ = run_oracle(project)
        assert not seed.wasSuccessful()
        reference(project, case == 'midrun-correction')
        good, output = run_oracle(project)
        assert good.wasSuccessful(), output
        rejected = []
        if case == 'midrun-correction':
            reference(project, False)
            stale, output = run_oracle(project)
            assert stale.failures and not stale.errors, output
            rejected.append('original_csv_after_direction')
        assert not control_evidence(None, project, case)['passed']
        kinds = ['START', 'EFFECT_CONFIRMED', 'PAUSED'] + (['PROCESS_EXITED', 'PROCESS_STARTED', 'RESUMED', 'POST_RESUME_ACTION'] if case == 'cold-recovery' else ['DIRECTION_ADMITTED', 'NEXT_MODEL_INPUT']) + ['COMPLETED']
        events = [dict(kind=kind, run_id='synthetic-run', at_ms=i, evidence_ref='synthetic-raw') for i, kind in enumerate(kinds)]
        events[1].update(tool_call_id='write-1', path='service.py', sha256='a' * 64)
        events[2]['in_flight_tools'] = 0
        if case == 'cold-recovery':
            events[3].update(process_instance='boot-1', exit_observed=True)
            events[4].update(process_instance='boot-2', preserved_effects={'service.py': 'a' * 64})
            events[6]['tool_call_id'] = 'verify-2'
        else:
            for event in events[3:5]:
                event.update(direction_sha256=digest(DIRECTION.encode('utf-8')), message_id='direction-1')
            events[4]['request_id'] = 'model-request-2'
        record = {'events': events, 'unknown_effects_replayed': 0}
        assert not assess_control(record, case)
        for name, mutate in [('new_run', lambda r: r['events'][-1].update(run_id='different')),
                             ('missing_event', lambda r: r['events'].pop(2)),
                             ('unknown_replay', lambda r: r.update(unknown_effects_replayed=1)),
                             ('unsafe_pause', lambda r: r['events'][2].update(in_flight_tools=1))]:
            bad = copy.deepcopy(record)
            mutate(bad)
            assert assess_control(bad, case), name
            rejected.append(name)
        specific = ([('same_process', lambda r: r['events'][4].update(process_instance='boot-1')),
                     ('lost_effect', lambda r: r['events'][4].update(preserved_effects={'service.py': 'b' * 64})),
                     ('replayed_effect', lambda r: r['events'][6].update(tool_call_id='write-1'))]
                    if case == 'cold-recovery' else
                    [('wrong_direction', lambda r: r['events'][3].update(direction_sha256='b' * 64)),
                     ('direction_missing_in_actual_input', lambda r: r['events'][4].pop('direction_sha256')),
                     ('wrong_message', lambda r: r['events'][4].update(message_id='different'))])
        for name, mutate in specific:
            bad = copy.deepcopy(record)
            mutate(bad)
            assert assess_control(bad, case), name
            rejected.append(name)
        # Missing and corrupted raw receipts cannot turn correct output into a pass.
        evidence_path = Path(folder) / 'control.json'
        evidence_path.write_text(json.dumps(record), encoding='utf-8')
        assert not control_evidence(evidence_path, project, case)['passed']
        rejected.append('missing_raw_receipt')
    return {'status': 'PASS', 'case': case, 'behavior_checks': good.testsRun,
            'rejected_faults': rejected, 'real_model': 'NOT_RUN', 'actual_control_scenario': 'NOT_RUN'}


def main(action, project, case, evidence=None):
    if action == 'self-test':
        record = self_test(case)
    elif project is None:
        raise ValueError('project path required')
    elif action == 'prepare':
        record = {'sha256': prepare(project, case), 'controller_plan': controller_plan(case)}
    elif action == 'verify-tests':
        record = export.submitted_tests(project)
    else:
        result, output = (export.oracle if case == 'cold-recovery' else corrected_oracle)(project)
        control = control_evidence(evidence, project, case)
        protection = (project / 'data/tasks.json').read_bytes() == export.DATA.encode('utf-8')
        protection = protection and (project / 'REQUEST.txt').read_text(encoding='utf-8') == export.REQUEST
        record = {'passed': result.wasSuccessful() and control['passed'] and protection,
                  'behavior_passed': result.wasSuccessful(), 'behavior_log': output,
                  'protected_inputs': protection, 'control': control}
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0 if record.get('passed', True) else 1
