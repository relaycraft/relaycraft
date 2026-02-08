"""
Build script for packaging mitmproxy with PyInstaller
"""
import PyInstaller.__main__
import sys
import os

def build():
    """Build the mitmproxy executable"""
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    wrapper_path = os.path.join(script_dir, 'mitmdump_wrapper.py')
    
    # Determine the platform-specific executable name
    exe_name = 'engine'
    
    args = [
        wrapper_path,
        '--name=' + exe_name,
        # '--add-data=addons:addons', # Removed: we don't bundle scripts anymore
        '--hidden-import=mitmproxy',
        '--hidden-import=websockets',
        '--hidden-import=asyncio',
        '--hidden-import=mitmproxy.tools.main',
        '--hidden-import=mitmproxy.tools.dump',
        '--hidden-import=requests',
        '--hidden-import=bs4',
        '--hidden-import=yaml', # Explicitly include PyYAML
        '--collect-all=mitmproxy',
        '--collect-all=jsonpath_ng',
        '--clean',
        '--noconfirm',
        '--log-level=INFO',
    ]
    
    # Add platform-specific options
    if sys.platform == 'win32':
        args.append('--onefile')
        args.append('--console')
    elif sys.platform == 'darwin':
        # macOS: Use onedir to avoid repeated Gatekeeper scanning delay
        args.append('--onedir')
    else:
        # Linux: onefile is usually fine, but onedir is safer for startup speed too
        args.append('--onefile')
    
    print(f"Building {exe_name}...")
    print(f"PyInstaller args: {args}")
    
    PyInstaller.__main__.run(args)
    
    print(f"\n[OK] Build complete! Executable: dist/{exe_name}")
    print(f"  Copy this file to: src-tauri/binaries/{exe_name}")
    print(f"  NOTE: This binary requires src-tauri/resources/addons/combined_addons.py to be present at runtime.")

if __name__ == '__main__':
    build()
