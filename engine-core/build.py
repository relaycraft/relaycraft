"""
Build script for packaging mitmproxy with PyInstaller
"""
import PyInstaller.__main__
import sys
import os
import shutil

import argparse

def sync_addons_to_resources():
    """Sync addons source to Tauri resources directory excluding tests and cache"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(script_dir, 'addons')
    dst = os.path.join(script_dir, '..', 'src-tauri', 'resources', 'addons')
    
    if not os.path.exists(src):
        print(f"[ERROR] Source addons directory not found: {src}")
        return

    print(f"Syncing addons from {src} to {dst}...")
    
    if not os.path.exists(dst):
        os.makedirs(dst, exist_ok=True)
    
    # Custom copy loop to be more robust and preserve structure without crashing glob patterns
    # 1. Clear destination safely
    for item in os.listdir(dst):
        item_path = os.path.join(dst, item)
        if item == ".gitkeep": continue
        if os.path.isdir(item_path):
            shutil.rmtree(item_path)
        else:
            os.remove(item_path)

    # 2. Copy contents
    ignore_func = shutil.ignore_patterns('tests', '__pycache__', '*.pyc', '.pytest_cache')
    for item in os.listdir(src):
        if item.startswith('.') or item == 'tests': continue
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if os.path.isdir(s):
            shutil.copytree(s, d, ignore=ignore_func)
        else:
            shutil.copy2(s, d)
            
    print(f"[OK] Addons synced to resources (tests excluded).")

def build(sync_only=False):
    """Build the mitmproxy executable"""
    # 0. Sync addons to resources
    sync_addons_to_resources()
    
    if sync_only:
        return

    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    wrapper_path = os.path.join(script_dir, 'mitmdump_wrapper.py')
    
    # Determine the platform-specific executable name
    exe_name = 'engine'
    
    args = [
        wrapper_path,
        '--name=' + exe_name,
        '--hidden-import=mitmproxy',
        '--hidden-import=websockets',
        '--hidden-import=asyncio',
        '--hidden-import=mitmproxy.tools.main',
        '--hidden-import=mitmproxy.tools.dump',
        '--hidden-import=requests',
        '--hidden-import=bs4',
        '--hidden-import=yaml',
        '--collect-all=mitmproxy',
        '--collect-all=jsonpath_ng',
        '--clean',
        '--noconfirm',
        '--log-level=INFO',
    ]
    
    if sys.platform == 'win32':
        args.append('--onefile')
        args.append('--console')
    elif sys.platform == 'darwin':
        args.append('--onedir')
    else:
        args.append('--onefile')
    
    print(f"Building {exe_name}...")
    PyInstaller.__main__.run(args)
    print(f"\n[OK] Build complete! Executable: dist/{exe_name}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='RelayCraft Engine Build Script')
    parser.add_argument('--sync', action='store_true', help='Only sync addons to resources')
    args = parser.parse_args()
    
    build(sync_only=args.sync)
