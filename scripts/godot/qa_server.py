"""Isolated QA Server Runner for Godot Migration.

Ensures that the QA server runs on a dedicated port (default: 8788)
with dedicated state files in tmp/qa/, never touching production files.
"""

import os
import sys
import subprocess
import socket
import argparse
import time

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
QA_DIR = os.path.join(REPO_ROOT, "tmp", "qa")
DEFAULT_PORT = 8788

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0

def start_server(port: int = DEFAULT_PORT, reset_state: bool = False, fixture_snapshot: str | None = None):
    os.makedirs(QA_DIR, exist_ok=True)
    snapshot_file = os.path.join(QA_DIR, "snapshot.json")
    genome_file = os.path.join(QA_DIR, "genome.json")
    genome_file_b = os.path.join(QA_DIR, "genome-b.json")
    spider_genome_file = os.path.join(QA_DIR, "spider_genome.json")

    if reset_state:
        for f in [snapshot_file, f"{snapshot_file}.bak", f"{snapshot_file}.tmp"]:
            if os.path.exists(f):
                os.remove(f)
        print("[qa_server] Cleared existing QA snapshot files.")

    if fixture_snapshot and os.path.exists(fixture_snapshot):
        import shutil
        shutil.copyfile(fixture_snapshot, snapshot_file)
        print(f"[qa_server] Copied fixture snapshot from {fixture_snapshot}")

    if is_port_in_use(port):
        print(f"[qa_server] ERROR: Port {port} is already in use! Exiting.")
        sys.exit(1)

    env = os.environ.copy()
    env["PORT"] = str(port)
    env["SNAPSHOT_FILE"] = snapshot_file
    env["GENOME_FILE"] = genome_file
    env["GENOME_FILE_B"] = genome_file_b
    env["SPIDER_GENOME_FILE"] = spider_genome_file

    print(f"[qa_server] Starting QA Server on ws://localhost:{port}...")
    print(f"[qa_server] State files in: {QA_DIR}")

    # Run tsx server/src/index.ts
    cmd = ["npx.cmd", "tsx", "server/src/index.ts"]
    try:
        proc = subprocess.Popen(cmd, cwd=REPO_ROOT, env=env)
        print(f"[qa_server] Server running (PID: {proc.pid}). Press Ctrl+C to terminate.")
        proc.wait()
    except KeyboardInterrupt:
        print("[qa_server] Stopping QA server...")
        proc.terminate()
        proc.wait()
        print("[qa_server] Stopped.")

def main():
    parser = argparse.ArgumentParser(description="Run isolated Clayfolk QA server for Godot tests.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="WebSocket port (default: 8788)")
    parser.add_argument("--reset", action="store_true", help="Reset QA world state before start")
    parser.add_argument("--fixture", type=str, default=None, help="Path to initial snapshot fixture")
    args = parser.parse_args()

    start_server(port=args.port, reset_state=args.reset, fixture_snapshot=args.fixture)

if __name__ == "__main__":
    main()
