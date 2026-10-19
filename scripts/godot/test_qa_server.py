"""Unit tests for scripts/godot/qa_server.py preflight and lifecycle."""

import os
import sys
import socket
import tempfile
import unittest

# Add repo root to path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

from scripts.godot.qa_server import start_server, is_port_in_use, validate_fixture

class TestQAServer(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.state_dir = os.path.join(self.temp_dir.name, "qa_state")
        os.makedirs(self.state_dir, exist_ok=True)
        # Create a test snapshot file
        self.test_snap = os.path.join(self.state_dir, "snapshot.json")
        with open(self.test_snap, "w", encoding="utf-8") as f:
            f.write('{"test": true}')

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_preflight_port_in_use_preserves_files(self):
        """When port is occupied, start_server must fail with code 1 and NOT touch state files."""
        # Bind a socket to a test port
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        bound_port = s.getsockname()[1]

        try:
            self.assertTrue(is_port_in_use(bound_port))
            # Run start_server with reset=True
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

if __name__ == "__main__":
    unittest.main()
