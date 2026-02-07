import unittest
import sys
import os
import ast

# Add parent to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from injector import inject_tracking

class TestInjector(unittest.TestCase):
    def test_basic_injection(self):
        source = """
def request(flow):
    if flow.request.host == "example.com":
        pass
"""
        modified = inject_tracking(source)
        
        # Verify helper is present
        self.assertIn("def record_hit(flow):", modified)
        
        # Verify call is injected into the if statement
        # Looking for record_hit(flow) inside the if body
        self.assertIn("record_hit(flow)", modified)
        
    def test_async_injection(self):
        source = """
async def response(flow):
    if 1 == 1:
        print("hello")
"""
        modified = inject_tracking(source)
        self.assertIn("def record_hit(flow):", modified)
        self.assertIn("record_hit(flow)", modified)
        
    def test_logging_injection(self):
        source = """
from mitmproxy import ctx
def request(flow):
    if True:
        ctx.log.info("Original Message")
"""
        modified = inject_tracking(source)
        # injector.py prepends "[SCRIPT] " to ctx.log.info calls
        self.assertIn("[SCRIPT] ", modified)
        self.assertIn("Original Message", modified)

if __name__ == "__main__":
    unittest.main()
