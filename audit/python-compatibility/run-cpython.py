"""Developer-only bounded oracle. The parent cleans its owned directory after exit."""
import contextlib, datetime, io, json, locale, os, pathlib, sys, time, traceback, unicodedata

request = json.load(sys.stdin)
protocol = sys.stdout


def emit(event, **fields):
    protocol.write(json.dumps(dict(event=event, **fields), ensure_ascii=False) + "\n")
    protocol.flush()


emit("ready", pid=os.getpid())
setup_start = time.perf_counter()
locale.setlocale(locale.LC_ALL, "C")
if hasattr(time, "tzset"):
    time.tzset()
root = pathlib.Path(request["directory"]).resolve(strict=True)
if root != pathlib.Path.cwd().resolve():
    raise RuntimeError("Oracle cwd must be its unique owned directory")
sys.path.insert(0, str(root))
sys.dont_write_bytecode = True
for file in request.get("files", []):
    filename = file["name"]
    if pathlib.Path(filename).name != filename or filename in (".", ".."):
        raise RuntimeError("Audit fixture must be a flat relative name")
    (root / filename).write_bytes(file["content"].encode(file.get("encoding", "utf-8")))
if request.get("oracleDate"):
    fixed_date = datetime.date.fromisoformat(request["oracleDate"])
    original_date = datetime.date

    class AuditDate(original_date):
        @classmethod
        def today(cls):
            return cls(fixed_date.year, fixed_date.month, fixed_date.day)

    datetime.date = AuditDate


class OutputLimit(BaseException):
    pass


budget = {"bytes": 0}


class Capture(io.StringIO):
    def write(self, text):
        size = len(text.encode("utf-8"))
        if budget["bytes"] + size > request["outputLimit"]:
            raise OutputLimit("captured-output-limit")
        budget["bytes"] += size
        return super().write(text)


stdout, stderr = Capture(), Capture()
sys.stdin = io.StringIO("\n".join(request.get("input", [])) + ("\n" if request.get("input") else ""))
timings = {"setupMs": (time.perf_counter() - setup_start) * 1000, "fileWriteMs": 0, "fileOpenMs": 0, "fileCloseMs": 0}
profile_stack = []


def profile(frame, event, function):
    if event == "c_call":
        name = getattr(function, "__name__", "")
        owner = getattr(function, "__self__", None)
        metric = {"write": "fileWriteMs", "close": "fileCloseMs"}.get(name) if isinstance(owner, io.TextIOWrapper) else "fileOpenMs" if function is io.open or function is open else None
        profile_stack.append((metric, time.perf_counter()))
    elif event in ("c_return", "c_exception") and profile_stack:
        metric, start = profile_stack.pop()
        if metric:
            timings[metric] += (time.perf_counter() - start) * 1000


result = {"stdout": "", "stderr": "", "errorType": None, "message": None, "file": None, "line": None, "column": None, "completion": "complete"}
emit("execute")
execute_start = time.perf_counter()
with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
    try:
        if request.get("profileFiles"):
            sys.setprofile(profile)
        exec(compile(request["code"], "main.py", "exec"), {"__name__": "__main__", "__file__": str(root / "main.py")})
    except OutputLimit as error:
        result.update(errorType="AuditError", message=str(error), completion="harness-error")
    except BaseException as error:
        result.update(errorType=type(error).__name__, message=str(error), completion="error")
        if isinstance(error, SyntaxError):
            result.update(file=pathlib.Path(error.filename or "main.py").name, line=error.lineno, column=error.offset)
        else:
            frames = traceback.extract_tb(error.__traceback__)
            relevant = [f for f in frames if f.filename == "main.py" or pathlib.Path(f.filename).parent == root]
            if relevant:
                f = relevant[-1]
                result.update(file=pathlib.Path(f.filename).name, line=f.lineno, column=f.colno + 1 if f.colno is not None else None)
    finally:
        sys.setprofile(None)
timings["executionMs"] = (time.perf_counter() - execute_start) * 1000
result.update(stdout=stdout.getvalue(), stderr=stderr.getvalue(), files={})
emit("collect")
collect_start = time.perf_counter()
file_bytes = 0
for file_path in sorted(root.iterdir()):
    if file_path.is_file() and file_path.suffix in (".txt", ".csv"):
        if file_path.is_symlink() or file_path.resolve().parent != root:
            raise RuntimeError("Oracle file escaped its owned root")
        file_bytes += file_path.stat().st_size
        if file_bytes > 2_000_000:
            result.update(errorType="AuditError", message="file-result-limit", completion="harness-error")
            break
        raw = file_path.read_bytes()
        encoding = next((f.get("encoding", "utf-8") for f in request.get("files", []) if f["name"] == file_path.name), "utf-8")
        try:
            result["files"][file_path.name] = raw.decode(encoding)
        except UnicodeError:
            result["files"][file_path.name] = {"hex": raw.hex(), "decodeError": True}
timings["collectionMs"] = (time.perf_counter() - collect_start) * 1000
result["timings"] = timings
result["environment"] = {"python": sys.version, "executable": sys.executable, "unicode": unicodedata.unidata_version, "recursionLimit": sys.getrecursionlimit(), "hashSeed": os.environ["PYTHONHASHSEED"], "hashRandomization": sys.flags.hash_randomization, "ignoreEnvironment": sys.flags.ignore_environment, "locale": locale.setlocale(locale.LC_ALL), "timezoneRequested": os.environ["TZ"], "timezoneActual": time.tzname, "tzsetAvailable": hasattr(time, "tzset"), "oracleDate": request.get("oracleDate"), "stdinEncoding": "utf-8", "stdoutEncoding": protocol.encoding, "newlines": "captured-verbatim", "pathSeparator": os.sep}
emit("result", result=result)
