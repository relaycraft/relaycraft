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
    
    dist_path = os.path.join(script_dir, 'dist')
    
    args = [
        wrapper_path,
        '--name=' + exe_name,
        '--distpath=' + dist_path,
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
    print(f"\n[OK] Build complete! Executable located in: {dist_path}")
    
    # macOS post-build: Permanently rename Python.framework to avoid signing issues
    if sys.platform == 'darwin':
        dist_dir = os.path.join(dist_path, exe_name)
        internal_dir = os.path.join(dist_dir, '_internal')
        framework_name = 'Python.framework' # Or whatever it was renamed to
        framework_path = None
        for item in os.listdir(internal_dir):
            if item.endswith('.framework') or item.endswith('.fwork'):
                framework_path = os.path.join(internal_dir, item)
                break
        
        if framework_path and os.path.exists(framework_path):
            # 1. Rename to a PLAIN folder name (no extension)
            # We use 'py_runtime' to be totally different from framework name
            runtime_name = 'py_runtime'
            runtime_path = os.path.join(internal_dir, runtime_name)
            old_framework_name = os.path.basename(framework_path)
            
            # This path is used both for the library ID and for updating references in other binaries
            new_lib_name = 'libpython_rt.dylib'
            new_replace_path = f"@executable_path/_internal/{runtime_name}/{new_lib_name}"
            
            print(f"\nmacOS post-build: Aggressively restructuring runtime...")
            print(f"  Renaming {old_framework_name} -> {runtime_name}")
            
            if os.path.exists(runtime_path):
                shutil.rmtree(runtime_path) if os.path.isdir(runtime_path) else os.remove(runtime_path)
            
            shutil.move(framework_path, runtime_path)

            # 2. Rename the main Python binary to a .dylib to make Apple happy (it's a library!)
            # It's usually at py_runtime/Python or py_runtime/Versions/3.12/Python
            new_lib_name = 'libpython_rt.dylib'
            target_lib_path = os.path.join(runtime_path, new_lib_name)
            
            # Find the actual binary
            actual_binary = None
            for root, dirs, files in os.walk(runtime_path):
                if 'Python' in files:
                    p = os.path.join(root, 'Python')
                    # Verify it's a Mach-O
                    try:
                        with open(p, 'rb') as f:
                            magic = f.read(4)
                            if magic in [b'\xca\xfe\xba\xbe', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf']:
                                actual_binary = p
                                break
                    except: continue

            if actual_binary:
                print(f"  Found Python binary at: {os.path.relpath(actual_binary, runtime_path)}")
                shutil.move(actual_binary, target_lib_path)
                print(f"  Renamed binary -> {new_lib_name}")
                
                # 3. Fix the internal ID (LC_ID_DYLIB) of the renamed dylib (CRITICAL)
                # If the ID doesn't match the load path, macOS marks it as damaged.
                print(f"  Setting internal ID of {new_lib_name}...")
                os.system(f'install_name_tool -id "{new_replace_path}" "{target_lib_path}"')
            else:
                print("  ERROR: Could not find Python binary to rename!")

            # 4. Clean all extended attributes and old signatures (CRITICAL)
            print("  Cleaning extended attributes and existing signatures...")
            os.system(f"xattr -rc {dist_dir}")
            # Also remove _CodeSignature folders
            for root, dirs, files in os.walk(dist_dir):
                if '_CodeSignature' in dirs:
                    shutil.rmtree(os.path.join(root, '_CodeSignature'))

            # 5. Universal RPATH and dependency fix
            # This is the most important part: update ALL binaries to point to the new dylib
            print("  Applying universal RPATH fixed to ALL binaries...")
            old_search_pattern = f"{old_framework_name}/Versions/3.12/Python"
            old_search_pattern_2 = f"{old_framework_name}/Python"
            
            binary_count = 0
            for root, dirs, files in os.walk(dist_dir):
                for name in files:
                    p = os.path.join(root, name)
                    # Skip non-binaries for speed
                    if not (name.endswith('.so') or name.endswith('.dylib') or '.' not in name):
                        continue
                        
                    # Check if it's Mach-O
                    is_macho = False
                    try:
                        with open(p, 'rb') as f:
                            magic = f.read(4)
                            if magic in [b'\xca\xfe\xba\xbe', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf']:
                                is_macho = True
                    except: continue
                    
                    if is_macho:
                        binary_count += 1
                        # Update references to the old framework
                        os.system(f'install_name_tool -change "@executable_path/../Frameworks/{old_search_pattern}" "{new_replace_path}" "{p}" 2>/dev/null')
                        os.system(f'install_name_tool -change "@executable_path/../Frameworks/{old_search_pattern_2}" "{new_replace_path}" "{p}" 2>/dev/null')
                        os.system(f'install_name_tool -change "@loader_path/../../../../{old_search_pattern}" "{new_replace_path}" "{p}" 2>/dev/null')
                        os.system(f'install_name_tool -change "@loader_path/../../../../{old_search_pattern_2}" "{new_replace_path}" "{p}" 2>/dev/null')
                        os.system(f'install_name_tool -change "{old_search_pattern}" "{new_replace_path}" "{p}" 2>/dev/null')
            
            print(f"  ✅ Restructuring complete. Processed {binary_count} binaries.")
            
            # 6. Finally, aggressively flatten symlinks
            print("  Final symlink elimination...")
            # We must be careful: if we just remove symlinks, some files might become unreachable.
            # But in our 'onedir' setup, PyInstaller mostly uses absolute paths or rpaths to _internal.
            for root, dirs, files in os.walk(dist_dir):
                for name in files + dirs:
                    p = os.path.join(root, name)
                    if os.path.islink(p):
                        try:
                            # Try to replace link with actual content if it's a file link
                            target = os.path.realpath(p)
                            if os.path.isfile(target):
                                os.remove(p)
                                shutil.copy2(target, p)
                            else:
                                os.remove(p)
                        except:
                            if os.path.exists(p): os.remove(p)
        else:
            print(f"  ⚠️  WARNING: Python framework folder not found in {internal_dir}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='RelayCraft Engine Build Script')
    parser.add_argument('--sync', action='store_true', help='Only sync addons to resources')
    args = parser.parse_args()
    
    build(sync_only=args.sync)
