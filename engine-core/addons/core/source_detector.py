"""
Source Detector - Identify traffic source (platform, app) from request metadata.

Extracts appName and appDisplayName from:
- User-Agent header
- Client connection metadata
- Request patterns

Output format:
- appName: machine-readable identifier (e.g. "ios.safari", "android.okhttp")
- appDisplayName: human-readable label (e.g. "Safari", "Android OkHttp")
- platform: detected OS platform (ios/android/macos/windows/linux/unknown)
"""

from typing import Optional, Tuple


def _get_header(headers, name: str) -> Optional[str]:
    """Get header value from mitmproxy headers object (case-insensitive)."""
    for h_name, h_value in headers.fields:
        # Decode header name if it's bytes
        h_name_str = h_name.decode("utf-8", errors="replace") if isinstance(h_name, bytes) else str(h_name)
        if h_name_str.lower() == name.lower():
            if isinstance(h_value, bytes):
                try:
                    return h_value.decode("utf-8")
                except UnicodeDecodeError:
                    return h_value.decode("latin-1")
            return str(h_value)
    return None


def _detect_platform(ua: str) -> str:
    """Detect platform from User-Agent string."""
    ua_lower = ua.lower()
    if "iphone" in ua_lower or "ipad" in ua_lower or "ipod" in ua_lower:
        return "ios"
    if "android" in ua_lower:
        return "android"
    if "mac os x" in ua_lower or "macintosh" in ua_lower:
        return "macos"
    if "windows" in ua_lower:
        return "windows"
    if "linux" in ua_lower and "android" not in ua_lower:
        return "linux"
    return "unknown"


def _detect_framework(ua: str, platform: str) -> Tuple[str, str]:
    """
    Detect HTTP client framework/app from User-Agent.
    Returns (appName, appDisplayName).
    """
    ua_lower = ua.lower()

    # Dart/Flutter
    if "dart" in ua_lower:
        label = "Flutter" if "flutter" in ua_lower else "Dart"
        return f"{platform}.dart", label

    # OkHttp (Android's standard HTTP client)
    if "okhttp" in ua_lower:
        effective_platform = platform if platform != "unknown" else "android"
        return f"{effective_platform}.okhttp", "OkHttp"

    # Cronet (Chromium network stack)
    if "cronet" in ua_lower:
        return f"{platform}.cronet", "Cronet"

    # CFNetwork (Apple native networking) — check for iOS markers
    if "cfnetwork" in ua_lower or "darwin" in ua_lower:
        effective_platform = platform if platform != "unknown" else "ios"
        return f"{effective_platform}.cfnetwork", "CFNetwork"

    # Browsers — check Firefox before Safari (Safari string appears in all iOS browsers)
    if "firefox" in ua_lower or "fxios" in ua_lower:
        return f"{platform}.firefox", "Firefox"
    if "edg" in ua_lower:
        return f"{platform}.edge", "Edge"
    if "safari" in ua_lower and "chrome" not in ua_lower and "crios" not in ua_lower:
        return f"{platform}.safari", "Safari"
    if "chrome" in ua_lower or "crios" in ua_lower:
        return f"{platform}.chrome", "Chrome"

    # curl / CLI tools
    if "curl" in ua_lower:
        return f"{platform}.curl", "curl"
    if "wget" in ua_lower:
        return f"{platform}.wget", "wget"
    if "python-requests" in ua_lower or "python-urllib" in ua_lower:
        return f"{platform}.python", "Python"
    if "node-fetch" in ua_lower or "axios" in ua_lower or "got" in ua_lower:
        return f"{platform}.nodejs", "Node.js"
    if "go-http-client" in ua_lower:
        return f"{platform}.go", "Go"

    # JDK / Java
    if "java/" in ua_lower:
        return f"{platform}.java", "Java"

    # Generic platform fallback
    if platform == "ios":
        return "ios.app", "iOS App"
    if platform == "android":
        return "android.app", "Android App"

    return f"{platform}.unknown", "Unknown"


def _platform_display_name(platform: str) -> str:
    """Get human-readable platform name."""
    return {
        "ios": "iOS",
        "android": "Android",
        "macos": "macOS",
        "windows": "Windows",
        "linux": "Linux",
        "unknown": "Unknown",
    }.get(platform, "Unknown")


def detect_source(flow) -> Tuple[Optional[str], Optional[str], str]:
    """
    Detect traffic source from a mitmproxy flow.

    Args:
        flow: mitmproxy HTTPFlow object

    Returns:
        Tuple of (appName, appDisplayName, platform)
    """
    ua = _get_header(flow.request.headers, "user-agent")
    if not ua:
        return None, None, "unknown"

    platform = _detect_platform(ua)
    app_name, app_display = _detect_framework(ua, platform)

    # Infer effective platform from app_name if original detection was unknown
    # (e.g. OkHttp defaults to android, CFNetwork defaults to ios)
    effective_platform = platform
    if platform == "unknown" and app_name:
        parts = app_name.split(".")
        if parts and parts[0] != "unknown":
            effective_platform = parts[0]

    # Build display name: "Platform · App"
    platform_label = _platform_display_name(effective_platform)
    display_name = f"{platform_label} · {app_display}"

    return app_name, display_name, effective_platform
