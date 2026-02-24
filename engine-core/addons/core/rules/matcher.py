import re
from typing import Optional, Tuple, Dict, Any
from mitmproxy import http, ctx
from ..utils import setup_logging

class RuleMatcher:
    def __init__(self):
        self.logger = setup_logging()

    def match_url(self, url: str, pattern: str, match_type: str, compiled_re: Optional[re.Pattern] = None) -> Tuple[bool, Optional[re.Match]]:
        """Match URL against pattern based on match type
        Returns: (matched: bool, match_object: Optional[re.Match])
        """
        try:
            # Use pre-compiled regex for speed
            if compiled_re:
                if match_type == "regex":
                    match = compiled_re.search(url)
                    return (bool(match), match)
                elif match_type == "wildcard":
                    match = compiled_re.match(url)
                    return (bool(match), match)
            if match_type == "contains":
                return (pattern in url, None)
            elif match_type == "exact":
                return (pattern == url, None)
            elif match_type == "regex":
                match = re.search(pattern, url)
                return (bool(match), match)
            elif match_type == "wildcard":
                regex_pattern = pattern.replace(".", r"\.").replace("*", ".*").replace("?", ".")
                regex_pattern = f"^{regex_pattern}$"
                match = re.match(regex_pattern, url)
                return (bool(match), match)
        except Exception as e:
            self.logger.error(f"Error matching URL: {e}")
            return (False, None)
        
        return (False, None)
    
    def match_atom(self, flow: http.HTTPFlow, atom: dict) -> bool:
        """Match a single atom condition against the flow"""
        target_type = atom.get("type")
        match_type = atom.get("matchType", "exact")
        key = atom.get("key")
        value = atom.get("value")
        invert = atom.get("invert", False)
        compiled_re = atom.get("_compiled_re")

        result = False

        if target_type == "url":
            result, _ = self.match_url(flow.request.pretty_url, str(value), match_type, compiled_re)
        elif target_type == "host":
            result, _ = self.match_url(flow.request.host, str(value), match_type, compiled_re)
        elif target_type == "method":
            allowed_methods = value if isinstance(value, list) else [value]
            result = flow.request.method in allowed_methods
        elif target_type == "header":
            if not key: return False
            actual_value = flow.request.headers.get(key)
            if match_type == "exists":
                result = actual_value is not None
            elif match_type == "not_exists":
                result = actual_value is None
            elif actual_value is not None:
                result, _ = self.match_url(actual_value, str(value), match_type, compiled_re)
        elif target_type == "query":
            if not key: return False
            actual_value = flow.request.query.get(key)
            if match_type == "exists":
                result = actual_value is not None
            elif match_type == "not_exists":
                result = actual_value is None
            elif actual_value is not None:
                result, _ = self.match_url(actual_value, str(value), match_type, compiled_re)
        elif target_type == "port":
            result = str(flow.request.port) == str(value)
        elif target_type == "ip":
            result, _ = self.match_url(flow.client_conn.address[0], str(value), match_type, compiled_re)

        return not result if invert else result

    def match_rule(self, flow: http.HTTPFlow, rule: Dict[str, Any]) -> Tuple[bool, Optional[re.Match]]:
        """Check if flow matches rule conditions (Request Phase)
        Returns: (matched: bool, url_match_object: Optional[re.Match])
        """
        # V2 Schema: match.request is the array
        atoms = rule.get("match", {}).get("request", [])
        
        if not atoms:
            # No request matchers = match all
            return (True, None)

        # Standard AND logic for the atom array
        matched = all(self.match_atom(flow, atom) for atom in atoms)
        
        # Extract regex match object
        url_match_obj = None
        for atom in atoms:
            if atom.get("type") == "url" and atom.get("matchType") == "regex":
                _, url_match_obj = self.match_url(flow.request.pretty_url, str(atom.get("value")), "regex", atom.get("_compiled_re"))
                break
        
        return (matched, url_match_obj)
