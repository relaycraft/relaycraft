import os
import sys
import unittest

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core import capture_scope


def _info(name=None, pid=None, path=None):
    return {"pid": pid, "name": name, "path": path}


class TestCaptureScope(unittest.TestCase):
    def setUp(self):
        capture_scope.set_config({"include": [], "exclude": []})

    def tearDown(self):
        capture_scope.set_config({"include": [], "exclude": []})

    # ---------- decision table ----------

    def test_disabled_scope_captures_everything(self):
        self.assertTrue(capture_scope.is_in_scope(None))
        self.assertTrue(capture_scope.is_in_scope(_info("curl", 1)))
        self.assertFalse(capture_scope.is_enabled())

    def test_include_substring(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        self.assertTrue(capture_scope.is_in_scope(_info("curl", 1)))
        self.assertTrue(capture_scope.is_in_scope(_info("mycurlapp", 2)))
        self.assertFalse(capture_scope.is_in_scope(_info("Python", 3)))
        # Unknown process is out of scope when include is non-empty.
        self.assertFalse(capture_scope.is_in_scope(None))

    def test_include_is_case_insensitive(self):
        capture_scope.set_config({"include": ["CURL"], "exclude": []})
        self.assertTrue(capture_scope.is_in_scope(_info("CuRl", 1)))

    def test_include_wildcard(self):
        capture_scope.set_config({"include": ["cur*"], "exclude": []})
        self.assertTrue(capture_scope.is_in_scope(_info("curl", 1)))
        self.assertTrue(capture_scope.is_in_scope(_info("curl.exe", 2)))
        self.assertFalse(capture_scope.is_in_scope(_info("python", 3)))

    def test_include_wildcard_question_mark(self):
        capture_scope.set_config({"include": ["pyt?on"], "exclude": []})
        self.assertTrue(capture_scope.is_in_scope(_info("python", 1)))
        self.assertFalse(capture_scope.is_in_scope(_info("pyton", 2)))

    def test_include_pid(self):
        capture_scope.set_config({"include": ["4321"], "exclude": []})
        self.assertTrue(capture_scope.is_in_scope(_info("anything", 4321)))
        self.assertFalse(capture_scope.is_in_scope(_info("anything", 9999)))
        self.assertFalse(capture_scope.is_in_scope(None))

    def test_include_and_exclude(self):
        capture_scope.set_config({"include": ["python"], "exclude": ["pythonw"]})
        self.assertTrue(capture_scope.is_in_scope(_info("Python", 1)))
        self.assertFalse(capture_scope.is_in_scope(_info("pythonw", 2)))

    def test_exclude_only(self):
        capture_scope.set_config({"include": [], "exclude": ["curl"]})
        self.assertFalse(capture_scope.is_in_scope(_info("curl", 1)))
        self.assertTrue(capture_scope.is_in_scope(_info("Python", 2)))
        # Unknown process stays in scope under exclude-only.
        self.assertTrue(capture_scope.is_in_scope(None))

    def test_exclude_pid(self):
        capture_scope.set_config({"include": [], "exclude": ["4321"]})
        self.assertFalse(capture_scope.is_in_scope(_info("anything", 4321)))
        self.assertTrue(capture_scope.is_in_scope(_info("anything", 9999)))
        self.assertTrue(capture_scope.is_in_scope(None))

    # ---------- normalization / validation ----------

    def test_normalize_strips_and_drops_empties(self):
        cfg = capture_scope.set_config(
            {"include": [" curl ", "", "  "], "exclude": ["wget"]}
        )
        self.assertEqual(cfg["include"], ["curl"])
        self.assertEqual(cfg["exclude"], ["wget"])

    def test_normalize_accepts_single_string_and_missing_keys(self):
        cfg = capture_scope.set_config({"include": "curl"})
        self.assertEqual(cfg["include"], ["curl"])
        self.assertEqual(cfg["exclude"], [])
        cfg = capture_scope.set_config({})
        self.assertEqual(cfg, {"include": [], "exclude": []})

    def test_get_returns_copy(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        cfg = capture_scope.get()
        cfg["include"].append("mutated")
        self.assertEqual(capture_scope.get()["include"], ["curl"])

    def test_invalid_payload_raises_and_does_not_apply(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        for bad in (None, "curl", 42, ["curl"], {"include": 42}, {"exclude": {"a": 1}}):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    capture_scope.set_config(bad)
        # Previous config must remain untouched.
        self.assertEqual(capture_scope.get()["include"], ["curl"])

    def test_set_config_enables_scope(self):
        capture_scope.set_config({"include": ["curl"], "exclude": []})
        self.assertTrue(capture_scope.is_enabled())
        capture_scope.set_config({"include": [], "exclude": []})
        self.assertFalse(capture_scope.is_enabled())


if __name__ == "__main__":
    unittest.main()
