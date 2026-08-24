import { describe, expect, it } from "vitest";
import { normalizeInstallErrorMessage, stageAwareInstallMessage } from "./pluginInstallError";

describe("plugin install error staging", () => {
  it("strips Error: prefixes before matching the stage tag", () => {
    expect(normalizeInstallErrorMessage("Error: [manifest] bad id")).toBe("[manifest] bad id");
    expect(normalizeInstallErrorMessage("error: error: [archive] zip")).toBe("[archive] zip");
  });

  it("maps stage tags to a localized label plus the raw message", () => {
    const t = (key: string) => key;
    expect(stageAwareInstallMessage("Error: [manifest] missing id", t)).toBe(
      "plugins.errors.installStage.manifest\n[manifest] missing id",
    );
    expect(stageAwareInstallMessage("network down", t)).toBeNull();
  });
});
