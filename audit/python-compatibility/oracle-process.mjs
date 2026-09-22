import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

export const LIMITS = Object.freeze({ startup: 5000, setup: 5000, execute: 5000, fileExecute: 5000, collect: 5000, exit: 2000, pipeBytes: 6_000_000, outputBytes: 2_000_000 });
export function oracleEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PYTHON/i.test(key)));
  return { ...env, PYTHONHASHSEED: '0', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TZ: 'UTC', LC_ALL: 'C' };
}
const flags = ['-B', '-S', '-P', '-X', 'utf8']; // No bytecode/site packages/unsafe script path; honor pinned PYTHON settings.
export function processAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function killTree(child) {
  if (process.platform === 'win32') await new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 2000 });
    killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', code => { if (code !== 0) child.kill(); resolve(); });
  });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

export function createOracle(options = {}) {
  const executable = options.python ?? process.env.AUDIT_PYTHON;
  const base = path.resolve(options.workRoot ?? 'artifacts/python-compatibility-temp');
  const script = options.script ?? fileURLToPath(new URL('./run-cpython.py', import.meta.url));
  const limits = { ...LIMITS, ...options.limits }, env = oracleEnvironment();
  let warmup, queue = Promise.resolve();
  function initialize() {
    if (warmup) return warmup;
    if (!executable) throw Error('Set AUDIT_PYTHON to CPython 3.12.14; no fallback is allowed.');
    const start = performance.now();
    const version = spawnSync(executable, [...flags, '-c', 'import json,platform,sys; print(json.dumps({"version":platform.python_version(),"hashRandomization":sys.flags.hash_randomization,"ignoreEnvironment":sys.flags.ignore_environment,"utf8":sys.flags.utf8_mode}))'], { encoding: 'utf8', env, timeout: limits.startup, windowsHide: true });
    if (version.status !== 0) throw Error(`CPython warm-up failed: ${version.error?.code ?? version.stderr}`);
    const info = JSON.parse(version.stdout);
    if (info.version !== '3.12.14' || info.hashRandomization !== 0 || info.ignoreEnvironment !== 0 || info.utf8 !== 1) throw Error('CPython 3.12.14 and pinned environment are required.');
    fs.mkdirSync(base, { recursive: true });
    warmup = { ...info, elapsedMs: performance.now() - start, flags, environment: { PYTHONHASHSEED: '0', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', TZ: 'UTC', LC_ALL: 'C' } };
    return warmup;
  }
  async function execute(c) {
    if (c.vmOnly) return { skipped: true, reason: c.vmOnly, stdout: '', errorType: null, completion: 'not-run' };
    initialize();
    const started = performance.now(), directory = fs.mkdtempSync(path.join(base, 'case-'));
    const directoryMs = performance.now() - started;
    const request = { ...c, directory, outputLimit: limits.outputBytes, profileFiles: !!c.files?.length || /\bopen\s*\(/.test(c.code) };
    let result, child, cleanupError;
    try {
      result = await new Promise(resolve => {
        let timer, failure, resultTime, startupMs, raw = '', stderr = '', bytes = 0, pending = '', phase = 'startup';
        const decoder = new StringDecoder('utf8'), errorDecoder = new StringDecoder('utf8');
        const abort = reason => { if (failure) return; failure = reason; clearTimeout(timer); void killTree(child); };
        const arm = (name, ms) => { phase = name; clearTimeout(timer); timer = setTimeout(() => abort(`timeout:${name}`), ms); };
        const receive = chunk => {
          bytes += chunk.length; if (bytes > limits.pipeBytes) { abort('pipe-limit'); return; }
          const text = decoder.write(chunk); raw += text; pending += text;
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (message.event === 'ready') { startupMs = performance.now() - started - directoryMs; arm('setup', limits.setup); }
              if (message.event === 'execute') arm('execute', request.profileFiles ? limits.fileExecute : limits.execute);
              if (message.event === 'collect') arm('collect', limits.collect);
              if (message.event === 'result') { resultTime = performance.now(); arm('exit', limits.exit); }
            } catch { abort('protocol-json'); }
          }
        };
        child = spawn(executable, [...flags, script], { cwd: directory, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        arm('startup', limits.startup);
        child.stdout.on('data', receive);
        child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > limits.pipeBytes) abort('pipe-limit'); else stderr += errorDecoder.write(chunk); });
        child.stdin.on('error', () => {});
        child.once('error', error => { failure = `process-start:${error.code}`; });
        child.once('close', (code, signal) => {
          clearTimeout(timer); raw += decoder.end(); stderr += errorDecoder.end();
          if (code !== 0) failure ??= `process-exit:${code ?? signal}`;
          let value;
          try {
            const messages = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
            const last = messages.at(-1);
            if (last?.event !== 'result' || !last.result || typeof last.result.stdout !== 'string') throw Error('Missing oracle result');
            value = last.result;
            if (stderr) value.stderr = (value.stderr ?? '') + stderr;
          } catch { failure ??= 'protocol-result'; }
          if (failure) value = { stdout: '', stderr, errorType: 'AuditError', message: failure, completion: 'harness-error' };
          resolve({ ...value, execution: { directory, pid: child.pid, exitCode: code, signal, phase, failure, processTerminated: !child.pid || !processAlive(child.pid) },
            timings: { ...value?.timings, directoryMs, startupMs, processExitMs: resultTime ? performance.now() - resultTime : null, processMs: performance.now() - started - directoryMs } });
        });
        child.stdin.end(JSON.stringify(request), 'utf8');
      });
    } finally {
      const cleanupStart = performance.now();
      // Never remove the base or a caller-supplied case ID: only the real unique directory we made.
      const resolved = fs.realpathSync(directory), baseReal = fs.realpathSync(base);
      if (path.dirname(resolved) !== baseReal || !path.basename(resolved).startsWith('case-')) throw Error('Unsafe oracle cleanup target');
      try { fs.rmSync(resolved, { recursive: true, force: false, maxRetries: 3, retryDelay: 50 }); }
      catch (error) { cleanupError = String(error); }
      if (result) { result.timings.cleanupMs = performance.now() - cleanupStart; result.timings.totalMs = performance.now() - started; result.execution.cleaned = !fs.existsSync(directory); }
    }
    if (cleanupError) return { ...result, completion: 'harness-error', errorType: 'AuditError', message: `cleanup:${cleanupError}` };
    return result;
  }
  return { initialize, run(c) { const task = queue.then(() => execute(c)); queue = task.catch(() => {}); return task; } };
}
