"""Search helpers for flow persistence."""


def make_text_checker(keyword: str, case_sensitive: bool = False):
    """Create a keyword matcher with optional case sensitivity."""
    kw = keyword if case_sensitive else keyword.lower()

    def _check(text: str) -> bool:
        value = text if case_sensitive else text.lower()
        return kw in value

    return _check
