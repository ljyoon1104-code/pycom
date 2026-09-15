"""Bounded, isolated audit oracle. Never imported by the learning app."""
import contextlib, io, json, os, pathlib, sys, traceback, unicodedata
request = json.load(sys.stdin)
root = pathlib.Path(request['directory']).resolve()
root.mkdir(parents=True, exist_ok=True)
os.chdir(root)
sys.path.insert(0, str(root))
for file in request.get('files', []):
    path = pathlib.Path(file['name'])
    if path.name != file['name']:
        raise RuntimeError('Audit fixture must be a flat relative name')
    path.write_bytes(file['content'].encode(file.get('encoding', 'utf-8')))
source = request['code']
stdout, stderr = io.StringIO(), io.StringIO()
sys.stdin = io.StringIO('\n'.join(request.get('input', [])) + ('\n' if request.get('input') else ''))
result = {'stdout': '', 'errorType': None, 'message': None, 'file': None, 'line': None, 'column': None, 'completion': 'complete'}
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    try:
        exec(compile(source, 'main.py', 'exec'), {'__name__': '__main__', '__file__': str(root / 'main.py')})
    except BaseException as error:
        result.update(errorType=type(error).__name__, message=str(error), completion='error')
        if isinstance(error, SyntaxError):
            result.update(file=pathlib.Path(error.filename or 'main.py').name, line=error.lineno, column=error.offset)
        else:
            frames = traceback.extract_tb(error.__traceback__)
            relevant = [f for f in frames if f.filename == 'main.py' or pathlib.Path(f.filename).parent == root]
            if relevant:
                f = relevant[-1]
                result.update(file=pathlib.Path(f.filename).name, line=f.lineno, column=(f.colno + 1 if f.colno is not None else None))
result['stdout'] = stdout.getvalue()
result['files'] = {}
for path in root.iterdir():
    if path.is_file() and path.suffix in ('.txt', '.csv'):
        raw = path.read_bytes()
        encoding = next((f.get('encoding', 'utf-8') for f in request.get('files', []) if f['name'] == path.name), 'utf-8')
        try: result['files'][path.name] = raw.decode(encoding)
        except UnicodeError: result['files'][path.name] = {'hex': raw.hex(), 'decodeError': True}
result['environment'] = {'python': sys.version, 'executable': sys.executable, 'unicode': unicodedata.unidata_version, 'recursionLimit': sys.getrecursionlimit()}
print(json.dumps(result, ensure_ascii=True))
