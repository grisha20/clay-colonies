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
        """Fixture must contain required save snapshot fields (snapshotVersion, tick, surface/colonies)."""
        invalid_schema_fixture = os.path.join(self.temp_dir.name, "invalid_schema.json")
        with open(invalid_schema_fixture, "w", encoding="utf-8") as f:
            json.dump({"random_key": 123}, f)

        ret = start_server(port=9999, reset_state=True, fixture_snapshot=invalid_schema_fixture, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap), "Snapshot must NOT be deleted when fixture schema is invalid!")

        valid_schema_fixture = os.path.join(self.temp_dir.name, "valid_save.json")
        with open(valid_schema_fixture, "w", encoding="utf-8") as f:
            json.dump({
                "snapshotVersion": 21,
                "protocolVersion": 21,
                "tick": 100,
                "surface": {},
                "colonies": [],
                "ants": []
            }, f)
        # Valid fixture should pass validate_fixture without error
        validate_fixture(valid_schema_fixture, target_snapshot_file=self.test_snap)

    def test_preflight_fixture_self_overwrite_rejected(self):
        """If fixture path resolves to target snapshot, reject immediately without file deletion."""
        ret = start_server(port=9999, reset_state=True, fixture_snapshot=self.test_snap, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap))

    def test_preflight_directory_lock_conflict(self):
        """If state directory is locked by another running PID, reject without file changes."""
        lock_file = os.path.join(self.state_dir, ".qa_server.lock")
        # Write lock for current process (which is guaranteed alive)
        with open(lock_file, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": 8788, "created_at": 1000.0}, f)

        ret = start_server(port=9999, reset_state=True, state_dir=self.state_dir)
        self.assertEqual(ret, 1)
        self.assertTrue(os.path.exists(self.test_snap), "Snapshot must NOT be modified when directory is locked!")

if __name__ == "__main__":
    unittest.main()
