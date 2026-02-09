import sys
from pathlib import Path

# Add current directory to sys.path to allow package imports
sys.path.append(str(Path(__file__).parent))

from typing import List, Any
from core import CoreAddon

addons: List[Any] = [
    CoreAddon()
]
