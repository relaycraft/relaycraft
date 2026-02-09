import unittest
import sys
import os

# Add parent and core to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.utils import get_mime_type

class TestUtils(unittest.TestCase):
    def test_get_mime_type(self):
        # Basic types
        self.assertEqual(get_mime_type("test.html"), "text/html; charset=utf-8")
        self.assertEqual(get_mime_type("test.js"), "application/javascript; charset=utf-8")
        self.assertEqual(get_mime_type("test.png"), "image/png")
        
        # Upper case extension
        self.assertEqual(get_mime_type("TEST.JPG"), "image/jpeg")
        
        # Unknown extension
        self.assertEqual(get_mime_type("test.unknown"), "application/octet-stream")
        
        # No extension
        self.assertEqual(get_mime_type("testfile"), "application/octet-stream")

if __name__ == "__main__":
    unittest.main()
