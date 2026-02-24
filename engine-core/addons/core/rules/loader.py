import os
import yaml
import time
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from mitmproxy import ctx
from ..utils import setup_logging

class RuleLoader:
    def __init__(self):
        self.logger = setup_logging()
        self.rules: List[Dict[str, Any]] = []
        
        # Indexed Buckets for Tiered Matching
        self.exact_host_rules: Dict[str, List[Dict[str, Any]]] = {}
        self.wildcard_host_rules: List[Dict[str, Any]] = []
        self.global_rules: List[Dict[str, Any]] = []
        
        self.rules_dir: Optional[Path] = None
        self.rules_file: Optional[Path] = None
        
        # Priority 1: Rules Directory (YAML)
        env_dir = os.environ.get("RELAYCRAFT_RULES_DIR")
        if env_dir:
            self.rules_dir = Path(env_dir)
        
        # Priority 2: Rules File (Legacy JSON)
        if not self.rules_dir:
            env_path = os.environ.get("RELAYCRAFT_RULES_FILE")
            if env_path:
                self.rules_file = Path(env_path)
            else:
                self.rules_file = Path.home() / ".relaycraft" / "rules.json"
            
        self._last_load_time = 0
        self._last_check_time = 0
        self._last_file_count = -1
        self.logger.info(f"RuleLoader initialized. Dir: {self.rules_dir}, File: {self.rules_file}")
        self.load_rules()

    def load_rules(self) -> None:
        """Load rules with throttling and optimized revalidation"""
        try:
            if not self.rules_dir or not self.rules_dir.exists():
                self.rules = []
                return

            # 1. Throttling: Skip disk check if we just checked recently
            now = time.time()
            if now - self._last_check_time < 1.0 and self.rules:
                return
            self._last_check_time = now

            # Adding/deleting files updates dir mtime
            dir_mtime = self.rules_dir.stat().st_mtime
            
            # 3. Scan files if needed
            yaml_files = list(self.rules_dir.rglob("*.yaml"))
            if not yaml_files:
                self.rules = []
                return
            
            current_file_count = len(yaml_files)
            
            # Skip if nothing changed (dir mtime + file count)
            if dir_mtime <= self._last_load_time and current_file_count == self._last_file_count and self.rules:
                pass
            
            # Detailed check: content changes in existing files
            max_mtime = max(f.stat().st_mtime for f in yaml_files)
            current_mtime = max(max_mtime, dir_mtime)

            if current_mtime <= self._last_load_time and current_file_count == self._last_file_count and self.rules:
                return

            self._last_load_time = current_mtime
            self._last_file_count = current_file_count

            new_rules = []
            for p in yaml_files:
                if p.name == "groups.yaml":
                    continue
                    
                try:
                    with open(p, 'r', encoding='utf-8') as f:
                        data = yaml.safe_load(f)
                        if data and "rule" in data:
                            new_rules.append(data["rule"])
                except Exception as e:
                    self.logger.warn(f"Failed to load rule {p}: {e}")

            self.rules = new_rules
            # Sort rules: priority (asc) -> name (asc) -> id (asc)
            self.rules.sort(key=lambda r: (
                r.get("execution", {}).get("priority", 9999), 
                r.get("name", ""), 
                r.get("id", "")
            ))
            
            # Post-load Processing: Pre-compile and Index
            self._process_and_index_rules()
            
            self.rules_check_sum = current_mtime
            self._last_load_time = current_mtime
        except Exception as e:
            self.logger.error(f"Error loading rules: {e}")
            self.rules = []

    def _process_and_index_rules(self) -> None:
        """Pre-compile regexes and categorize rules into buckets for O(1) optimization"""
        self.exact_host_rules = {}
        self.wildcard_host_rules = []
        self.global_rules = []
        
        for rule in self.rules:
            # 1. Pre-compile Regexes in atoms
            match_req = rule.get("match", {}).get("request", [])
            has_host_restriction = False
            hosts: List[str] = []
            
            for atom in match_req:
                m_type = atom.get("matchType", "exact")
                val = str(atom.get("value", ""))
                
                # Pre-compile
                if m_type == "regex":
                    try:
                        atom["_compiled_re"] = re.compile(val)
                    except re.error as e:
                        self.logger.error(f"Failed to pre-compile regex '{val}' in rule {rule.get('id')}: {e}")
                elif m_type == "wildcard":
                    try:
                        regex_pattern = val.replace(".", r"\.").replace("*", ".*").replace("?", ".")
                        regex_pattern = f"^{regex_pattern}$"
                        atom["_compiled_re"] = re.compile(regex_pattern)
                    except re.error as e:
                        self.logger.error(f"Failed to pre-compile wildcard '{val}' in rule {rule.get('id')}: {e}")
                
                # Track Host Info for Indexing
                if atom.get("type") == "host":
                    invert = atom.get("invert", False)
                    if invert:
                        # Inverted host restrictions can't be indexed positively, treat as complex
                        has_host_restriction = "complex"
                        continue

                    has_host_restriction = True
                    if m_type == "exact":
                        hosts.append(val)
                    elif m_type in ["regex", "wildcard", "contains"]:
                        # Non-exact host goes to wildcard index
                        has_host_restriction = "complex"
            
            # 2. Categorize into Buckets
            if not has_host_restriction:
                self.global_rules.append(rule)
            elif has_host_restriction == "complex":
                self.wildcard_host_rules.append(rule)
            else:
                # Exact matches
                for h in hosts:
                    if h not in self.exact_host_rules:
                        self.exact_host_rules[h] = []
                    self.exact_host_rules[h].append(rule)
                    
        self.logger.info(f"Rules Indexed: {len(self.exact_host_rules)} precise hosts, {len(self.wildcard_host_rules)} complex hosts, {len(self.global_rules)} global rules")
