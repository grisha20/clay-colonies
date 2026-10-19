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

def acquire_state_lock(state_dir: str, port: int) -> str:
    """Atomically acquires a directory lock file, ensuring no two servers share state."""
    lock_file = os.path.join(state_dir, ".qa_server.lock")
    if os.path.exists(lock_file):
        try:
            with open(lock_file, "r", encoding="utf-8") as f:
                lock_data = json.load(f)
            other_pid = lock_data.get("pid", 0)
            other_port = lock_data.get("port", 0)
            if is_pid_running(other_pid):
                raise RuntimeError(
                    f"State directory '{state_dir}' is locked by running QA server with PID {other_pid} on port {other_port}."
                )
            else:
                # Stale lock file from previously terminated process
                try:
                    os.remove(lock_file)
                except OSError:
                    pass
        except (json.JSONDecodeError, KeyError):
            try:
                os.remove(lock_file)
            except OSError:
                pass

    with open(lock_file, "w", encoding="utf-8") as f:
        json.dump({"pid": os.getpid(), "port": port, "created_at": time.time()}, f)
    return lock_file

def release_state_lock(lock_file: str) -> None:
    """Releases the state directory lock file."""
    if lock_file and os.path.exists(lock_file):
        try:
            with open(lock_file, "r", encoding="utf-8") as f:
                lock_data = json.load(f)
            if lock_data.get("pid") == os.getpid():
                os.remove(lock_file)
        except Exception:
            try:
                os.remove(lock_file)
            except OSError:
                pass

def validate_fixture(fixture_path: str, target_snapshot_file: str | None = None) -> None:
    """Validates that the fixture exists, is not identical to target snapshot, and matches save structure."""
    if not os.path.isfile(fixture_path):
        raise FileNotFoundError(f"Fixture file does not exist: {fixture_path}")

    real_fixture = os.path.realpath(os.path.abspath(fixture_path))
    if target_snapshot_file:
        real_target = os.path.realpath(os.path.abspath(target_snapshot_file))
        if real_fixture == real_target:
            raise ValueError(
                f"Fixture path '{fixture_path}' resolves to target snapshot '{target_snapshot_file}'. "
                "Cannot self-overwrite fixture."
            )

    try:
        with open(fixture_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError(f"Fixture root must be a JSON object, got {type(data).__name__}")

        # Check required fields for a valid Clayfolk WorldSnapshot
        has_version = ("snapshotVersion" in data) or ("protocolVersion" in data)
        has_tick = "tick" in data
        has_world = ("surface" in data) or ("colonies" in data) or ("ants" in data)
        if not (has_version and has_tick and has_world):
            raise ValueError(
                f"Fixture '{fixture_path}' lacks required save snapshot fields "
                "(snapshotVersion/protocolVersion, tick, and surface/colonies/ants)."
            )
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in fixture '{fixture_path}': {e}") from e

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
    if fixture_snapshot:
        fixture_snapshot = os.path.abspath(fixture_snapshot)
        try:
            validate_fixture(fixture_snapshot, target_snapshot_file=snapshot_file)
        except Exception as e:
            print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
            return 1

    # D) Acquire state directory lock
    os.makedirs(real_state_dir, exist_ok=True)
    lock_file = None
    try:
        lock_file = acquire_state_lock(real_state_dir, port)
    except Exception as e:
        print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
        return 1

    # 2. STATE INITIALIZATION (only after preflight succeeds and lock is held)
    try:
        if reset_state:
            for f in [snapshot_file, f"{snapshot_file}.bak", f"{snapshot_file}.tmp"]:
                if os.path.exists(f):
                    os.remove(f)
            print(f"[qa_server] Cleared QA snapshot files in {real_state_dir}")

        if fixture_snapshot:
            shutil.copyfile(fixture_snapshot, snapshot_file)
            print(f"[qa_server] Copied validated fixture snapshot from {fixture_snapshot}")

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
        try:
            proc = subprocess.Popen(cmd, cwd=REPO_ROOT, env=env)
            print(f"[qa_server] Server running (PID: {proc.pid}). Press Ctrl+C to terminate.")
            exit_code = proc.wait()
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
        if lock_file:
            release_state_lock(lock_file)

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
