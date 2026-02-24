import unittest
import sys
import os
from unittest.mock import MagicMock

# Add parent and core to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

# Mock mitmproxy before importing engine
import tests.mock_mitmproxy as mock_env

from core.rules.engine import RuleEngine

class TestRules(unittest.TestCase):
    def setUp(self):
        self.engine = RuleEngine()
        # Use a real loader for indexing capabilities, but mock loading from disk
        self.engine.loader.load_rules = MagicMock()
        self.engine.loader.rules = []
        self.engine.loader.exact_host_rules = {}
        self.engine.loader.wildcard_host_rules = []
        self.engine.loader.global_rules = []

    def set_mock_rules(self, rules):
        """Helper to inject rules and trigger indexing"""
        self.engine.loader.rules = rules
        self.engine.loader._process_and_index_rules()

    def test_matcher_basic(self):
        from core.rules.matcher import RuleMatcher
        matcher = RuleMatcher()
        
        # V2 Schema for exact match
        rule = {
            "match": {
                "request": [
                    {"type": "url", "matchType": "exact", "value": "https://example.com/api"}
                ]
            }
        }
        
        flow = mock_env.get_mock_flow(url="https://example.com/api")
        matched, _ = matcher.match_rule(flow, rule)
        self.assertTrue(matched)
        
        flow_no_match = mock_env.get_mock_flow(url="https://example.com/api/v2")
        matched, _ = matcher.match_rule(flow_no_match, rule)
        self.assertFalse(matched)

    def test_matcher_regex(self):
        from core.rules.matcher import RuleMatcher
        matcher = RuleMatcher()
        
        rule = {
            "match": {
                "request": [
                    {"type": "url", "matchType": "regex", "value": r"example\.com/api/.*"}
                ]
            }
        }
        flow = mock_env.get_mock_flow(url="https://example.com/api/test")
        matched, _ = matcher.match_rule(flow, rule)
        self.assertTrue(matched)

    def test_rule_engine_execution(self):
        # Setup a mock rule
        rule = {
            "id": "1",
            "name": "Test Map Local",
            "execution": {"enabled": True},
            "match": {
                "request": [
                    {"type": "url", "matchType": "contains", "value": "example.com/api"}
                ]
            },
            "actions": [
                {
                    "type": "map_local",
                    "localPath": "/tmp/mock.json"
                }
            ]
        }
        self.set_mock_rules([rule])
        
        flow = mock_env.get_mock_flow(url="http://example.com/api/data")
        
        # ActionExecutor is used for execution in engine.py
        with unittest.mock.patch('core.rules.actions.ActionExecutor.apply_map_local') as mock_exec:
            self.engine.handle_request(flow)
            self.assertTrue(mock_exec.called)

if __name__ == "__main__":
    unittest.main()
