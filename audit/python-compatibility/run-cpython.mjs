import { createOracle } from './oracle-process.mjs';
export const python = process.env.AUDIT_PYTHON;
const oracle = createOracle();
export const runCPython = c => oracle.run(c);
export const warmupCPython = () => oracle.initialize();
