"""Integration test verifying M2 Observer Client against real QA server:
1. Fresh QA party (tick starting from scratch, 2 colonies, default workers)
2. Fixture party (loaded from genuine server snapshot with tick 12345, buildings, and carrying residents)
Verifies protocol v21, entity counts, IDs, both colonies, and clean lifecycle.
"""

import os
import sys
import time
import json
import socket
import struct
import base64
import subprocess

REPO_ROOT = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.path.insert(0, REPO_ROOT)

from scripts.godot.qa_server import (
    start_server, is_port_in_use, request_stop,
    kill_process_tree, get_allowed_qa_root
)

def ws_read_snapshot(port: int, timeout: float = 12.0) -> dict:
    s = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    req = (
        f"GET / HTTP/1.1\r\n"
        f"Host: 127.0.0.1:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode("ascii"))
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = s.recv(4096)
        if not chunk:
            raise ConnectionError("Connection closed during WebSocket handshake")
        resp += chunk
    header, rest = resp.split(b"\r\n\r\n", 1)
    status_line = header.split(b"\r\n")[0]
    if b"101" not in status_line:
        raise ConnectionError(f"Handshake failed: {status_line}")

    buf = rest
    def read_exact(n):
        nonlocal buf
        while len(buf) < n:
            chunk = s.recv(4096)
            if not chunk:
                raise ConnectionError("Connection closed during frame read")
            buf += chunk
        res = buf[:n]
        buf = buf[n:]
        return res

    b1, b2 = struct.unpack("!BB", read_exact(2))
    length = b2 & 0x7f
    if length == 126:
        length, = struct.unpack("!H", read_exact(2))
    elif length == 127:
        length, = struct.unpack("!Q", read_exact(8))
    masked = bool(b2 & 0x80)
    mask = read_exact(4) if masked else None
    data = read_exact(length)
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.close()
    return json.loads(data.decode("utf-8"))

def run_integration_tests():
    qa_root = os.path.join(REPO_ROOT, "tmp", "qa")
    os.makedirs(qa_root, exist_ok=True)
    os.environ["CLAYFOLK_QA_ROOT"] = qa_root

    print("=== M2 INTEGRATION RUN 1: FRESH QA PARTY ===")
    port1 = 8788
    state_dir1 = os.path.join(qa_root, "integration_fresh")
    os.makedirs(state_dir1, exist_ok=True)

    qa_cmd1 = [
        sys.executable, "-B",
        os.path.join(REPO_ROOT, "scripts", "godot", "qa_server.py"),
        "--port", str(port1),
        "--state-dir", state_dir1,
        "--reset"
    ]
    proc1 = subprocess.Popen(qa_cmd1, cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # Wait for port1 to listen
        ready1 = False
        for _ in range(60):
            time.sleep(0.25)
            if is_port_in_use(port1):
                ready1 = True
                break
            if proc1.poll() is not None:
                break
        assert ready1, f"Server 1 failed to bind port {port1}!"

        # Read snapshot from server 1
        snap1 = ws_read_snapshot(port1)
        assert snap1.get("snapshotVersion") == 21, "Must be protocol v21"
        assert len(snap1.get("colonies", [])) == 2, "Must have 2 colonies"
        ants1 = snap1.get("ants", [])
        assert len(ants1) >= 16, f"Fresh world must have >= 16 workers, got {len(ants1)}"
        c1_ants = [a for a in ants1 if a.get("colonyId") in ["colony-1", "0"]]
        c2_ants = [a for a in ants1 if a.get("colonyId") in ["colony-2", "1"]]
        assert len(c1_ants) > 0 and len(c2_ants) > 0, "Both tribes must have active surface residents"
        print(f"  PASS: Fresh party connected! Tick={snap1.get('tick')}, Colonies=2, Surface residents={len(ants1)} (C1: {len(c1_ants)}, C2: {len(c2_ants)})")

        # Stop server 1 cleanly
        request_stop(state_dir1)
        proc1.wait(timeout=10)
        assert proc1.poll() == 0, "Server 1 must exit cleanly with code 0"
        time.sleep(0.5)
        assert not is_port_in_use(port1), "Port 8788 must be freed"
        print("  PASS: Server 1 stopped and resources freed cleanly")
    finally:
        if proc1.poll() is None:
            kill_process_tree(proc1.pid)

    print("\n=== M2 INTEGRATION RUN 2: VALID QA FIXTURE SNAPSHOT (Tick 12345) ===")
    port2 = 8789
    state_dir2 = os.path.join(qa_root, "integration_fixture")
    os.makedirs(state_dir2, exist_ok=True)
    fixture_dir = os.path.join(qa_root, "fixtures")
    os.makedirs(fixture_dir, exist_ok=True)
    fixture_file = os.path.join(fixture_dir, "fixture_12345.json")

    # Generate genuine fixture with tick 12345
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    export_script = os.path.join(REPO_ROOT, "scripts", "godot", "export_fixture.ts")
    subprocess.run([npx_cmd, "tsx", export_script, fixture_file, "12345"], cwd=REPO_ROOT, check=True)

    with open(fixture_file, "r", encoding="utf-8") as f:
        f_data = json.load(f)
    assert f_data.get("tick") == 12345

    qa_cmd2 = [
        sys.executable, "-B",
        os.path.join(REPO_ROOT, "scripts", "godot", "qa_server.py"),
        "--port", str(port2),
        "--state-dir", state_dir2,
        "--fixture", fixture_file
    ]
    proc2 = subprocess.Popen(qa_cmd2, cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ready2 = False
        for _ in range(60):
            time.sleep(0.25)
            if is_port_in_use(port2):
                ready2 = True
                break
            if proc2.poll() is not None:
                break
        assert ready2, f"Server 2 failed to bind port {port2}!"

        # Read snapshot from server 2
        snap2 = ws_read_snapshot(port2)
        assert snap2.get("snapshotVersion") == 21, "Must be protocol v21"
        assert snap2.get("tick", 0) >= 12345, f"Must have loaded tick 12345 fixture, got {snap2.get('tick')}"
        assert len(snap2.get("colonies", [])) == 2, "Must have 2 colonies"
        ants2 = snap2.get("ants", [])
        assert len(ants2) == len(f_data.get("ants", [])), "Resident count must match fixture"
        print(f"  PASS: Fixture party connected! Tick={snap2.get('tick')} (>= 12345), Colonies=2, Surface residents={len(ants2)}")

        # Stop server 2 cleanly
        request_stop(state_dir2)
        proc2.wait(timeout=10)
        assert proc2.poll() == 0, "Server 2 must exit cleanly with code 0"
        time.sleep(0.5)
        assert not is_port_in_use(port2), "Port 8789 must be freed"
        print("  PASS: Server 2 stopped and resources freed cleanly")
    finally:
        if proc2.poll() is None:
            kill_process_tree(proc2.pid)

    print("\n=== ALL M2 INTEGRATION TESTS PASSED WITH FLYING COLORS! ===")

if __name__ == "__main__":
    run_integration_tests()
