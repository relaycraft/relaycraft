# Engine Core Build Guide

> **English** | [中文](README.zh-CN.md)

This directory contains the scripts to package mitmproxy into a standalone executable for RelayCraft.

## Prerequisites

Install Python dependencies:

```bash
pip install -r requirements.txt
```

## Build

Run the build script to generate the executable for your current platform:

```bash
python build.py
```

This will create a platform-specific executable in the `dist/` directory:

- **Windows**: `engine.exe` (Single file)
- **Linux**: `engine` (Single file)
- **macOS**: `dist/engine/` (Directory containing executable and dependencies)

## Integration

To use the built engine in RelayCraft:

### Windows & Linux (Sidecar)
Copy the single-file executable to the Tauri binaries directory with the correct target triple:

```bash
# Windows
copy dist\engine.exe ..\src-tauri\binaries\engine-x86_64-pc-windows-msvc.exe

# Linux
cp dist/engine ..\src-tauri\binaries\engine-x86_64-unknown-linux-gnu
```

### macOS (Bundle Resources)
For macOS, we use `onedir` mode to improve startup performance. Copy the **entire contents** of the build directory to the resources folder:

```bash
# Create directory
mkdir -p ../src-tauri/resources/engine

# Copy contents
cp -r dist/engine/* ../src-tauri/resources/engine/
```

> **Note**: The filename in `src-tauri/binaries/` must match the target triple format required by Tauri sidecar.

## Testing

You can test the executable directly before integration:

```bash
# Windows
dist\engine.exe

# macOS/Linux
./dist/engine/engine
```

**Expected Output**:
- mitmproxy starting...
- HTTP server listening on port 9090
