import os
import sys
import unittest

current_dir = os.path.dirname(os.path.abspath(__file__))
addons_dir = os.path.dirname(current_dir)
sys.path.append(addons_dir)

from core.flowdb.flow_repo import _index_content_type
from core.har_converters import header_value, optional_headers_to_har


class _Fields:
    def __init__(self, fields):
        self.fields = fields


class GrpcCaptureTests(unittest.TestCase):
    def test_index_prefers_request_grpc_mime_over_html_response(self):
        req = {"postData": {"mimeType": "application/grpc"}}
        res = {"content": {"mimeType": "text/html"}}
        self.assertEqual(_index_content_type(req, res, {}), "application/grpc")

    def test_index_keeps_grpc_response_mime(self):
        req = {"postData": {"mimeType": "application/grpc"}}
        res = {"content": {"mimeType": "application/grpc"}}
        self.assertEqual(_index_content_type(req, res, {}), "application/grpc")

    def test_optional_headers_none(self):
        self.assertEqual(optional_headers_to_har(None), [])

    def test_header_value_is_case_insensitive(self):
        headers = _Fields([(b"Content-Type", b"application/grpc")])
        self.assertEqual(header_value(headers, "content-type"), "application/grpc")


if __name__ == "__main__":
    unittest.main()
