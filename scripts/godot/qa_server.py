"""Isolated QA Server Runner for Godot Migration.

Ensures that the QA server runs on a dedicated port (default: 8788)
with dedicated state files in tmp/qa/ (or allowed custom dir), never touching production files.
Performs strict preflight checks before any file mutation or process launch.
"""

import os
import sys
import subprocess
import socket
import argparse
import json
import time
import shutil
import uuid
import threading

REPO_ROOT = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
DEFAULT_QA_DIR = os.path.join(REPO_ROOT, "tmp", "qa")
DEFAULT_PORT = 8788

def get_allowed_qa_root() -> str:
    """Returns the canonical root directory inside which QA state dirs are permitted."""
    custom_root = os.environ.get("CLAYFOLK_QA_ROOT")
    if custom_root:
        return os.path.realpath(os.path.abspath(custom_root))
    return os.path.realpath(DEFAULT_QA_DIR)

def is_pid_running(pid: int) -> bool:
    """Checks whether a process with the given PID is currently active."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        SYNCHRONIZE = 0x00100000
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Returns True if the port is currently bound or being listened on."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        if s.connect_ex((host, port)) == 0:
            return True
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return False
        except OSError:
            return True

def validate_state_dir(state_dir: str) -> str:
    """Validates that state_dir is strictly inside the allowed QA root and not the repository root."""
    real_state = os.path.realpath(os.path.abspath(state_dir))
    real_allowed = get_allowed_qa_root()
    real_repo = REPO_ROOT

    if real_state == real_repo:
        raise PermissionError(
            f"State directory '{state_dir}' is the repository root! Refusing to run in root."
        )

    # Must be inside real_allowed (or equal to real_allowed)
    try:
        common = os.path.commonpath([real_state, real_allowed])
    except ValueError as e:
        raise PermissionError(
            f"State directory '{state_dir}' is on a different drive than allowed QA root '{real_allowed}'"
        ) from e

    if common != real_allowed:
        raise PermissionError(
            f"State directory '{real_state}' is outside the allowed QA root '{real_allowed}'. "
            "Use paths under tmp/qa/ or configure CLAYFOLK_QA_ROOT."
        )

    return real_state

def is_path_inside_dir(path: str, parent_dir: str) -> bool:
    """Checks whether path resolves to or inside parent_dir."""
    real_path = os.path.realpath(os.path.abspath(path))
    real_parent = os.path.realpath(os.path.abspath(parent_dir))
    if real_path == real_parent:
        return True
    try:
        common = os.path.commonpath([real_path, real_parent])
        return common == real_parent
    except ValueError:
        return False

_LOCK_HANDLES: dict[str, tuple[any, str]] = {}

def _try_lock_file(f):
    if sys.platform == "win32":
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

def _unlock_file(f):
    if sys.platform == "win32":
        import msvcrt
        f.seek(0)
        try:
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
    else:
        import fcntl
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass

def acquire_state_lock(state_dir: str, port: int) -> str:
    """Atomically acquires an exclusive directory lock with OS handle backing and unique token."""
    import uuid
    import threading

    lock_dir = os.path.join(state_dir, ".qa_server.lock_dir")
    lock_token = uuid.uuid4().hex
    unique_suffix = f"{os.getpid()}_{threading.get_ident()}_{time.time_ns()}"
    tmp_dir = os.path.join(state_dir, f".qa_server.tmp_lock.{unique_suffix}")

    # Prepare candidate lock directory with complete ownership info
    os.makedirs(tmp_dir, exist_ok=True)
    info_file_tmp = os.path.join(tmp_dir, "owner.json")
    with open(info_file_tmp, "w", encoding="utf-8") as f:
        json.dump({"pid": os.getpid(), "port": port, "token": lock_token, "created_at": time.time()}, f)

    try:
        # Atomic rename: succeeds only if lock_dir does not exist
        os.rename(tmp_dir, lock_dir)
        handle_path = os.path.join(lock_dir, "handle.lock")
        h_file = open(handle_path, "a+b")
        try:
            _try_lock_file(h_file)
        except Exception as e:
            h_file.close()
            shutil.rmtree(lock_dir, ignore_errors=True)
            raise RuntimeError(f"Failed to acquire file lock handle: {e}")
        _LOCK_HANDLES[lock_dir] = (h_file, lock_token)
        return lock_dir
    except (FileExistsError, OSError):
        # Target lock_dir exists. Cleanup tmp_dir
        shutil.rmtree(tmp_dir, ignore_errors=True)

        # Inspect existing lock_dir
        info_file = os.path.join(lock_dir, "owner.json")
        existing_pid = None
        existing_port = None
        existing_token = None
        if os.path.exists(info_file):
            try:
                with open(info_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                existing_pid = data.get("pid")
                existing_port = data.get("port")
                existing_token = data.get("token")
            except Exception:
                pass

        # Check if existing lock is active via PID
        if existing_pid and is_pid_running(existing_pid):
            raise RuntimeError(
                f"State directory '{state_dir}' is locked by running QA server with PID {existing_pid} on port {existing_port}."
            )

        # Test OS file lock on existing handle.lock
        existing_handle_path = os.path.join(lock_dir, "handle.lock")
        is_held_by_os = False
        if os.path.exists(existing_handle_path):
            try:
                test_h = open(existing_handle_path, "a+b")
                try:
                    _try_lock_file(test_h)
                    _unlock_file(test_h)
                except Exception:
                    is_held_by_os = True
                finally:
                    test_h.close()
            except Exception:
                is_held_by_os = True

        if is_held_by_os:
            raise RuntimeError(
                f"State directory '{state_dir}' is locked by an active process holding OS lock handle."
            )

        # Stale lock recovery: existing PID is dead and handle is not held.
        # Acquire OS lock on existing handle.lock FIRST to serialize recovery
        rec_h = open(existing_handle_path, "a+b")
        try:
            _try_lock_file(rec_h)
        except Exception:
            rec_h.close()
            raise RuntimeError(
                f"State directory '{state_dir}' lock recovery conflict: another process acquired handle."
            )

        # Under our exclusive hold, re-verify owner.json
        if os.path.exists(info_file):
            try:
                with open(info_file, "r", encoding="utf-8") as f:
                    curr_data = json.load(f)
                curr_pid = curr_data.get("pid")
                curr_token = curr_data.get("token")
                if curr_pid and is_pid_running(curr_pid) and curr_token != existing_token:
                    _unlock_file(rec_h)
                    rec_h.close()
                    raise RuntimeError(
                        f"State directory '{state_dir}' is now locked by running QA server with PID {curr_pid}."
                    )
            except Exception:
                pass

        # We exclusively own the lock. Overwrite owner.json with new token and PID
        with open(info_file, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": port, "token": lock_token, "created_at": time.time()}, f)

        _LOCK_HANDLES[lock_dir] = (rec_h, lock_token)
        return lock_dir

def release_state_lock(lock_dir: str, token: str | None = None) -> None:
    """Releases the state directory lock only if owned by this process with matching token."""
    if not lock_dir or not os.path.isdir(lock_dir):
        return

    info_file = os.path.join(lock_dir, "owner.json")
    file_token = None
    file_pid = None
    if os.path.exists(info_file):
        try:
            with open(info_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            file_token = data.get("token")
            file_pid = data.get("pid")
        except Exception:
            pass

    # If an alien token was provided, abort immediately and leave lock untouched
    if token is not None and file_token is not None and file_token != token:
        return

    # If no token was provided, ensure PID matches current process
    if token is None and file_pid is not None and file_pid != os.getpid():
        return

    entry = _LOCK_HANDLES.pop(lock_dir, None)
    h_file = None
    if entry:
        h_file, my_token = entry
        if token is not None and my_token != token:
            # Token mismatch with our own recorded handle; restore and abort
            _LOCK_HANDLES[lock_dir] = entry
            return

    try:
        if h_file:
            try:
                _unlock_file(h_file)
            except Exception:
                pass
            h_file.close()

        shutil.rmtree(lock_dir, ignore_errors=True)
    except Exception:
        pass

def validate_and_stage_fixture(fixture_path: str, target_state_dir: str) -> dict:
    """Strictly validates a WorldSnapshot fixture and verifies it is outside target_state_dir."""
    if not os.path.isfile(fixture_path):
        raise FileNotFoundError(f"Fixture file does not exist: {fixture_path}")

    # Reject if fixture is anywhere inside the target state dir (prevents self-overwrite and deletion of .bak/.tmp)
    if is_path_inside_dir(fixture_path, target_state_dir):
        raise ValueError(
            f"Fixture path '{fixture_path}' resolves inside target state directory '{target_state_dir}'. "
            "Cannot use mutable state directory files as fixture source."
        )

    try:
        with open(fixture_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in fixture '{fixture_path}': {e}") from e

    if not isinstance(data, dict):
        raise ValueError(f"Fixture root must be a JSON object, got {type(data).__name__}")

    version = data.get("snapshotVersion")
    if not isinstance(version, int) or isinstance(version, bool) or not (13 <= version <= 21):
        raise ValueError(
            f"Fixture '{fixture_path}' has invalid snapshotVersion: {version!r}. Must be an integer between 13 and 21."
        )

    tick = data.get("tick")
    if not isinstance(tick, int) or isinstance(tick, bool) or tick < 0:
        raise ValueError(
            f"Fixture '{fixture_path}' has invalid tick: {tick!r}. Must be a non-negative integer."
        )

    surface = data.get("surface")
    if not isinstance(surface, dict):
        raise ValueError(f"Fixture '{fixture_path}' missing or invalid 'surface' object.")
    w = surface.get("width")
    h = surface.get("height")
    if not isinstance(w, int) or isinstance(w, bool) or w <= 0 or not isinstance(h, int) or isinstance(h, bool) or h <= 0:
        raise ValueError(f"Fixture '{fixture_path}' surface must have positive integer width and height.")
    for field in ["buildings", "foodSources", "resourceNodes"]:
        if field in surface and not isinstance(surface[field], list):
            raise ValueError(f"Fixture '{fixture_path}' surface.{field} must be a list if present.")

    colonies = data.get("colonies")
    if not isinstance(colonies, list) or len(colonies) == 0:
        raise ValueError(f"Fixture '{fixture_path}' 'colonies' must be a non-empty list.")
    for i, c in enumerate(colonies):
        if not isinstance(c, dict):
            raise ValueError(f"Fixture '{fixture_path}' colonies[{i}] must be an object.")
        if "id" not in c or not isinstance(c.get("ants"), list):
            raise ValueError(f"Fixture '{fixture_path}' colonies[{i}] must contain 'id' and 'ants' list.")
        colony_obj = c.get("colony")
        if not isinstance(colony_obj, dict):
            raise ValueError(f"Fixture '{fixture_path}' colonies[{i}] missing or invalid 'colony' object.")
        pop = colony_obj.get("population")
        if not isinstance(pop, dict):
            raise ValueError(f"Fixture '{fixture_path}' colonies[{i}].colony missing or invalid 'population' object.")
        for pop_field in ["workers", "scouts", "nurses", "eggs", "larvae"]:
            val = pop.get(pop_field)
            if val is not None and (not isinstance(val, int) or isinstance(val, bool) or val < 0):
                raise ValueError(f"Fixture '{fixture_path}' colonies[{i}].colony.population.{pop_field} must be a non-negative integer.")

    return data

def validate_fixture(fixture_path: str, target_snapshot_file: str | None = None) -> None:
    """Backwards-compatible wrapper for unit tests."""
    state_dir = os.path.dirname(target_snapshot_file) if target_snapshot_file else DEFAULT_QA_DIR
    validate_and_stage_fixture(fixture_path, state_dir)

def kill_process_tree(pid: int) -> None:
    """Cleanly terminates the process and all its children on Windows/Unix."""
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                check=False
            )
        except Exception:
            pass
    else:
        try:
            import signal
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except Exception:
            pass

def request_stop(state_dir: str) -> bool:
    """Signals an active QA server running on state_dir to stop gracefully."""
    try:
        real_state = validate_state_dir(state_dir)
        stop_file = os.path.join(real_state, ".qa_server.stop")
        with open(stop_file, "w", encoding="utf-8") as f:
            f.write(str(time.time()))
        return True
    except Exception:
        return False

def start_server(
    port: int = DEFAULT_PORT,
    reset_state: bool = False,
    fixture_snapshot: str | None = None,
    state_dir: str = DEFAULT_QA_DIR
) -> int:
    # 1. PREFLIGHT CHECKS: Before any file modification!
    # A) Validate state_dir path security
    try:
        real_state_dir = validate_state_dir(state_dir)
    except Exception as e:
        print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
        return 1

    # B) Check port availability
    if is_port_in_use(port):
        print(f"[qa_server] PREFLIGHT ERROR: Port {port} is already in use! No files were modified.", file=sys.stderr)
        return 1

    snapshot_file = os.path.join(real_state_dir, "snapshot.json")
    genome_file = os.path.join(real_state_dir, "genome.json")
    genome_file_b = os.path.join(real_state_dir, "genome-b.json")
    spider_genome_file = os.path.join(real_state_dir, "spider_genome.json")

    # C) Validate fixture if provided (BEFORE reset_state!)
    fixture_data = None
    if fixture_snapshot:
        fixture_snapshot = os.path.abspath(fixture_snapshot)
        try:
            fixture_data = validate_and_stage_fixture(fixture_snapshot, target_state_dir=real_state_dir)
        except Exception as e:
            print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
            return 1

    # D) Acquire state directory lock
    os.makedirs(real_state_dir, exist_ok=True)
    lock_dir = None
    try:
        lock_dir = acquire_state_lock(real_state_dir, port)
    except Exception as e:
        print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
        return 1

    # 2. STATE INITIALIZATION (only after preflight succeeds and lock is held)
    try:
        if fixture_data is not None:
            # Stage to temporary file in target state directory
            staging_file = os.path.join(real_state_dir, f".snapshot_staged_{uuid.uuid4().hex}.tmp")
            try:
                with open(staging_file, "w", encoding="utf-8") as f:
                    json.dump(fixture_data, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                # Atomic replace destination: old snapshot is untouched if dump/write failed
                os.replace(staging_file, snapshot_file)
                if reset_state:
                    for bak in [f"{snapshot_file}.bak", f"{snapshot_file}.tmp"]:
                        if os.path.exists(bak):
                            os.remove(bak)
                print(f"[qa_server] Initialized validated fixture snapshot from {fixture_snapshot}")
            except Exception as e:
                if os.path.exists(staging_file):
                    os.remove(staging_file)
                print(f"[qa_server] ERROR: Failed to stage fixture snapshot: {e}", file=sys.stderr)
                return 1
        elif reset_state:
            for f in [snapshot_file, f"{snapshot_file}.bak", f"{snapshot_file}.tmp"]:
                if os.path.exists(f):
                    os.remove(f)
            print(f"[qa_server] Cleared QA snapshot files in {real_state_dir}")

        # 3. ENVIRONMENT ISOLATION
        env = os.environ.copy()
        env["PORT"] = str(port)
        env["SNAPSHOT_FILE"] = snapshot_file
        env["GENOME_FILE"] = genome_file
        env["GENOME_FILE_B"] = genome_file_b
        env["SPIDER_GENOME_FILE"] = spider_genome_file

        print(f"[qa_server] Starting isolated QA server on ws://localhost:{port}...")
        print(f"[qa_server] Isolated state dir: {real_state_dir}")

        # 4. PROCESS EXECUTION & LIFECYCLE MANAGEMENT
        cmd = ["npx.cmd" if sys.platform == "win32" else "npx", "tsx", "server/src/index.ts"]
        proc = None
        exit_code = 0
        stop_requested = False
        stop_file = os.path.join(real_state_dir, ".qa_server.stop")
        if os.path.exists(stop_file):
            try:
                os.remove(stop_file)
            except Exception:
                pass

        def _stop_watcher():
            nonlocal stop_requested
            while proc and proc.poll() is None:
                if os.path.exists(stop_file):
                    stop_requested = True
                    try:
                        os.remove(stop_file)
                    except Exception:
                        pass
                    if proc and proc.poll() is None:
                        kill_process_tree(proc.pid)
                    break
                time.sleep(0.1)

        try:
            proc = subprocess.Popen(cmd, cwd=REPO_ROOT, env=env)
            print(f"[qa_server] Server running (PID: {proc.pid}). Press Ctrl+C or touch .qa_server.stop to terminate.")

            watcher_thread = threading.Thread(target=_stop_watcher, daemon=True)
            watcher_thread.start()

            raw_code = proc.wait()
            if stop_requested:
                exit_code = 0
            else:
                exit_code = raw_code
                if exit_code != 0:
                    print(f"[qa_server] Server process exited with code {exit_code}", file=sys.stderr)
        except KeyboardInterrupt:
            print("\n[qa_server] Stopping QA server process tree...")
        except Exception as e:
            print(f"[qa_server] Process launch error: {e}", file=sys.stderr)
            exit_code = 1
        finally:
            if proc and proc.poll() is None:
                kill_process_tree(proc.pid)
                try:
                    proc.wait(timeout=3)
                except Exception:
                    pass

            # Verify that port was actually freed
            port_freed = False
            for _ in range(20):
                if not is_port_in_use(port):
                    port_freed = True
                    break
                time.sleep(0.1)

            if port_freed:
                print(f"[qa_server] QA server stopped. Port {port} freed.")
            else:
                print(f"[qa_server] ERROR: Port {port} could not be freed after stopping server!", file=sys.stderr)
                if exit_code == 0:
                    exit_code = 2

        return exit_code
    finally:
        if lock_dir:
            release_state_lock(lock_dir)

def main() -> None:
    parser = argparse.ArgumentParser(description="Run isolated Clayfolk QA server for Godot tests.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"WebSocket port (default: {DEFAULT_PORT})")
    parser.add_argument("--reset", action="store_true", help="Reset QA world state before start")
    parser.add_argument("--fixture", type=str, default=None, help="Path to initial snapshot fixture JSON")
    parser.add_argument("--state-dir", type=str, default=DEFAULT_QA_DIR, help=f"Directory for QA state files (default: {DEFAULT_QA_DIR})")
    args = parser.parse_args()

    code = start_server(
        port=args.port,
        reset_state=args.reset,
        fixture_snapshot=args.fixture,
        state_dir=args.state_dir
    )
    sys.exit(code)

if __name__ == "__main__":
    main()
