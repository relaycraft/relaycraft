#!/usr/bin/env python
"""Test script for FlowDatabase"""

import tempfile
import os
import shutil
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from addons.core.flow_database import FlowDatabase

def main():
    temp_dir = tempfile.mkdtemp()
    db_path = os.path.join(temp_dir, 'test.db')
    body_dir = os.path.join(temp_dir, 'bodies')

    print(f"Test directory: {temp_dir}")

    try:
        # Initialize database
        print("\n1. Initializing database...")
        db = FlowDatabase(db_path, body_dir)
        print("   OK")

        # Test default session
        print("\n2. Checking default session...")
        session = db.get_active_session()
        assert session is not None, "No active session"
        assert session["id"].startswith("s_"), f"Wrong session format: {session['id']}"
        print(f"   OK - {session['id']}: {session['name']}")

        # Test storing a flow
        print("\n3. Storing test flow...")
        test_flow = {
            'id': 'test-flow-001',
            'seq': 1,
            'request': {
                'method': 'GET',
                'url': 'https://example.com/test',
                'postData': {'text': 'test request body'}
            },
            'response': {
                'status': 200,
                'content': {'text': 'test response body'}
            },
            'host': 'example.com',
            'path': '/test',
            'startedDateTime': '2024-01-01T00:00:00Z',
            'time': 100.5,
            'size': 1024,
            'contentType': 'application/json',
            'msg_ts': 1704067200.0,
            '_rc': {
                'isWebsocket': False,
                'websocketFrameCount': 0,
                'hits': [],
                'intercept': {'intercepted': False}
            }
        }
        db.store_flow(test_flow)
        print("   OK")

        # Test getting indices
        print("\n4. Getting indices...")
        indices = db.get_indices(since=0)
        assert len(indices) == 1, f"Wrong count: {len(indices)}"
        assert indices[0]['id'] == 'test-flow-001', f"Wrong id: {indices[0]['id']}"
        print(f"   OK - Got {len(indices)} index")

        # Test getting detail
        print("\n5. Getting flow detail...")
        detail = db.get_detail('test-flow-001')
        assert detail is not None, "Detail is None"
        assert detail['id'] == 'test-flow-001', f"Wrong id: {detail['id']}"
        req_body = detail['request']['postData']['text']
        assert req_body == 'test request body', f"Wrong request body: {req_body}"
        print(f"   OK - Request body: {req_body}")

        # Test creating session
        print("\n6. Creating new session...")
        new_id = db.create_session('Test Session', 'For testing')
        assert new_id is not None, "Failed to create session"
        print(f"   OK - Created session: {new_id}")

        # Test listing sessions
        print("\n7. Listing sessions...")
        sessions = db.list_sessions()
        assert len(sessions) == 2, f"Wrong count: {len(sessions)}"
        print(f"   OK - {len(sessions)} sessions")

        # Test stats
        print("\n8. Getting stats...")
        stats = db.get_stats()
        print(f"   OK - Sessions: {stats['sessions']}, Flows: {stats['total_flows']}")

        # Test large body (should be compressed)
        print("\n9. Testing large body storage...")
        large_body = "x" * (20 * 1024)  # 20KB
        large_flow = {
            'id': 'test-flow-002',
            'seq': 2,
            'request': {
                'method': 'POST',
                'url': 'https://example.com/large',
                'postData': {'text': large_body}
            },
            'response': {
                'status': 200,
                'content': {'text': large_body}
            },
            'host': 'example.com',
            'path': '/large',
            'startedDateTime': '2024-01-01T00:00:01Z',
            'time': 200.0,
            'size': len(large_body),
            'contentType': 'text/plain',
            'msg_ts': 1704067201.0,
            '_rc': {
                'isWebsocket': False,
                'websocketFrameCount': 0,
                'hits': [],
                'intercept': {'intercepted': False}
            }
        }
        db.store_flow(large_flow)

        # Verify large body can be retrieved
        large_detail = db.get_detail('test-flow-002')
        retrieved_body = large_detail['request']['postData']['text']
        assert retrieved_body == large_body, "Large body mismatch"
        print(f"   OK - Large body ({len(large_body)} bytes) stored and retrieved")

        # Test clear session
        print("\n10. Clearing session...")
        db.clear_session()
        indices_after_clear = db.get_indices(since=0)
        assert len(indices_after_clear) == 0, f"Session not cleared: {len(indices_after_clear)}"
        print("   OK - Session cleared")

        print("\n" + "="*50)
        print("All tests passed!")
        print("="*50)

        # Close database connection before cleanup
        db.close()

    finally:
        # Cleanup
        try:
            shutil.rmtree(temp_dir)
            print(f"\nCleaned up: {temp_dir}")
        except PermissionError:
            print(f"\nNote: Could not clean up temp dir (file locked): {temp_dir}")

if __name__ == "__main__":
    main()
