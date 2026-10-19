"""Unit tests for scripts/godot/qa_server.py preflight and lifecycle."""

import os
import sys
import socket
import tempfile
import unittest
import json

# Add repo root to path
REPO_ROOT = os.path.realpath(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
sys.path.insert(0, REPO_ROOT)

from scripts.godot.qa_server import start_server, is_port_in_use, validate_fixture, validate_state_dir

class TestQAServer(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        # Set allowed QA root to the temporary directory for clean isolated tests
        os.environ["CLAYFOLK_QA_ROOT"] = self.temp_dir.name
        self.state_dir = os.path.join(self.temp_dir.name, "qa_state")
        os.makedirs(self.state_dir, exist_ok=True)
        # Create a test snapshot file
        self.test_snap = os.path.join(self.state_dir, "snapshot.json")
        with open(self.test_snap, "w", encoding="utf-8") as f:
            f.write('{"test": true}')

    def tearDown(self):
        if "CLAYFOLK_QA_ROOT" in os.environ:
            del os.environ["CLAYFOLK_QA_ROOT"]
        self.temp_dir.cleanup()

    def test_preflight_disallows_repo_root_or_outside_allowed_root(self):
        """State directory must not be the repository root or outside allowed QA root."""
        # 1. Repo root
        with self.assertRaises(PermissionError):
            validate_state_dir(REPO_ROOT)
        ret = start_server(port=9999, state_dir=REPO_ROOT)
        self.assertEqual(ret, 1)

        # 2. Outside directory
        outside_dir = os.path.realpath(os.path.abspath(os.path.join(self.temp_dir.name, "..", "forbidden_dir")))
        with self.assertRaises(PermissionError):
            validate_state_dir(outside_dir)
        ret = start_server(port=9999, state_dir=outside_dir)
        self.assertEqual(ret, 1)

    def test_preflight_port_in_use_preserves_files(self):
        """When port is occupied, start_server must fail with code 1 and NOT touch state files."""
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        bound_port = s.getsockname()[1]

        try:
            self.assertTrue(is_port_in_use(bound_port))
            ret = start_server(port=bound_port, reset_state=True, state_dir=self.state_dir)
            self.assertEqual(ret, 1)
            # Verify file was NOT deleted!
            self.assertTrue(os.path.exists(self.test_snap), "Snapshot must NOT be deleted when port is in use!")
            with open(self.test_snap, "r", encoding="utf-8") as f:
                self.assertEqual(f.read(), '{"test": true}')
        finally:
            s.close()

    def test_preflight_invalid_fixture_preserves_files(self):
        """When fixture is missing or invalid JSON, start_server must fail and NOT delete state."""
        bad_fixture = os.path.join(self.temp_dir.name, "nonexistent.json")
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=bad_fixture, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap), "Snapshot must NOT be deleted when fixture is invalid!")

        corrupt_fixture = os.path.join(self.temp_dir.name, "corrupt.json")
        with open(corrupt_fixture, "w", encoding="utf-8") as f:
            f.write('{ not valid json')
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=corrupt_fixture, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap), "Snapshot must NOT be deleted when fixture is corrupt JSON!")

    def test_preflight_fixture_schema_validation(self):
        """Fixture must strictly match WorldSnapshot schema and reject invalid types."""
        # 1. Invalid version (e.g. string or out of range)
        for bad_version in ["21", 99, 5, True]:
            fpath = os.path.join(self.temp_dir.name, "bad_ver.json")
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump({"snapshotVersion": bad_version, "tick": 0, "surface": {"width": 480, "height": 480}, "colonies": [{"id": 0, "ants": []}]}, f)
            with self.assertRaises(ValueError):
                validate_fixture(fpath, target_snapshot_file=self.test_snap)

        # 2. Invalid tick (string, negative, boolean)
        for bad_tick in ["not-a-number", -5, True]:
            fpath = os.path.join(self.temp_dir.name, "bad_tick.json")
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump({"snapshotVersion": 21, "tick": bad_tick, "surface": {"width": 480, "height": 480}, "colonies": [{"id": 0, "ants": []}]}, f)
            with self.assertRaises(ValueError):
                validate_fixture(fpath, target_snapshot_file=self.test_snap)

        # 3. Invalid colonies (empty list, null, not a list, ants null, invalid/missing colony/population object, negative counts)
        bad_col_cases = [
            [],
            None,
            "colony",
            [{"id": 0, "ants": None}],
            [{"id": 0, "ants": []}], # missing colony object entirely
            [{"id": 0, "ants": [], "colony": "not-a-dict"}],
            [{"id": 0, "ants": [], "colony": {}}], # missing population object
            [{"id": 0, "ants": [], "colony": {"population": "not-a-dict"}}],
            [{"id": 0, "ants": [], "colony": {"population": {"workers": -1}}}] # negative count
        ]
        for bad_colonies in bad_col_cases:
            fpath = os.path.join(self.temp_dir.name, "bad_col.json")
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump({"snapshotVersion": 21, "tick": 10, "surface": {"width": 480, "height": 480}, "colonies": bad_colonies}, f)
            with self.assertRaises(ValueError):
                validate_fixture(fpath, target_snapshot_file=self.test_snap)

        # 4. Valid WorldSnapshot with complete colony population schema must pass without error
        valid_schema_fixture = os.path.join(self.temp_dir.name, "valid_save.json")
        with open(valid_schema_fixture, "w", encoding="utf-8") as f:
            json.dump({
                "snapshotVersion": 21,
                "protocolVersion": 21,
                "tick": 100,
                "surface": {
                    "width": 480,
                    "height": 480,
                    "buildings": [],
                    "foodSources": [],
                    "resourceNodes": []
                },
                "colonies": [
                    {
                        "id": 0,
                        "color": "#e06030",
                        "colony": {
                            "population": {
                                "workers": 8,
                                "scouts": 2
                            },
                            "food": 100,
                            "clay": 50,
                            "wood": 30,
                            "stone": 20
                        },
                        "ants": []
                    }
                ]
            }, f)
        validate_fixture(valid_schema_fixture, target_snapshot_file=self.test_snap)

    def test_preflight_fixture_inside_state_dir_rejected(self):
        """Fixture path inside target state dir (.bak, .tmp, or snapshot.json) must be rejected and files preserved."""
        # Target snapshot
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=self.test_snap, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap))

        # Target snapshot.bak
        bak_file = os.path.join(self.state_dir, "snapshot.json.bak")
        with open(bak_file, "w", encoding="utf-8") as f:
            f.write('{"bak": true}')
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=bak_file, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(bak_file), "Fixture inside state dir (.bak) must NOT be deleted!")

        # Target snapshot.tmp
        tmp_file = os.path.join(self.state_dir, "snapshot.json.tmp")
        with open(tmp_file, "w", encoding="utf-8") as f:
            f.write('{"tmp": true}')
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=tmp_file, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(tmp_file), "Fixture inside state dir (.tmp) must NOT be deleted!")

    def test_atomic_directory_lock_conflict_and_stale_recovery(self):
        """Directory lock blocks running PID, and recovers cleanly when PID is dead."""
        from scripts.godot.qa_server import acquire_state_lock, release_state_lock

        # 1. Active lock
        lock_dir = acquire_state_lock(self.state_dir, 8788)
        self.assertTrue(os.path.isdir(lock_dir))

        # Second acquire while first is alive MUST fail
        with self.assertRaises(RuntimeError):
            acquire_state_lock(self.state_dir, 8789)

        # Release first lock
        release_state_lock(lock_dir)
        self.assertFalse(os.path.isdir(lock_dir))

        # 2. Stale lock recovery: write dead PID (e.g. 999999)
        os.mkdir(lock_dir)
        info_file = os.path.join(lock_dir, "owner.json")
        with open(info_file, "w", encoding="utf-8") as f:
            json.dump({"pid": 999999, "port": 8788, "token": "stale_token", "created_at": 1000.0}, f)

        # New acquire should recover stale lock and succeed
        new_lock = acquire_state_lock(self.state_dir, 8790)
        self.assertTrue(os.path.isdir(new_lock))
        release_state_lock(new_lock)

    def test_stale_recovery_race_cannot_steal_new_lock(self):
        """Two concurrent processes trying to recover the same stale lock: exactly one succeeds, the other fails cleanly."""
        from scripts.godot.qa_server import acquire_state_lock, release_state_lock
        import threading

        lock_dir = os.path.join(self.state_dir, ".qa_server.lock_dir")
        os.makedirs(lock_dir, exist_ok=True)
        with open(os.path.join(lock_dir, "owner.json"), "w", encoding="utf-8") as f:
            json.dump({"pid": 999999, "port": 8788, "token": "dead_token", "created_at": 1000.0}, f)

        results = []
        barrier = threading.Barrier(2)

        def worker(port):
            try:
                barrier.wait(timeout=2.0)
                ld = acquire_state_lock(self.state_dir, port)
                results.append(("SUCCESS", ld))
            except Exception as e:
                results.append(("FAILED", str(e)))

        t1 = threading.Thread(target=worker, args=(8791,))
        t2 = threading.Thread(target=worker, args=(8792,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        successes = [r for r in results if r[0] == "SUCCESS"]
        failures = [r for r in results if r[0] == "FAILED"]
        self.assertEqual(len(successes), 1, "Exactly one thread must recover and acquire the stale lock!")
        self.assertEqual(len(failures), 1, "The competing thread must fail to steal the lock!")
        release_state_lock(successes[0][1])

    def test_fixture_write_failure_preserves_previous_state(self):
        """Simulated write failure during fixture staging must preserve previous snapshot without data loss."""
        from unittest.mock import patch

        # Pre-seed existing snapshot in state dir
        initial_content = {"snapshotVersion": 21, "tick": 42, "preserved": True}
        with open(self.test_snap, "w", encoding="utf-8") as f:
            json.dump(initial_content, f)

        # Prepare new fixture in temp_dir (outside state_dir)
        new_fixture = os.path.join(self.temp_dir.name, "new_fixture.json")
        with open(new_fixture, "w", encoding="utf-8") as f:
            json.dump({
                "snapshotVersion": 21, "tick": 99,
                "surface": {"width": 480, "height": 480},
                "colonies": [{"id": 0, "ants": [], "colony": {"population": {"workers": 5}}}]
            }, f)

        # Mock json.dump during staging to simulate disk full / permission error
        orig_dump = json.dump
        def failing_dump(obj, fp, *args, **kwargs):
            if ".snapshot_staged_" in getattr(fp, "name", ""):
                raise OSError("Simulated disk full during fixture staging")
            return orig_dump(obj, fp, *args, **kwargs)

        with patch("json.dump", side_effect=failing_dump):
            ret = start_server(port=9998, reset_state=True, fixture_snapshot=new_fixture, state_dir=self.state_dir)
            self.assertEqual(ret, 1)

        # Verify that previous snapshot was NOT deleted or overwritten
        self.assertTrue(os.path.exists(self.test_snap), "Old snapshot must be preserved after write failure!")
        with open(self.test_snap, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        self.assertEqual(loaded.get("tick"), 42)
        self.assertTrue(loaded.get("preserved"))

    def test_concurrent_lock_race(self):
        """Two concurrent threads competing for state lock: exactly one succeeds."""
        import threading
        from scripts.godot.qa_server import acquire_state_lock, release_state_lock

        results = []
        barrier = threading.Barrier(2)

        def worker(port):
            try:
                barrier.wait(timeout=2.0)
                ld = acquire_state_lock(self.state_dir, port)
                results.append(("SUCCESS", ld))
            except Exception as e:
                results.append(("FAILED", str(e)))

        t1 = threading.Thread(target=worker, args=(8801,))
        t2 = threading.Thread(target=worker, args=(8802,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        successes = [r for r in results if r[0] == "SUCCESS"]
        failures = [r for r in results if r[0] == "FAILED"]
        self.assertEqual(len(successes), 1, "Exactly one thread must acquire lock!")
        self.assertEqual(len(failures), 1, "The other thread must fail!")

        # Clean up winner's lock
        release_state_lock(successes[0][1])

    def test_kill_process_tree_terminates_child_and_frees_resources(self):
        """kill_process_tree must cleanly terminate the target process tree and release socket resources."""
        from scripts.godot.qa_server import kill_process_tree
        import subprocess
        import socket
        import time

        # Find an available port
        s_probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s_probe.bind(("127.0.0.1", 0))
        test_port = s_probe.getsockname()[1]
        s_probe.close()

        # Launch parent that launches a child holding the TCP port
        parent_code = (
            f"import subprocess, sys, time\n"
            f"child_code = 'import socket, time; s = socket.socket(); s.bind((\"127.0.0.1\", {test_port})); s.listen(1); time.sleep(60)'\n"
            f"p = subprocess.Popen([sys.executable, '-c', child_code])\n"
            f"while True: time.sleep(1)\n"
        )
        parent_proc = subprocess.Popen([sys.executable, "-c", parent_code])
        try:
            # Wait for child to bind the port
            bound = False
            for _ in range(50):
                time.sleep(0.1)
                try:
                    s_test = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    s_test.connect(("127.0.0.1", test_port))
                    s_test.close()
                    bound = True
                    break
                except OSError:
                    pass
            self.assertTrue(bound, "Child process must successfully bind TCP socket!")

            # Call kill_process_tree on parent
            kill_process_tree(parent_proc.pid)
            parent_proc.wait(timeout=5)
            self.assertIsNotNone(parent_proc.poll(), "Parent process must be terminated!")

            # Verify TCP port is released and can be bound immediately
            time.sleep(0.5)
            s_rebind = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s_rebind.bind(("127.0.0.1", test_port))
            s_rebind.close()
        finally:
            if parent_proc.poll() is None:
                parent_proc.kill()

if __name__ == "__main__":
    unittest.main()
