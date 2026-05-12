import { describe, expect, it } from "vitest";
import { getDisplayableUpdateNotes } from "./updateReleaseNotes";

describe("getDisplayableUpdateNotes", () => {
  it("returns null for empty body", () => {
    expect(getDisplayableUpdateNotes(undefined, "1.1.1")).toBeNull();
    expect(getDisplayableUpdateNotes("   ", "1.1.1")).toBeNull();
  });

  it("filters single-line release tag noise", () => {
    expect(getDisplayableUpdateNotes("Release v1.1.1", "1.1.1")).toBeNull();
    expect(getDisplayableUpdateNotes("release 1.1.1", "1.1.1")).toBeNull();
    expect(getDisplayableUpdateNotes("v1.1.1", "1.1.1")).toBeNull();
    expect(getDisplayableUpdateNotes("Version 1.1.1", "1.1.1")).toBeNull();
  });

  it("keeps substantive notes", () => {
    const notes = "Release v1.1.1\n\n- Fix crash on startup\n- Improve TLS handling";
    expect(getDisplayableUpdateNotes(notes, "1.1.1")).toBe(notes);
  });
});
