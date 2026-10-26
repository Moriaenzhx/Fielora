"""Scoring integrity tests; synthetic records never become evaluation artifacts."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('score', ROOT / 'scripts/score-opencode-comparison.py')
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)


class Scoring(unittest.TestCase):
    def setUp(self):
        self.config = {'model': 'synthetic', 'endpoint': 'no-network'}
        self.manifest = {'matched_configuration': self.config, 'preselected_improvement_metric': 'technical_interventions',
                         'observations': [{'pair_id': 'pair-%02d' % i} for i in range(24)]}
        self.good = {'status': 'COMPLETED', 'matched_configuration': self.config, 'build_identity': 'synthetic-build',
                     'run_id': 'synthetic-run', 'evidence_manifest': 'synthetic-evidence', '_evidence_verified': True,
                     'checks': dict.fromkeys(('external_behavior', 'submitted_tests', 'protected_scope', 'accurate_report', 'control_scenario'), True),
                     'elapsed_ms': 100, 'input_tokens': 10, 'output_tokens': 5, 'technical_interventions': 0,
                     'unproductive_calls': 0, 'data_loss': False, 'false_completion': False}
        self.records = {(pair['pair_id'], engine): copy.deepcopy(self.good) for pair in self.manifest['observations'] for engine in ('fielora', 'opencode')}

    def test_empty_does_not_pass(self):
        result = score.summarize(self.manifest, {})
        self.assertEqual(result['counts']['fielora']['not_run'], 24)
        self.assertFalse(result['paired_engineering_threshold_passed'])

    def test_zero_baseline_is_not_improvement(self):
        result = score.summarize(self.manifest, self.records)
        self.assertTrue(result['paired_engineering_threshold_passed'])
        self.assertIsNone(result['median_ratios_fielora_over_opencode']['technical_interventions'])
        self.assertFalse(result['preselected_improvement_threshold_passed'])

    def test_missing_usage_does_not_drop_pair(self):
        self.records[('pair-00', 'fielora')]['input_tokens'] = None
        result = score.summarize(self.manifest, self.records)
        self.assertEqual(result['common_success_pairs'], 24)
        self.assertIsNone(result['median_ratios_fielora_over_opencode']['tokens'])
        self.assertFalse(result['paired_engineering_threshold_passed'])

    def test_failure_stays_in_denominator(self):
        for i in range(5):
            self.records[('pair-%02d' % i, 'fielora')]['status'] = 'FAILED'
        result = score.summarize(self.manifest, self.records)
        self.assertEqual(result['counts']['fielora']['success'], 19)
        self.assertEqual(result['common_success_pairs'], 19)
        self.assertFalse(result['paired_engineering_threshold_passed'])

    def test_mismatched_configuration_and_false_completion_fail(self):
        for change in ({'matched_configuration': {'model': 'different'}}, {'false_completion': True}, {'_evidence_verified': False}):
            records = copy.deepcopy(self.records)
            records[('pair-00', 'fielora')].update(change)
            self.assertFalse(score.summarize(self.manifest, records)['paired_engineering_threshold_passed'])

    def test_record_cannot_self_assert_raw_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder) / 'engine/project'
            project.mkdir(parents=True)
            record_path = project.parent / 'operator-result.json'
            record_path.write_text(json.dumps(self.good))
            pair = {'pair_id': 'pair', 'engines': {'fielora': {'seed_sha256': {'seed': 'hash'}}}}
            self.assertFalse(score.load_result(project, pair, 'fielora')['_evidence_verified'])
            raw = project.parent / 'raw.json'
            raw.write_text('{"synthetic":true}')
            entry = {'path': 'raw.json', 'sha256': hashlib.sha256(raw.read_bytes()).hexdigest()}
            evidence = project.parent / 'evidence.json'
            evidence.write_text(json.dumps({'pair_id': 'pair', 'engine': 'fielora', 'seed_sha256': {'seed': 'hash'}, 'run_id': 'synthetic-run', 'build_identity': 'synthetic-build', 'records': [entry]}))
            record = dict(self.good, evidence_manifest={'path': 'evidence.json', 'sha256': hashlib.sha256(evidence.read_bytes()).hexdigest()})
            record_path.write_text(json.dumps(record))
            self.assertTrue(score.load_result(project, pair, 'fielora')['_evidence_verified'])
            raw.write_text('changed')
            self.assertFalse(score.load_result(project, pair, 'fielora')['_evidence_verified'])

    def test_frozen_scoring_source_cannot_change_silently(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            source = root / 'oracle.py'
            source.write_text('fixed criterion')
            categories = ['repair', 'cross-file', 'large-files', 'regression-only', 'http-protection', 'detector', 'cold-recovery', 'midrun-correction']
            manifest = {'observations': [{'pair_id': '%s-%02d' % (name, repetition)} for name in categories for repetition in range(1, 4)],
                        'scoring_sources': {'oracle.py': hashlib.sha256(source.read_bytes()).hexdigest()}}
            score.validate_manifest(manifest, root)
            source.write_text('relaxed criterion')
            with self.assertRaisesRegex(ValueError, 'scoring source changed'):
                score.validate_manifest(manifest, root)


if __name__ == '__main__':
    unittest.main()
