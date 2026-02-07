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

from core.rules.actions import ActionExecutor
from core.rules.engine import RuleEngine

class TestActions(unittest.TestCase):
    def setUp(self):
        self.engine = MagicMock()
        self.executor = ActionExecutor(self.engine)

    def test_map_remote_regex_substitution(self):
        """Test classic regex substitution (e.g. $1)"""
        flow = mock_env.get_mock_flow(url="https://example.com/api/v1/users")
        
        # Mock match object
        url_match = MagicMock()
        url_match.expand.return_value = "https://new-api.com/v2/users"
        
        action = {
            "targetUrl": "https://new-api.com/v2/$1",
            "preservePath": True # Should be ignored if regex sub is detected
        }
        
        self.executor.apply_map_remote(flow, action, url_match=url_match)
        
        self.assertEqual(flow.request.url, "https://new-api.com/v2/users")

    def test_map_remote_simple_no_preserve(self):
        """Test simple mapping without preserve path"""
        flow = mock_env.get_mock_flow(url="https://old.com/some/path?query=1")
        
        action = {
            "targetUrl": "https://new.com/base",
            "preservePath": False
        }
        
        self.executor.apply_map_remote(flow, action)
        
        self.assertEqual(flow.request.url, "https://new.com/base")

    def test_map_remote_preserve_path_root(self):
        """Test preserve path when target is root"""
        # Request: http://old.com/users?id=1
        # Target: https://new.com
        # Expected: https://new.com/users?id=1
        
        flow = mock_env.get_mock_flow(url="http://old.com/users?id=1")
        flow.request.scheme = "http"
        flow.request.host = "old.com"
        flow.request.port = 80
        flow.request.path = "/users?id=1"
        
        action = {
            "targetUrl": "https://new.com",
            "preservePath": True
        }
        
        self.executor.apply_map_remote(flow, action)
        
        self.assertEqual(flow.request.scheme, "https")
        self.assertEqual(flow.request.host, "new.com")
        self.assertEqual(flow.request.port, 443)
        self.assertEqual(flow.request.path, "/users?id=1")

    def test_map_remote_preserve_path_subpath(self):
        """Test preserve path when target has a subpath"""
        # Request: http://old.com/v1/data
        # Target: https://new.com/api/proxy
        # Expected: https://new.com/api/proxy/v1/data
        
        flow = mock_env.get_mock_flow(url="http://old.com/v1/data")
        flow.request.scheme = "http"
        flow.request.host = "old.com"
        flow.request.port = 80
        flow.request.path = "/v1/data"
        
        action = {
            "targetUrl": "https://new.com/api/proxy",
            "preservePath": True
        }
        
        self.executor.apply_map_remote(flow, action)
        
        self.assertEqual(flow.request.host, "new.com")
        self.assertEqual(flow.request.path, "/api/proxy/v1/data")

    def test_map_remote_preserve_path_port(self):
        """Test preserve path with custom port"""
        flow = mock_env.get_mock_flow(url="http://old.com/foo")
        flow.request.scheme = "http"
        flow.request.host = "old.com"
        flow.request.port = 80
        flow.request.path = "/foo"
        
        action = {
            "targetUrl": "http://localhost:8080",
            "preservePath": True
        }
        
        self.executor.apply_map_remote(flow, action)
        
        self.assertEqual(flow.request.host, "localhost")
        self.assertEqual(flow.request.port, 8080)
        self.assertEqual(flow.request.path, "/foo")

if __name__ == "__main__":
    unittest.main()
