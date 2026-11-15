import { describe, expect, it } from "vitest";
import { buildMatchRequest } from "./ruleEditorSerialization";

describe("buildMatchRequest process atom", () => {
  it("omits the process atom when pattern is empty or whitespace", () => {
    const atoms = buildMatchRequest("example.com", "contains", [], [], {
      pattern: "   ",
      matchType: "contains",
    });
    expect(atoms.find((a) => a.type === "process")).toBeUndefined();
    const atoms2 = buildMatchRequest("example.com", "contains", [], []);
    expect(atoms2.find((a) => a.type === "process")).toBeUndefined();
  });

  it("appends a process atom with trimmed pattern and matchType", () => {
    const atoms = buildMatchRequest("example.com", "contains", ["GET"], [], {
      pattern: "  chrome  ",
      matchType: "wildcard",
    });
    const proc = atoms.find((a) => a.type === "process");
    expect(proc).toEqual({ type: "process", matchType: "wildcard", value: "chrome" });
  });

  it("round-trips: atoms produced can initialize editor state", () => {
    const atoms = buildMatchRequest("example.com", "contains", [], [], {
      pattern: "Code.exe",
      matchType: "exact",
    });
    const procAtom = atoms.find((a) => a.type === "process");
    expect(procAtom?.value).toBe("Code.exe");
    expect(procAtom?.matchType).toBe("exact");
  });
});
