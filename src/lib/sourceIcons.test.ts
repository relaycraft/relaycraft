import { describe, expect, it } from "vitest";
import { formatAppSourceTooltip, getAppIcon, shortAppLabel } from "./sourceIcons";

describe("shortAppLabel", () => {
  it("returns the app part of legacy Platform · App labels", () => {
    expect(shortAppLabel("macOS · Chrome")).toBe("Chrome");
    expect(shortAppLabel("Android · OkHttp")).toBe("OkHttp");
  });

  it("keeps already-short labels", () => {
    expect(shortAppLabel("Chrome")).toBe("Chrome");
    expect(shortAppLabel("curl")).toBe("curl");
  });
});

describe("formatAppSourceTooltip", () => {
  it("omits redundant Chrome helper process and local IP", () => {
    expect(
      formatAppSourceTooltip({
        appDisplayName: "macOS · Chrome",
        appName: "macos.chrome",
        processName: "Google Chrome Helper",
        pid: 7853,
        clientIp: "127.0.0.1",
        isLocal: true,
      }),
    ).toBe("Chrome · PID 7853");
  });

  it("keeps distinct process names", () => {
    expect(
      formatAppSourceTooltip({
        appDisplayName: "Unknown",
        appName: "macos.unknown",
        processName: "MyApp",
        pid: 42,
        isLocal: true,
      }),
    ).toBe("Unknown · MyApp · PID 42");
  });

  it("shows remote client IP", () => {
    expect(
      formatAppSourceTooltip({
        appDisplayName: "Safari",
        appName: "ios.safari",
        clientIp: "192.168.5.20",
        isLocal: false,
      }),
    ).toBe("Safari · 192.168.5.20");
  });
});

describe("getAppIcon", () => {
  it("uses brand marks for common browsers", () => {
    expect(getAppIcon("macos.chrome").kind).toBe("chrome");
    expect(getAppIcon("macos.safari").kind).toBe("safari");
    expect(getAppIcon("macos.firefox").kind).toBe("firefox");
    expect(getAppIcon("macos.edge").kind).toBe("edge");
    expect(new Set(["chrome", "safari", "firefox", "edge"]).size).toBe(4);
  });
});
