import os
import yaml
from pathlib import Path
from mitmproxy import ctx

class RuleLoader:
    def __init__(self):
        self.rules = []
        self.rules_dir = None
        self.rules_file = None
        
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
        self._last_file_count = -1
        ctx.log.info(f"RuleLoader initialized. Dir: {self.rules_dir}, File: {self.rules_file}")
        self.load_rules()

    def load_rules(self):
        """Load rules from YAML directory exclusively"""
        try:
            if not self.rules_dir or not self.rules_dir.exists():
                self.rules = []
                return

            # Check mtime of newest file (Recursive scan)
            yaml_files = list(self.rules_dir.rglob("*.yaml"))
            if not yaml_files:
                self.rules = []
                return
            
            max_mtime = max(f.stat().st_mtime for f in yaml_files)
            dir_mtime = self.rules_dir.stat().st_mtime
            current_mtime = max(max_mtime, dir_mtime)

            current_file_count = len(yaml_files)

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
                    ctx.log.warn(f"Failed to load rule {p}: {e}")

            self.rules = new_rules
            # Sort rules: priority (asc) -> name (asc) -> id (asc)
            self.rules.sort(key=lambda r: (
                r.get("execution", {}).get("priority", 9999), 
                r.get("name", ""), 
                r.get("id", "")
            ))
            self.rules_check_sum = current_mtime
            self._last_load_time = current_mtime
        except Exception as e:
            ctx.log.error(f"Error loading rules: {e}")
            self.rules = []
