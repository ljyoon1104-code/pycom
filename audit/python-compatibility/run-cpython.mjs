import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export const python = process.env.AUDIT_PYTHON;
if (!python) throw Error('Set AUDIT_PYTHON to the CPython 3.12.14 executable before running this audit.');
const version = spawnSync(python, ['-I', '-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== '3.12.14') throw Error('This audit requires CPython 3.12.14; other versions must not be mixed.');
export function runCPython(c) {
  if (c.vmOnly) return { skipped: true, reason: c.vmOnly, stdout: '', errorType: null, completion: 'not-run' };
  const r = spawnSync(python, ['-I', '-X', 'utf8', resolve('audit/python-compatibility/run-cpython.py')], { input: JSON.stringify({ ...c, directory: resolve('artifacts/python-compatibility-work', c.id) }), encoding: 'utf8', timeout: 5000, maxBuffer: 2_000_000, env: { ...process.env, PYTHONHASHSEED: '0' } });
  if (r.error || r.status !== 0) return { stdout: r.stdout ?? '', errorType: r.error?.code ?? 'OracleProcessError', message: r.stderr, completion: 'harness-error' };
  return JSON.parse(r.stdout);
}
