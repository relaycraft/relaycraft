from typing import Dict


I18N_CERT_LANDING = {
    "zh": {
        "lang": "zh-CN",
        "title": "RelayCraft · 证书安装指南",
        "tagline": "AI 原生网络流量调试工具",
        "proxy_connected_label": "代理已连接",
        "device_system_label": "选择设备系统",
        "ios_label": "iOS",
        "android_label": "Android",
        "harmony_label": "HarmonyOS",
        "dl_ios_btn": "下载 iOS 证书",
        "dl_android_btn": "下载 Android 证书",
        "dl_harmony_btn": "下载 HarmonyOS 证书",
        "step_ios_1": "在 <strong>Safari</strong> 浏览器中点击允许下载",
        "step_ios_2": "进入 <strong>设置 → 已下载描述文件</strong> 进行安装",
        "step_ios_3": "进入 <strong>通用 → 关于本机 → 证书信任设置</strong>",
        "step_ios_4": "勾选 <strong>RelayCraft CA</strong> 开启完全信任",
        "step_android_1": "点击上方按钮下载 <code>.crt</code> 证书文件",
        "step_android_2": "进入 <strong>系统设置 → 安全 → 从存储设备安装</strong>",
        "step_android_3": "选择 <strong>CA 证书</strong> 选项",
        "step_android_4": "在文件选择器中找到下载的证书并确认",
        "step_harmony_1": "点击上方按钮下载 <code>.pem</code> 证书文件",
        "step_harmony_2": "设置 → 安全 → 更多安全设置 → 加密和凭据",
        "step_harmony_3": "点击 <strong>从存储设备安装</strong> → <strong>CA 证书</strong>",
        "step_harmony_4": "在下载目录选择证书并确认安装",
        "manual_install_label": "手动下载格式",
        "pem_format_label": "PEM 格式",
        "crt_format_label": "CRT 格式",
        "warning_text": "仅供本地调试使用。请勿在非信任设备上安装。",
        "footer_text": "RelayCraft · AI 原生网络流量调试工具",
    },
    "en": {
        "lang": "en-US",
        "title": "RelayCraft · Certificate Guide",
        "tagline": "AI-Native Web Traffic Debugging Tool",
        "proxy_connected_label": "Proxy Connected",
        "device_system_label": "Device System",
        "ios_label": "iOS",
        "android_label": "Android",
        "harmony_label": "HarmonyOS",
        "dl_ios_btn": "Download for iOS",
        "dl_android_btn": "Download for Android",
        "dl_harmony_btn": "Download for HarmonyOS",
        "step_ios_1": "Allow download in <strong>Safari</strong>",
        "step_ios_2": "Install in <strong>Settings → Profile Downloaded</strong>",
        "step_ios_3": "Go to <strong>General → About → Trust Settings</strong>",
        "step_ios_4": "Enable full trust for <strong>RelayCraft CA</strong>",
        "step_android_1": "Download the <code>.crt</code> certificate file",
        "step_android_2": "Go to <strong>Settings → Security → Install from storage</strong>",
        "step_android_3": "Select <strong>CA Certificate</strong>",
        "step_android_4": "Choose the RelayCraft file to confirm",
        "step_harmony_1": "Download the <code>.pem</code> certificate file",
        "step_harmony_2": "Settings → Security → More → Encryption & Credentials",
        "step_harmony_3": "Tap <strong>Install from storage</strong> → <strong>CA Certificate</strong>",
        "step_harmony_4": "Select the certificate from Downloads to confirm",
        "manual_install_label": "Manual Install",
        "pem_format_label": "PEM Format",
        "crt_format_label": "CRT Format",
        "warning_text": "For local debugging only. Do not install on untrusted devices.",
        "footer_text": "RelayCraft · AI-Native Web Traffic Debugging Tool",
    },
}


def select_cert_lang(accept_language: str) -> str:
    return "zh" if "zh" in (accept_language or "").lower() else "en"


def detect_cert_device_os(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if "iphone" in ua or "ipad" in ua or "macintosh" in ua or "mac os x" in ua:
        return "ios"
    if "harmony" in ua or "hms" in ua or "openharmony" in ua:
        return "harmony"
    if "android" in ua:
        return "android"
    return "android"


def build_cert_template_vars(
    accept_language: str,
    user_agent: str,
    proxy_addr: str,
) -> Dict[str, str]:
    lang = select_cert_lang(accept_language)
    t_vars = I18N_CERT_LANDING[lang].copy()
    t_vars["proxy_addr"] = proxy_addr
    t_vars["detected_os"] = detect_cert_device_os(user_agent)
    return t_vars
