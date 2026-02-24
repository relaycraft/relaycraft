# RelayCraft Addon Tests

This directory contains unit tests for the critical Python addons located in `resources/addons`.

## How to Run Tests

Ensure you have Python installed, then run the following command from the `src-tauri/resources/addons` directory:

```powershell
python -m unittest discover -s tests
```

To run a specific test file:

```powershell
python -m unittest tests/test_rules.py
```

## Test Structure

- `mock_mitmproxy.py`: Provides mock objects for `mitmproxy.http` and `mitmproxy.ctx`, allowing tests to run without a live proxy.
- `test_rules.py`: Tests the `RuleEngine` and `RuleMatcher`.
- `test_injector.py`: Tests the AST injection logic for user scripts.
- `test_utils.py`: Tests utility functions like MIME type detection.

## Adding New Tests

1. Create a new file named `test_*.py` in this directory.
2. Import `unittest` and the necessary components from `core` or the root addons directory.
3. If you need to simulate mitmproxy flows, use `tests.mock_mitmproxy.get_mock_flow()`.
4. Run the discover command to ensure your new tests are picked up.

### Example

```python
import unittest
from tests.mock_mitmproxy import get_mock_flow

class MyNewTest(unittest.TestCase):
    def test_something(self):
        flow = get_mock_flow(url="https://example.com")
        self.assertEqual(flow.request.host, "example.com")
```
