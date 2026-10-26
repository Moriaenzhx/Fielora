"""Prepare the fixed 24 paired observations; never starts engines or calls APIs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from agent_typescript_cases import safe_environment

ROOT = Path(__file__).resolve().parent.parent
CASES = [
    ('repair', 'ledger', False), ('cross-file', 'task-export', False),
    ('large-files', 'large-files', False), ('regression-only', 'ledger', True),
    ('http-protection', 'http-protection', False), ('detector', 'detector', False),
    ('cold-recovery', 'cold-recovery', False), ('midrun-correction', 'midrun-correction', False),
]


def hashes(project):
    return {str(file.relative_to(project)): hashlib.sha256(file.read_bytes()).hexdigest()
            for file in sorted(project.rglob('*')) if file.is_file()}


def prepare(destination):
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    hooks = destination / '.empty-hooks'
    hooks.mkdir()
    observations = []
    for repetition in range(1, 4):
        for index, (name, case, fixed) in enumerate(CASES):
            pair_id = '%s-%02d' % (name, repetition)
            engines = {}
            controller = None
            for engine in ('fielora', 'opencode'):
                project = destination / pair_id / engine / 'project'
                project.parent.mkdir(parents=True)
                args = [sys.executable, '-B', str(ROOT / 'scripts/agent-convergence-case.py'),
                        'prepare', str(project), '--case', case]
                if fixed:
                    args.append('--already-fixed')
                result = subprocess.run(args, env=safe_environment(), capture_output=True, text=True, timeout=30)
                if result.returncode:
                    raise RuntimeError('prepare failed for %s: %s' % (pair_id, result.stderr[-1000:]))
                data = json.loads(result.stdout)
                controller = data.get('controller_plan')
                engines[engine] = {'project': str(project.relative_to(destination)),
                                   'seed_sha256': hashes(project), 'status': 'NOT_RUN'}
                # Prevent git discovery from climbing into the Fielora checkout.
                # These are synthetic fixture repositories, never commits in Fielora.
                for command in (['git', '-c', 'init.defaultBranch=codex/eval-seed', 'init', '--quiet'],
                                ['git', 'add', '.'],
                                ['git', '-c', 'user.name=Fielora Fixture', '-c', 'user.email=fixture@example.invalid',
                                 '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + str(hooks),
                                 'commit', '--quiet', '-m', 'Synthetic evaluation seed']):
                    created = subprocess.run(command, cwd=project, env=safe_environment(), capture_output=True, text=True, timeout=20)
                    if created.returncode:
                        raise RuntimeError('fixture git isolation failed: ' + created.stderr[-500:])
            assert engines['fielora']['seed_sha256'] == engines['opencode']['seed_sha256'], pair_id
            protected = ['REQUEST.txt'] + [name for name in engines['fielora']['seed_sha256'] if name.startswith('data/') or name == 'input.csv']
            if fixed:
                protected.append('ledger.py')
            observations.append({'pair_id': pair_id, 'category': name, 'case': case, 'repetition': repetition,
                                 'order': ['fielora', 'opencode'] if (index + repetition) % 2 else ['opencode', 'fielora'],
                                 'protected_files': protected, 'controller_plan': controller, 'engines': engines})
    sources = ['scripts/agent-convergence-case.py', 'scripts/agent_detector_case.py',
               'scripts/agent_task_export_case.py', 'scripts/agent_typescript_cases.py',
               'scripts/agent_lifecycle_cases.py', 'scripts/prepare-opencode-comparison.py',
               'scripts/score-opencode-comparison.py', 'evals/china-model/OPENCODE_COMPARISON.md']
    manifest = {'schema_version': 1, 'suite': 'fielora-opencode-representative-v1',
                'status': 'PREPARED_NOT_RUN', 'model': 'qwen3.7-plus',
                'opencode': {'version': '1.18.35', 'commit': '53d1eabb61e21162157817bf677da0a4ad3332e3'},
                'matched_configuration': None, 'live_budget': None,
                'preselected_improvement_metric': 'technical_interventions',
                'authorization_note': 'User retained existing Coding Plan for interactive coding; automated paired evaluation remains NOT_RUN without eligible configuration.',
                'scoring_sources': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources},
                'observations': observations}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'status': manifest['status'], 'paired_observations': len(observations),
            'isolated_projects': len(observations) * 2, 'manifest': str(destination / 'manifest.json'),
            'real_model_calls': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.destination), ensure_ascii=False, indent=2))
