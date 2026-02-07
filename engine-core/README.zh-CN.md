# 核心引擎构建指南

> [English](README.md) | **中文**

本目录包含将 mitmproxy 打包为 RelayCraft 独立可执行文件的脚本。

## 环境要求

安装 Python 依赖：

```bash
pip install -r requirements.txt
```

## 构建

运行构建脚本以生成当前平台的二进制文件：

```bash
python build.py
```

构建完成后，`dist/` 目录下会生成对应平台的产物：

- **Windows**: `mitmdump.exe` (单文件)
- **Linux**: `mitmdump` (单文件)
- **macOS**: `dist/mitmdump/` (文件夹，包含可执行文件和依赖)

## 集成

将构建好的引擎集成到 RelayCraft 中：

### Windows & Linux (Sidecar 模式)
将生成的单文件可执行程序复制到 Tauri 的二进制目录，并重命名为目标平台格式：

```bash
# Windows
copy dist\mitmdump.exe ..\src-tauri\binaries\engine-x86_64-pc-windows-msvc.exe

# Linux
cp dist/mitmdump ../src-tauri/binaries/engine-x86_64-unknown-linux-gnu
```

### macOS (资源包模式)
为了优化启动速度，macOS 版本使用 `onedir` 模式构建。请将构建目录下的 **所有内容** 复制到资源目录：

```bash
# 创建目录
mkdir -p ../src-tauri/resources/engine

# 复制内容
cp -r dist/mitmdump/* ../src-tauri/resources/engine/
```

> **注意**：`src-tauri/binaries/` 中的文件名必须符合 Tauri Sidecar 要求的 target triple 格式。

## 测试

集成前，您可以直接运行生成的文件进行测试：

```bash
# Windows
dist\mitmdump-windows.exe

# macOS/Linux
./dist/mitmdump-macos
```

**预期输出**:
- mitmproxy starting... (mitmproxy 启动中...)
- HTTP server listening on port 9090 (HTTP 服务监听端口 9090)
