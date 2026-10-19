"""GPU recording runner for M2 Network Observer Client.
Launches isolated QA server, records 24s live GPU tour via Godot Movie Maker,
converts to 1080p60 MP4 with ffmpeg, extracts keyframes, and cleanly terminates.
"""

import os
import sys
import time
import json
import subprocess

import socket
import struct
import base64
import shutil
import threading


REPO_ROOT = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.path.insert(0, REPO_ROOT)

from scripts.godot.qa_server import (
    start_server, is_port_in_use, request_stop,
    kill_process_tree
)

def ws_send_command(port: int, cmd: dict):
    s = socket.create_connection(("127.0.0.1", port), timeout=5.0)
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
            raise ConnectionError("WS handshake failed")
        resp += chunk
    payload = json.dumps(cmd).encode("utf-8")
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    header.extend(mask)
    header.extend(masked)
    s.sendall(header)
    # Receive frame acknowledgment from server so Node.js socket processes message before close
    try:
        s.settimeout(1.0)
        s.recv(2)
    except Exception:
        pass
    s.close()


def record_m2_tour():
    qa_root = os.path.join(REPO_ROOT, "tmp", "qa")
    os.makedirs(qa_root, exist_ok=True)
    os.environ["CLAYFOLK_QA_ROOT"] = qa_root

    out_dir = os.path.join(REPO_ROOT, "godot", "recordings", "m2_observer")
    os.makedirs(out_dir, exist_ok=True)

    qa_state_dir = os.path.join(qa_root, "recording_state")
    os.makedirs(qa_state_dir, exist_ok=True)

    # 1. Generate fixture with carrying residents for clear visual demonstration
    fixture_file = os.path.join(qa_root, "fixture_m2_recording.json")
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    export_script = os.path.join(REPO_ROOT, "scripts", "godot", "export_fixture.ts")
    subprocess.run([npx_cmd, "tsx", export_script, fixture_file, "1000"], cwd=REPO_ROOT, check=True)

    with open(fixture_file, "r", encoding="utf-8") as f:
        f_data = json.load(f)

    # Set several residents to carry state positioned north of camp walking south towards camera
    def configure_carrying_ants(ant_list, target_colony_id, alt_id, base_x):
        count = 0
        for ant in ant_list:
            if ant.get("colonyId") in [target_colony_id, alt_id]:
                ant["state"] = "carry"
                ant["carrying"] = 2
                ant["carryKind"] = "clay" if "1" in str(target_colony_id) else "wood"
                ant["pos"]["x"] = base_x + (count * 4.0)
                ant["pos"]["y"] = 200.0 + (count * 10.0)
                count += 1
                if count >= 4:
                    break

    # Apply to surface ants
    configure_carrying_ants(f_data.get("ants", []), "colony-1", "0", 120.0)
    configure_carrying_ants(f_data.get("ants", []), "colony-2", "1", 360.0)

    # Apply to colony ants (where worldFromSnapshot actually restores runtime ants!)
    for col in f_data.get("colonies", []):
        cid = str(col.get("id"))
        base_x = 120.0 if ("1" in cid or cid == "0") else 360.0
        configure_carrying_ants(col.get("ants", []), cid, "0" if base_x == 120.0 else "1", base_x)

    with open(fixture_file, "w", encoding="utf-8") as f:
        json.dump(f_data, f, indent=2)

    # 2. Launch QA Server on port 8788
    port = 8788
    qa_cmd = [
        sys.executable, "-B",
        os.path.join(REPO_ROOT, "scripts", "godot", "qa_server.py"),
        "--port", str(port),
        "--state-dir", qa_state_dir,
        "--fixture", fixture_file,
        "--reset"
    ]
    print(f"[Record] Launching isolated QA Server on port {port}...")
    server_proc = subprocess.Popen(qa_cmd, cwd=REPO_ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


    try:
        ready = False
        for _ in range(60):
            time.sleep(0.25)
            if is_port_in_use(port):
                ready = True
                break
            if server_proc.poll() is not None:
                break
        assert ready, f"QA server failed to bind port {port}!"
        print(f"[Record] QA Server listening on ws://localhost:{port}.")

        # 3. Launch Godot Movie Maker
        avi_path = "recordings/m2_observer/world_observer_live.avi"
        full_avi_path = os.path.join(REPO_ROOT, "godot", avi_path)
        if os.path.exists(full_avi_path):
            os.remove(full_avi_path)

        godot_bin = shutil.which("godot_console") or shutil.which("godot") or "godot_console"
        godot_cmd = [
            godot_bin,
            "--path", "godot",
            "--write-movie", avi_path,
            "scenes/game/world_observer.tscn",
            "--qa-port", str(port),
            "--test-recording"
        ]
        print(f"[Record] Starting Godot GPU Movie Maker tour (25 seconds @ 60 FPS) via {godot_bin}...")
        godot_proc = subprocess.run(godot_cmd, cwd=REPO_ROOT, check=False)
        print(f"[Record] Godot finished with exit code {godot_proc.returncode}.")

        assert os.path.exists(full_avi_path), f"Movie Maker output missing at {full_avi_path}!"
        avi_size_mb = os.path.getsize(full_avi_path) / (1024 * 1024)
        print(f"[Record] Rendered uncompressed AVI: {avi_size_mb:.1f} MB.")

        # 4. Transcode to high-quality MP4 using ffmpeg
        mp4_path = os.path.join(out_dir, "world_observer_live.mp4")
        if os.path.exists(mp4_path):
            os.remove(mp4_path)

        print("[Record] Encoding MP4 with H.264 / 60 FPS...")
        ff_cmd = [
            "ffmpeg", "-y",
            "-i", full_avi_path,
            "-c:v", "libx264",
            "-preset", "slow",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            mp4_path
        ]
        subprocess.run(ff_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        mp4_size_mb = os.path.getsize(mp4_path) / (1024 * 1024)
        print(f"[Record] Transcoded MP4: {mp4_size_mb:.2f} MB at {mp4_path}.")

        # Remove heavy intermediate AVI
        try:
            os.remove(full_avi_path)
        except Exception:
            pass

        # 5. Extract keyframes
        keyframes = [
            ("m2_01_colony1_camp.png", "00:00:02.000"),
            ("m2_02_carry_walk_front.png", "00:00:06.000"),
            ("m2_03_lake_shoreline.png", "00:00:10.000"),
            ("m2_04_colony2_stride.png", "00:00:14.500"),
            ("m2_05_paused_freeze.png", "00:00:18.500"),
            ("m2_06_disconnected_stall.png", "00:00:21.000"),
            ("m2_07_reconnected_clean.png", "00:00:23.500")
        ]
        for fname, timestamp in keyframes:
            kpath = os.path.join(out_dir, fname)
            subprocess.run([
                "ffmpeg", "-y",
                "-ss", timestamp,
                "-i", mp4_path,
                "-vframes", "1",
                "-q:v", "2",
                kpath
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"  Extracted keyframe: {fname} at {timestamp}")

        print("=== M2 GPU RECORDING & KEYFRAME EXTRACTION COMPLETE! ===")

    finally:
        print("[Record] Stopping isolated QA Server...")
        request_stop(qa_state_dir)
        try:
            server_proc.wait(timeout=5)
        except Exception:
            kill_process_tree(server_proc.pid)
        print("[Record] QA Server stopped cleanly.")

if __name__ == "__main__":
    record_m2_tour()
