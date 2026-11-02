"""Bounded viva dry-run using existing real browser/native workflows; no hour test."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT/'build_phase15'/('demo-'+time.strftime('%Y%m%d-%H%M%S')))
    args = parser.parse_args()
    native = args.native.resolve(strict=True)
    manifest = json.loads((ROOT/'data/plots/manifest.json').read_text())
    for name, expected in manifest['output_sha256'].items():
        if hashlib.sha256((ROOT/'data/plots'/name).read_bytes()).hexdigest() != expected:
            raise ValueError('Regenerate modified/missing plot: '+name)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    # Existing browser tests own established filenames. Preserve old evidence,
    # save this dry-run's evidence separately, then restore every original byte.
    evidence = ROOT/'client/test-results'
    backup = output/'prior-browser-evidence'
    old = {str(p.relative_to(evidence)): hashlib.sha256(p.read_bytes()).hexdigest()
           for p in evidence.rglob('*') if p.is_file()} if evidence.exists() else {}
    if evidence.exists():
        shutil.copytree(evidence, backup)
    sys.path.insert(0, str(ROOT/'tests'))
    import integration_test
    previous = sys.argv
    try:
        sys.argv = ['integration_test.py', '--native', str(native), '--mode', 'smoke',
                    '--stage-timeout', '120', '--output', str(output/'integration')]
        return integration_test.main()
    finally:
        sys.argv = previous
        if evidence.exists():
            shutil.copytree(evidence, output/'dry-run-browser-evidence')
        if backup.exists():
            shutil.copytree(backup, evidence, dirs_exist_ok=True)
        restored = all((evidence/p).is_file() and hashlib.sha256((evidence/p).read_bytes()).hexdigest()==h
                       for p,h in old.items())
        (output/'evidence-preservation.json').write_text(json.dumps({'originalFiles':len(old),'restoredExactly':restored},indent=2))
        if not restored:
            raise RuntimeError('Original evidence restoration failed; retained backup requires inspection')


if __name__ == '__main__':
    sys.exit(main())
