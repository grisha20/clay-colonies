"""Launch the current Godot game and start menu with an isolated QA server."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.godot.qa_server import is_port_in_use, request_stop


def main() -> int:
    godot = shutil.which("godot_console") or shutil.which("godot")
    if not godot:
        print("Godot was not found in PATH.")
        return 1
    port = 8788
    if is_port_in_use(port):
        print("Port 8788 is busy. Close the previous Godot preview and try again.")
        return 1

    state_dir = REPO_ROOT / "tmp" / "qa" / "play"
    state_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["CLAYFOLK_QA_ROOT"] = str(REPO_ROOT / "tmp" / "qa")
    log_path = state_dir / "launcher-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        server = subprocess.Popen(
            [sys.executable, "-B", str(REPO_ROOT / "scripts/godot/qa_server.py"),
             "--port", str(port), "--state-dir", str(state_dir)],
            cwd=REPO_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            deadline = time.monotonic() + 30
            while not is_port_in_use(port):
                if server.poll() is not None or time.monotonic() >= deadline:
                    print(f"QA server failed to start. See {log_path}")
                    return 1
                time.sleep(0.2)
            if server.poll() is not None:
                print(f"QA server exited. See {log_path}")
                return 1
            print("Opening Clayfolk Godot. Close the game to save and stop the preview.")
            return subprocess.call(
                [godot, "--path", str(REPO_ROOT / "godot"), "--",
                 "--menu-address", f"ws://127.0.0.1:{port}"],
                cwd=REPO_ROOT,
            )
        finally:
            if server.poll() is None:
                request_stop(str(state_dir))
                try:
                    server.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    # Never kill unrelated Node/Godot processes.
                    print(f"QA server has not stopped yet. See {log_path}")


if __name__ == "__main__":
    sys.exit(main())
