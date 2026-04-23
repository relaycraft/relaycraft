import { describe, expect, it } from "vitest";
import { processColorForVibrancy } from "./vibrancy";

describe("processColorForVibrancy", () => {
  it("returns original value for non-vibrancy variables", () => {
    const value = processColorForVibrancy("--color-border", "rgba(255, 255, 255, 0.08)", {
      vibrancyEnabled: true,
      isDarkTheme: true,
      isMac: false,
    });
    expect(value).toBe("rgba(255, 255, 255, 0.08)");
  });

  it("blends rgba onto solid dark background when vibrancy is off", () => {
    const value = processColorForVibrancy("--color-background", "rgba(13, 15, 22, 0.35)", {
      vibrancyEnabled: false,
      isDarkTheme: true,
      isMac: true,
    });
    expect(value).toBe("rgb(12, 13, 17)");
  });

  it("converts hex to compensated rgba when vibrancy is on for windows", () => {
    const value = processColorForVibrancy("--color-background", "#0d0f16", {
      vibrancyEnabled: true,
      isDarkTheme: true,
      isMac: false,
    });
    expect(value).toBe("rgba(13, 15, 22, 0.545)");
  });

  it("keeps rgba unchanged on mac when vibrancy is on", () => {
    const value = processColorForVibrancy("--color-card", "rgba(20, 23, 34, 0.72)", {
      vibrancyEnabled: true,
      isDarkTheme: true,
      isMac: true,
    });
    expect(value).toBe("rgba(20, 23, 34, 0.72)");
  });
});
