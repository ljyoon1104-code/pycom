import { createServer } from 'vite';
export async function createLearningRunner() {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  const { compile } = await server.ssrLoadModule('/src/compiler/compiler.ts'), { VM } = await server.ssrLoadModule('/src/runtime/vm.ts');
  function run(c) {
    const events = [], files = new Map((c.files ?? []).map(f => [f.name, f.content])); let vm, error, compileSuccess = true;
    try { vm = new VM(compile(c.code), e => events.push(e), files, { fileName: 'main.py', fileEncodings: new Map((c.files ?? []).map(f => [f.name, f.encoding ?? 'utf-8'])), ...(c.fixedClock ? { clock: () => new Date(c.fixedClock) } : {}) }); vm.execute();
      let used = 0; while (events.at(-1)?.type === 'input' && used < (c.input ?? []).length) vm.resume(c.input[used++]);
    } catch (e) { compileSuccess = false; error = e.detail ?? { category: 'internal', message: String(e), line: null, column: null }; }
    const last = events.at(-1); error ??= last?.type === 'error' ? last.error : undefined;
    return { stdout: events.filter(e => e.type === 'output' || e.type === 'input').map(e => e.text ?? e.prompt).join(''), compileSuccess, errorType: error?.pythonType ?? (error ? error.category === 'syntax' || error.category === 'unsupported' ? 'SyntaxError' : 'InternalError' : null), message: error?.message ?? null, file: error ? error.fileName ?? 'main.py' : null, line: error?.line ?? null, column: error?.column ?? null, errorCategory: error?.category, completion: error ? 'error' : last?.type ?? 'no-result', files: Object.fromEntries([...files].filter(([name]) => /\.(txt|csv)$/.test(name))), graphicsCount: events.filter(e => e.type === 'graphics').reduce((n,e) => n + e.commands.length, 0), inputRequests: events.filter(e => e.type === 'input').length };
  }
  return { run, close: () => server.close() };
}
