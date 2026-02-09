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
        self.assertIn("def __rc_record_hit(flow, script_path):", modified)
        
        # Verify call is injected into the if statement
        self.assertIn("__rc_record_hit(flow, __file__)", modified)
        
    def test_async_injection(self):
        source = """
async def response(flow):
    if 1 == 1:
        print("hello")
"""
        modified = inject_tracking(source)
        self.assertIn("def __rc_record_hit(flow, script_path):", modified)
        self.assertIn("__rc_record_hit(flow, __file__)", modified)

    def test_multi_point_injection(self):
        source = """
def request(flow):
    if condition_a:
        do_a()
    if condition_b:
        do_b()
"""
        modified = inject_tracking(source)
        # Should appear multiple times in semantic blocks
        self.assertEqual(modified.count("__rc_record_hit(flow, __file__)"), 2)

    def test_fallback_injection(self):
        source = """
def request(flow):
    do_something_always()
"""
        modified = inject_tracking(source)
        # Should be at the top of the function
        self.assertIn("__rc_record_hit(flow, __file__)", modified)
        self.assertIn("do_something_always()", modified)
        
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
