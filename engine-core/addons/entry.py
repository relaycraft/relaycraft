import os
import sys
import tempfile
import importlib.util
from pathlib import Path

# Add current directory to sys.path to allow package imports
sys.path.append(str(Path(__file__).parent))

from typing import List, Any
from core import CoreAddon
from injector import inject_tracking

# Global temp directory for preprocessed scripts
_preprocessed_dir = None

def _preprocess_and_load_script(source_path: str) -> Any:
    """
    Preprocess a script by injecting tracking code and load it as a module.
    Returns the loaded module object, or None on failure.
    """
    global _preprocessed_dir
    
    try:
        source = Path(source_path)
        if not source.exists():
            return None
        
        # Create temp directory if not exists
        if _preprocessed_dir is None:
            _preprocessed_dir = tempfile.mkdtemp(prefix="relaycraft_scripts_")
        
        # Read original source
        with open(source, "r", encoding="utf-8") as f:
            original_code = f.read()
        
        # Inject tracking code
        modified_code = inject_tracking(original_code)
        
        # Write to temp file
        temp_path = Path(_preprocessed_dir) / source.name
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(modified_code)
        
        # Load as module
        module_name = source.stem
        spec = importlib.util.spec_from_file_location(module_name, temp_path)
        if spec is None or spec.loader is None:
            return None
        
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        
        return module
    except Exception as e:
        print(f"[RELAYCRAFT] Failed to preprocess/load script {source_path}: {e}")
        return None

# Build addons list
addons: List[Any] = [
    CoreAddon()
]

# Load user scripts from environment variable (Passed by Rust)
user_scripts_env = os.environ.get("RELAYCRAFT_USER_SCRIPTS", "")
if user_scripts_env:
    for path_str in user_scripts_env.split(";"):
        if not path_str:
            continue
        module = _preprocess_and_load_script(path_str)
        if module is not None:
            addons.append(module)
            print(f"[RELAYCRAFT] Loaded user script: {Path(path_str).name}")
