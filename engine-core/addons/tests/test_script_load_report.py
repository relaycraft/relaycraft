import os
import sys
import unittest

current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.script_load_report import (  # noqa: E402
    get_report,
    record_failed,
    record_loaded,
    reset,
)


class TestScriptLoadReport(unittest.TestCase):
    def setUp(self):
        reset()

    def test_record_loaded_and_failed(self):
        record_loaded("ok.py")
        record_failed("/path/bad.py", "bad.py", "SyntaxError: invalid syntax")

        report = get_report()
        self.assertEqual(report["loaded_count"], 1)
        self.assertEqual(report["failed_count"], 1)
        self.assertEqual(report["loaded"], ["ok.py"])
        self.assertEqual(report["failed"][0]["name"], "bad.py")
        self.assertIn("SyntaxError", report["failed"][0]["error"])

    def test_reset_clears_state(self):
        record_loaded("a.py")
        reset()
        report = get_report()
        self.assertEqual(report["loaded_count"], 0)
        self.assertEqual(report["failed_count"], 0)


if __name__ == "__main__":
    unittest.main()
