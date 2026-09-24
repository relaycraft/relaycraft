import { describe, expect, it } from "vitest";
import { detectRuleImportSource, prepareJsonRuleImport } from "./importSource";

describe("detectRuleImportSource", () => {
  it("detects json and zip case-insensitively", () => {
    expect(detectRuleImportSource("rules.json")).toEqual({
      status: "supported",
      sourceId: "relaycraft-json",
    });
    expect(detectRuleImportSource("RULES.JSON")).toEqual({
      status: "supported",
      sourceId: "relaycraft-json",
    });
    expect(detectRuleImportSource("backup.zip")).toEqual({
      status: "supported",
      sourceId: "legacy-zip",
    });
    expect(detectRuleImportSource("/tmp/Export.ZIP")).toEqual({
      status: "supported",
      sourceId: "legacy-zip",
    });
  });

  it("routes any .zip by extension only — it is not claimed validated", () => {
    // Detection is filename-based; an arbitrary/malicious ZIP still resolves
    // to the legacy importer route. Content verification is not done here.
    const detection = detectRuleImportSource("totally-not-an-export.zip");
    expect(detection).toEqual({ status: "supported", sourceId: "legacy-zip" });
  });

  it("rejects unknown and missing extensions", () => {
    for (const name of ["rules.txt", "rules.yaml", "rules", "rules.zipx"]) {
      expect(detectRuleImportSource(name).status).toBe("unsupported");
    }
    expect(detectRuleImportSource("postman_collection.json5").status).toBe("unsupported");
    expect(detectRuleImportSource("notes.md").status).toBe("unsupported");
  });
});

describe("prepareJsonRuleImport", () => {
  const rule = {
    id: "r1",
    name: "block",
    match: { request: [{ type: "url" }] },
    actions: [{ type: "block_request" }],
  };

  it("passes a v2 wrapped bundle through unchanged, retaining ruleGroups", () => {
    const data = {
      version: "2.0",
      type: "relaycraft-rules-bundle",
      timestamp: 123,
      bundle: { groups: [{ id: "g1", name: "g1" }], rules: [rule], ruleGroups: { r1: "g1" } },
    };
    const result = prepareJsonRuleImport(JSON.stringify(data));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.sourceId).toBe("relaycraft-json");
      expect(JSON.parse(result.payload)).toEqual(data);
    }
  });

  it("accepts a raw {rules: []} bundle", () => {
    const data = { rules: [rule], groups: [] };
    const result = prepareJsonRuleImport(JSON.stringify(data));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.parse(result.payload)).toEqual(data);
    }
  });

  it("wraps a legacy single rule into a bundle", () => {
    const result = prepareJsonRuleImport(JSON.stringify(rule));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.parse(result.payload)).toEqual({ rules: [rule], groups: [] });
    }
  });

  it("rejects malformed JSON", () => {
    const result = prepareJsonRuleImport("{not json");
    expect(result).toEqual({
      status: "invalid",
      sourceId: "relaycraft-json",
      reason: "invalid_json",
    });
  });

  it("rejects third-party JSON masquerading as a bundle", () => {
    const cases = [
      JSON.stringify({ swagger: "2.0", paths: {} }),
      JSON.stringify({ info: { name: "postman" }, item: [] }),
      // Bundle wrapper with a foreign sibling key.
      JSON.stringify({ bundle: { rules: [] }, foreign: true }),
      // Bundle inner object with an unknown key.
      JSON.stringify({ bundle: { rules: [], groups: [], secretField: {} } }),
      // rules present but not an array.
      JSON.stringify({ rules: "nope" }),
      // Raw bundle with an unknown sibling key.
      JSON.stringify({ rules: [], unknown: 1 }),
      // Non-object roots.
      JSON.stringify([rule]),
      "42",
      "null",
    ];
    for (const text of cases) {
      const result = prepareJsonRuleImport(text);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.reason).toBe("unsupported_shape");
      }
    }
  });
});
