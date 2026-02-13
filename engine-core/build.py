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
        '--hidden-import=sqlite3',
        '--hidden-import=pysqlite3',
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

        # 0. Clean extended attributes immediately to avoid interference
        print("  Cleaning engine attributes...")
        os.system(f"xattr -rc {dist_dir}")

        # 1. Search for the Python Runtime binary (exhaustive search)
        # It could be 'Python' inside a framework, or 'libpython3.12.dylib' naked in _internal
        print("\nmacOS post-build: Searching for Python runtime...")
        actual_binary = None
        for root, dirs, files in os.walk(internal_dir):
            for name in files:
                if name == 'Python' or (name.startswith('libpython') and name.endswith('.dylib')):
                    p = os.path.join(root, name)
                    if os.path.islink(p): continue
                    try:
                        with open(p, 'rb') as f:
                            magic = f.read(4)
                            if magic in [b'\xca\xfe\xba\xbe', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf']:
                                actual_binary = p
                                break
                    except: continue
            if actual_binary: break

        if actual_binary:
            print(f"  Found Python runtime at: {os.path.relpath(actual_binary, internal_dir)}")
            py_lib_target = os.path.join(internal_dir, 'Python')
            new_id_path = "@rpath/Python"

            # 2. Extract out of framework if needed
            framework_path = None
            curr = os.path.dirname(actual_binary)
            while curr != internal_dir and len(curr) > len(internal_dir):
                if curr.endswith('.framework') or curr.endswith('.fwork'):
                    framework_path = curr
                    break
                curr = os.path.dirname(curr)

            old_framework_name = os.path.basename(framework_path) if framework_path else "Python.framework"
            if framework_path:
                runtime_name = 'py_runtime'
                runtime_path = os.path.join(internal_dir, runtime_name)
                print(f"  Standardizing and FLATTENING framework: {old_framework_name} -> {runtime_name}")

                # Delete existing runtime folder if it exists
                if os.path.exists(runtime_path): shutil.rmtree(runtime_path)

                # INSTEAD of moving the whole framework, we extract the CONTENTS of the version dir
                # The actual_binary path tells us where the real content is (e.g. Versions/3.12)
                content_root = os.path.dirname(actual_binary)
                print(f"    Extracting content from: {os.path.relpath(content_root, internal_dir)}")

                # Move the content root (e.g. Versions/3.12) to be the new runtime_path
                shutil.move(content_root, runtime_path)

                # Clean up the now-empty framework skeleton
                shutil.rmtree(framework_path)

                # Update actual_binary path to reflect new location (it's now directly inside runtime_path)
                # Old relative path was inside content_root, so new path is runtime_path/basename(actual_binary)
                # BUT wait, actual_binary was full path. content_root was dirname.
                # So actual_binary must be at runtime_path/basename(actual_binary)
                actual_binary = os.path.join(runtime_path, os.path.basename(actual_binary))

            # 3. Always ensure a copy exists at _internal/Python for our Rust code
            if os.path.abspath(actual_binary) != os.path.abspath(py_lib_target):
                print(f"  Placing runtime binary at standard location: _internal/Python")
                # Use lexists to catch and remove broken symlinks (Common Python bundle issue)
                if os.path.lexists(py_lib_target):
                    if os.path.isdir(py_lib_target) and not os.path.islink(py_lib_target):
                        shutil.rmtree(py_lib_target)
                    else:
                        os.remove(py_lib_target)
                shutil.copy2(actual_binary, py_lib_target)

            # 4. Fix the internal ID (LC_ID_DYLIB)
            # IMPORTANT: Remove signature FIRST to avoid "link edit information" error
            print(f"  Setting internal ID to: {new_id_path}")
            os.system(f'codesign --remove-signature "{py_lib_target}" 2>/dev/null || true')
            os.system(f'install_name_tool -id "{new_id_path}" "{py_lib_target}" 2>/dev/null || true')

            # 5. Universal RPATH and dependency fix
            py_version = "3.12"
            # Search patterns for all possible PyInstaller layouts
            old_search_patterns = [
                f"@executable_path/../Frameworks/{old_framework_name}/Versions/{py_version}/Python",
                f"@executable_path/../Frameworks/{old_framework_name}/Python",
                f"@loader_path/../../../../{old_framework_name}/Versions/{py_version}/Python",
                f"@loader_path/../../../../{old_framework_name}/Python",
                f"{old_framework_name}/Versions/{py_version}/Python",
                f"{old_framework_name}/Python",
                f"../Frameworks/{old_framework_name}/Versions/{py_version}/Python",
                f"../Frameworks/{old_framework_name}/Python",
                "libpython3.12.dylib",
                "libpython3.11.dylib",
            ]

            print("  Updating ALL binaries to use @rpath/Python and adding correct RPATHs...")
            binary_count = 0
            for root, dirs, files in os.walk(dist_dir):
                for name in files:
                    p = os.path.join(root, name)
                    if not (name.endswith('.so') or name.endswith('.dylib') or '.' not in name):
                        continue

                    is_macho = False
                    try:
                        with open(p, 'rb') as f:
                            magic = f.read(4)
                            if magic in [b'\xca\xfe\xba\xbe', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf']:
                                is_macho = True
                    except: continue

                    if is_macho:
                        binary_count += 1
                        # A) Add RPATHs so the binary can find the lib regardless of nesting
                        os.system(f'install_name_tool -add_rpath "@loader_path" "{p}" 2>/dev/null || true')
                        os.system(f'install_name_tool -add_rpath "@loader_path/_internal" "{p}" 2>/dev/null || true')

                        # B) Update references to point to @rpath/Python
                        for old_pattern in old_search_patterns:
                            os.system(f'install_name_tool -change "{old_pattern}" "{new_id_path}" "{p}" 2>/dev/null || true')

            print(f"  ✅ Restructuring complete. Processed {binary_count} binaries.")
        else:
            print("  ERROR: Could not find Python binary in _internal!")

        # 6. Final Cleanup (Attributes, signatures, metadata)
        print("  Performing final folder sanitization and clean...")
        for root, dirs, files in os.walk(dist_dir):
            # Remove any existing code signatures
            if '_CodeSignature' in dirs:
                shutil.rmtree(os.path.join(root, '_CodeSignature'))

            # Remove metadata and bundle-like files that confuse codesign
            for f in files:
                if f in ['Info.plist', 'PkgInfo', 'manifest'] or f.endswith('.manifest'):
                    try: os.remove(os.path.join(root, f))
                    except: pass

            # Remove Python-specific metadata that can be seen as nested bundles
            for d in dirs:
                if d.endswith('.dist-info') or d.endswith('.egg-info') or d == '__pycache__':
                    try: shutil.rmtree(os.path.join(root, d))
                    except: pass

        # 7. Final symlink elimination
        print("  Final symlink elimination...")
        for root, dirs, files in os.walk(dist_dir):
            for name in files + dirs:
                p = os.path.join(root, name)
                if os.path.islink(p):
                    try:
                        target = os.path.realpath(p)
                        if os.path.isfile(target):
                            os.remove(p)
                            shutil.copy2(target, p)
                        else:
                            os.remove(p)
                    except:
                        if os.path.exists(p): os.remove(p)

        # 8. Signature stripping for CI (Enforces fresh sign)
        print("  Ensuring clean state for CI signing...")
        os.system(f"codesign --remove-signature {dist_dir} 2>/dev/null || true")
        os.system(f"find {dist_dir} -type f -exec codesign --remove-signature {{}} \\; 2>/dev/null || true")
        os.system(f"xattr -rc {dist_dir}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='RelayCraft Engine Build Script')
    parser.add_argument('--sync', action='store_true', help='Only sync addons to resources')
    args = parser.parse_args()

    build(sync_only=args.sync)
