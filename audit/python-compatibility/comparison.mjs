import { createHash } from 'node:crypto';
import path from 'node:path';

// Policies affect only these audited observations, never arbitrary student output.
export const policies = Object.freeze({
  'collection-set-order': { mode: 'unordered-set' },
  'class-default-repr': { mode: 'object-address-normalized' },
  'module-missing-member': { mode: 'temporary-path-normalized', field: 'message' },
});
export const AUDIT_DATE = '2026-09-15';
export function auditCase(c) {
  return { ...c, comparison: policies[c.id] ?? { mode: 'exact' },
    ...(['standard-date-today', 'standard-date-fixed'].includes(c.id) ? { oracleDate: AUDIT_DATE } : {}) };
}

// Parse one flat set repr, respecting quoted commas/braces/escapes. No eval and no line sorting.
export function setElements(text) {
  if (text === 'set()\n') return [];
  if (!text.startsWith('{') || !text.endsWith('}\n')) throw Error('unordered-set requires one set repr line');
  const body = text.slice(1, -2), elements = [];
  let quote = '', escaped = false, token = '';
  for (const ch of body) {
    if (quote) { token += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; }
    else if (ch === "'" || ch === '"') { quote = ch; token += ch; }
    else if (ch === ',') { elements.push(token.trim()); token = ''; }
    else { if ('{}[]():\n\r'.includes(ch)) throw Error('not a flat scalar set'); token += ch; }
  }
  if (quote || escaped) throw Error('unterminated set string');
  elements.push(token.trim());
  const scalar = /^(?:None|True|False|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/i;
  if (elements.some(x => !scalar.test(x)) || new Set(elements).size !== elements.length) throw Error('invalid scalar set repr');
  return elements.sort();
}

export function normalizeAddresses(text) {
  const addresses = new Map();
  const output = text.split('\n').map(line => line.replace(/^<([\w.]+) object at (0x[0-9a-fA-F]+)>$/, (_, type, address) => {
    if (!addresses.has(address)) addresses.set(address, addresses.size + 1);
    return `<${type} object at <ADDRESS:${addresses.get(address)}>>`;
  })).join('\n');
  return output;
}

export function normalizeTemporaryPath(message, root) {
  if (!root || typeof message !== 'string') return message;
  // Only the import diagnostic's owned path slot. stdout and arbitrary path strings stay exact.
  const match = /^(cannot import name '.+' from '.+' \()(.+)(\))$/.exec(message);
  if (!match || !match[2].startsWith(root)) return message;
  const suffix = match[2].slice(root.length);
  if (!/^[\\/]/.test(suffix) || /(^|[\\/])\.\.?([\\/]|$)/.test(suffix)) return message;
  const api = root.includes('\\') ? path.win32 : path.posix;
  const relative = api.relative(root, match[2]);
  if (!relative || relative.startsWith('..') || api.isAbsolute(relative)) return message;
  return `${match[1]}<TEMP_ROOT>${suffix}${match[3]}`;
}

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])])) : value;
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function normalized(c, result) {
  const { environment, execution, timings, ...value } = result;
  const mode = c.comparison?.mode ?? 'exact';
  if (mode === 'unordered-set' && value.completion === 'complete') value.stdout = { set: setElements(value.stdout) };
  else if (mode === 'object-address-normalized') value.stdout = normalizeAddresses(value.stdout);
  else if (mode === 'temporary-path-normalized') value.message = normalizeTemporaryPath(value.message, execution?.directory);
  else if (mode !== 'exact' && mode !== 'unordered-set') throw Error(`Unknown comparison policy: ${mode}`);
  return canonical(value);
}

export function compareCase(c, cp, vm) {
  let a, b;
  try { a = normalized(c, cp); }
  catch (error) { return { classification: 'audit-error', differences: ['normalization'], normalizationError: String(error) }; }
  try { b = normalized(c, vm); }
  catch (error) { return { classification: 'interpreter-defect', differences: ['stdout'], normalizedCPython:a, normalizedVM:normalized({comparison:{mode:'exact'}},vm), normalizationError:String(error) }; }
  const differences = [];
  if (!cp.skipped) {
    for (const key of ['stdout', 'errorType', 'completion']) if (!equal(a[key], b[key])) differences.push(key);
    if (cp.errorType && vm.errorType && (cp.file !== vm.file || cp.line !== vm.line)) differences.push('errorLocation');
    if (!equal(cp.files ?? {}, vm.files ?? {})) differences.push('files');
    if (cp.stderr) differences.push('stderr');
  }
  let classification;
  if (cp.completion === 'harness-error') classification = 'audit-error';
  else if (cp.skipped || c.category === 'safety') classification = c.policy ?? 'intentional-difference';
  else if (c.policy === 'unsupported') classification = 'unsupported';
  else if (!differences.length) classification = c.comparison?.mode === 'unordered-set' || (cp.errorType && cp.message !== vm.message) ? 'educational-compatible' : 'exact';
  else if (c.comparison?.mode === 'object-address-normalized') {
    const type = /^<__main__\.([\w]+) object at <ADDRESS:1>>\n$/.exec(a.stdout)?.[1];
    classification = type && b.stdout === `<${type} 객체>\n` && differences.length === 1 && differences[0] === 'stdout' ? 'educational-compatible' : 'interpreter-defect';
  } else classification = c.policy ?? 'interpreter-defect';
  return { classification, differences, normalizedCPython: a, normalizedVM: b };
}

export function reproducibleReport(report) {
  return canonical({ total: report.total, counts: report.counts, categories: report.categories,
    results: report.results.map(r => ({ id: r.id, code: r.code, input: r.input, files: r.files, comparison: r.comparison,
      cpython: r.normalizedCPython, learningVm: r.normalizedVM, classification: r.classification, differences: r.differences })) });
}
export const resultHash = report => createHash('sha256').update(JSON.stringify(reproducibleReport(report))).digest('hex');
