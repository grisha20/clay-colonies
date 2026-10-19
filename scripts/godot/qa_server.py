"""Isolated QA Server Runner for Godot Migration.

Ensures that the QA server runs on a dedicated port (default: 8788)
with dedicated state files in tmp/qa/ (or custom dir), never touching production files.
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

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_QA_DIR = os.path.join(REPO_ROOT, "tmp", "qa")
DEFAULT_PORT = 8788

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

def validate_fixture(fixture_path: str) -> None:
    if not os.path.isfile(fixture_path):
        raise FileNotFoundError(f"Fixture file does not exist: {fixture_path}")
    try:
        with open(fixture_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError(f"Fixture root must be a JSON object, got {type(data).__name__}")
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
    state_dir = os.path.abspath(state_dir)

    # 1. PREFLIGHT CHECKS: Before any file modification!
    # A) Check port availability
    if is_port_in_use(port):
        print(f"[qa_server] PREFLIGHT ERROR: Port {port} is already in use! No files were modified.", file=sys.stderr)
        return 1

    # B) Validate fixture if provided
    if fixture_snapshot:
        fixture_snapshot = os.path.abspath(fixture_snapshot)
        try:
            validate_fixture(fixture_snapshot)
        except Exception as e:
            print(f"[qa_server] PREFLIGHT ERROR: {e}. No files were modified.", file=sys.stderr)
            return 1

    # 2. STATE INITIALIZATION (only after preflight succeeds)
    os.makedirs(state_dir, exist_ok=True)
    snapshot_file = os.path.join(state_dir, "snapshot.json")
    genome_file = os.path.join(state_dir, "genome.json")
    genome_file_b = os.path.join(state_dir, "genome-b.json")
    spider_genome_file = os.path.join(state_dir, "spider_genome.json")

    if reset_state:
        for f in [snapshot_file, f"{snapshot_file}.bak", f"{snapshot_file}.tmp"]:
            if os.path.exists(f):
                os.remove(f)
        print(f"[qa_server] Cleared QA snapshot files in {state_dir}")

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
    print(f"[qa_server] Isolated state dir: {state_dir}")

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
        # Wait briefly for OS to release the socket
        for _ in range(10):
            if not is_port_in_use(port):
                break
            time.sleep(0.1)
        print(f"[qa_server] QA server stopped. Port {port} freed.")

    return exit_code

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
