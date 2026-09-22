import { runAudit } from './stable-audit.mjs';
if (process.argv.includes('--reuse')) throw Error('--reuse is not permitted for reproducibility verification');
await runAudit({ runs: Number(process.env.AUDIT_RUNS ?? 1), directory: process.env.AUDIT_OUTPUT_DIR ?? 'artifacts/python-compatibility-stable', baselineRoot: process.env.AUDIT_VM_BASELINE });
