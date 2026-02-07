import sys
from unittest.mock import MagicMock

# Mock mitmproxy modules
mitmproxy = MagicMock()
sys.modules["mitmproxy"] = mitmproxy
sys.modules["mitmproxy.http"] = MagicMock()
sys.modules["mitmproxy.ctx"] = MagicMock()

class MockFlow:
    def __init__(self, method="GET", url="https://example.com/", path="/"):
        self.request = MagicMock()
        self.request.method = method
        self.request.url = url
        self.request.pretty_url = url
        self.request.path = path
        self.request.headers = {}
        self.request.content = b""
        
        self.response = MagicMock()
        self.response.status_code = 200
        self.response.headers = {}
        self.response.content = b""
        
        self.metadata = {}
        self.error = None

def get_mock_flow(*args, **kwargs):
    return MockFlow(*args, **kwargs)
