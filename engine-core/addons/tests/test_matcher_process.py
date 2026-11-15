import os
import re
import sys
import unittest
from unittest.mock import MagicMock

# Add parent addon directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy modules before importing core modules
import tests.mock_mitmproxy as mock_env

sys.modules.setdefault("mitmproxy.proxy", MagicMock())
sys.modules.setdefault("mitmproxy.proxy.mode_specs", MagicMock())
sys.modules.setdefault("mitmproxy.tls", MagicMock())

from core.rules.matcher import RuleMatcher
from core.rules.loader import RuleLoader


def _flow_with_process(name=None, pid=4321):
    flow = mock_env.get_mock_flow(url="https://example.com/")
    flow.request.host = "example.com"
    if name is None:
        flow.metadata["_relaycraft_process"] = None
    else:
        flow.metadata["_relaycraft_process"] = {"pid": pid, "name": name, "path": "/x"}
    return flow


def _atom(match_type, value, invert=False, key=None):
    return {
        "type": "process",
        "matchType": match_type,
        "value": value,
        "key": key,
        "invert": invert,
    }


class TestProcessAtomMatcher(unittest.TestCase):
    def setUp(self):
        self.matcher = RuleMatcher()

    def _match(self, flow, atom):
        return self.matcher.match_atom(flow, atom)

    def test_contains_case_insensitive(self):
        flow = _flow_with_process("Google Chrome")
        self.assertTrue(self._match(flow, _atom("contains", "chrome")))
        self.assertTrue(self._match(flow, _atom("contains", "CHROME")))
        self.assertFalse(self._match(flow, _atom("contains", "firefox")))

    def test_exact_case_insensitive(self):
        flow = _flow_with_process("curl")
        self.assertTrue(self._match(flow, _atom("exact", "CURL")))
        self.assertFalse(self._match(flow, _atom("exact", "curl.exe")))

    def test_regex_case_insensitive(self):
        flow = _flow_with_process("Google Chrome")
        self.assertTrue(self._match(flow, _atom("regex", r"chrome$")))
        self.assertTrue(self._match(flow, _atom("regex", r"^google")))
        self.assertFalse(self._match(flow, _atom("regex", r"firefox")))

    def test_wildcard_case_insensitive(self):
        flow = _flow_with_process("Python")
        self.assertTrue(self._match(flow, _atom("wildcard", "py*")))
        self.assertTrue(self._match(flow, _atom("wildcard", "PYTHON")))
        self.assertFalse(self._match(flow, _atom("wildcard", "java*")))

    def test_missing_process_info_is_false(self):
        flow = _flow_with_process(name=None)
        flow.metadata.pop("_relaycraft_process", None)
        self.assertFalse(self._match(flow, _atom("contains", "curl")))
        self.assertFalse(self._match(flow, _atom("exact", "curl")))
        self.assertFalse(self._match(flow, _atom("regex", "curl")))
        self.assertFalse(self._match(flow, _atom("wildcard", "cur*")))

    def test_none_process_info_is_false(self):
        flow = _flow_with_process(name=None)
        self.assertFalse(self._match(flow, _atom("contains", "curl")))

    def test_invert_flips_result(self):
        flow = _flow_with_process("curl")
        # "curl" does not contain "python" -> invert makes it True.
        self.assertTrue(self._match(flow, _atom("contains", "python", invert=True)))
        # "curl" contains "curl" -> invert makes it False.
        self.assertFalse(self._match(flow, _atom("contains", "curl", invert=True)))
        # Missing process info + invert -> True.
        flow_none = _flow_with_process(name=None)
        self.assertTrue(self._match(flow_none, _atom("contains", "curl", invert=True)))

    def test_pid_is_not_matched(self):
        # Rules match the process NAME only — a numeric value is a name
        # substring/exact, not a pid comparison.
        flow = _flow_with_process("curl", pid=4321)
        self.assertFalse(self._match(flow, _atom("exact", "4321")))
        self.assertFalse(self._match(flow, _atom("contains", "4321")))

    def test_match_rule_with_process_atom(self):
        rule = {
            "match": {
                "request": [
                    {"type": "host", "matchType": "contains", "value": "example.com"},
                    _atom("contains", "curl"),
                ]
            }
        }
        flow = _flow_with_process("curl")
        matched, _ = self.matcher.match_rule(flow, rule)
        self.assertTrue(matched)

        flow_other = _flow_with_process("python")
        matched, _ = self.matcher.match_rule(flow_other, rule)
        self.assertFalse(matched)


class TestProcessAtomLoader(unittest.TestCase):
    def setUp(self):
        self.loader = RuleLoader.__new__(RuleLoader)
        self.loader.logger = MagicMock()
        self.loader.rules = []
        self.loader.exact_host_rules = {}
        self.loader.wildcard_host_rules = []
        self.loader.global_rules = []
        self.loader._compiled_patterns = {}

    def _index(self, rules):
        self.loader.rules = rules
        self.loader._process_and_index_rules()
        return self.loader._compiled_patterns

    def test_process_regex_precompiled_ignorecase(self):
        rule = {
            "id": "r1",
            "name": "proc regex",
            "match": {
                "request": [
                    {"type": "process", "matchType": "regex", "value": r"chrome$"},
                ]
            },
        }
        compiled = self._index([rule])
        pattern = list(compiled.values())[0]
        self.assertTrue(pattern.search("Google Chrome"))
        self.assertTrue(pattern.search("google chrome"))

    def test_process_wildcard_precompiled_ignorecase(self):
        rule = {
            "id": "r2",
            "name": "proc wildcard",
            "match": {
                "request": [
                    {"type": "process", "matchType": "wildcard", "value": "py*"},
                ]
            },
        }
        compiled = self._index([rule])
        pattern = list(compiled.values())[0]
        self.assertTrue(pattern.match("Python"))
        self.assertTrue(pattern.match("python"))
        self.assertFalse(pattern.match("java"))

    def test_non_process_regex_stays_case_sensitive(self):
        rule = {
            "id": "r3",
            "name": "url regex",
            "match": {
                "request": [
                    {"type": "url", "matchType": "regex", "value": r"Example"},
                ]
            },
        }
        compiled = self._index([rule])
        pattern = list(compiled.values())[0]
        self.assertFalse(pattern.search("example"))
        self.assertTrue(pattern.search("Example"))

    def test_process_atom_does_not_affect_host_bucketing(self):
        rule = {
            "id": "r4",
            "name": "proc only",
            "match": {
                "request": [
                    {"type": "process", "matchType": "contains", "value": "curl"},
                ]
            },
        }
        self._index([rule])
        # No host atoms -> lands in the global bucket.
        self.assertEqual(self.loader.global_rules, [rule])
        self.assertEqual(self.loader.exact_host_rules, {})
        self.assertEqual(self.loader.wildcard_host_rules, [])


if __name__ == "__main__":
    unittest.main()
