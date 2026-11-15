import { describe, expect, it } from "vitest";
import { matchFlow, parseFilter } from "./filterParser";

const baseFlow = {
  id: "f1",
  method: "GET",
  url: "https://example.com/api",
  host: "example.com",
  path: "/api",
  status: 200,
  statusCode: 200,
  time: 12,
  size: 100,
  clientIp: "127.0.0.1",
  appName: "macos.curl",
  appDisplayName: "curl",
  pid: 4321,
  processName: "curl",
};

describe("filter parser", () => {
  it("splits comma-separated status values into repeated status items", () => {
    const criteria = parseFilter("status:4xx,5xx method:POST");
    expect(criteria.status).toHaveLength(2);
    expect(criteria.status.map((s) => s.value)).toEqual(["4xx", "5xx"]);
    expect(criteria.method).toHaveLength(1);
    expect(criteria.method[0].value).toBe("POST");
  });

  it("keeps negative flag when splitting comma-separated status values", () => {
    const criteria = parseFilter("-status:4xx,5xx");
    expect(criteria.status).toHaveLength(2);
    expect(criteria.status.every((s) => s.negative)).toBe(true);
  });
});

describe("process / pid filters", () => {
  it("parses process: and proc: into the process group", () => {
    const criteria = parseFilter("process:chrome proc:code");
    expect(criteria.process.map((p) => p.value)).toEqual(["chrome", "code"]);
  });

  it("parses pid: into the pid group", () => {
    const criteria = parseFilter("pid:4321");
    expect(criteria.pid).toHaveLength(1);
    expect(criteria.pid[0].value).toBe("4321");
  });

  it("matches processName case-insensitively by default", () => {
    const criteria = parseFilter("process:CUR");
    expect(matchFlow(baseFlow, criteria, false, false)).toBe(true);
    expect(matchFlow({ ...baseFlow, processName: "Python" }, criteria, false, false)).toBe(false);
  });

  it("respects caseSensitive for process names", () => {
    const criteria = parseFilter("process:curl");
    expect(matchFlow(baseFlow, criteria, false, true)).toBe(true);
    expect(matchFlow({ ...baseFlow, processName: "Curl" }, criteria, false, true)).toBe(false);
  });

  it("matches proc: alias identically", () => {
    const criteria = parseFilter("proc:curl");
    expect(matchFlow(baseFlow, criteria, false, false)).toBe(true);
  });

  it("matches pid exactly and rejects missing pid", () => {
    expect(matchFlow(baseFlow, parseFilter("pid:4321"), false, false)).toBe(true);
    expect(matchFlow(baseFlow, parseFilter("pid:9999"), false, false)).toBe(false);
    expect(matchFlow({ ...baseFlow, pid: null }, parseFilter("pid:4321"), false, false)).toBe(
      false,
    );
    expect(matchFlow({ ...baseFlow, pid: undefined }, parseFilter("pid:4321"), false, false)).toBe(
      false,
    );
  });

  it("supports negation for process and pid", () => {
    expect(matchFlow(baseFlow, parseFilter("-process:curl"), false, false)).toBe(false);
    expect(matchFlow(baseFlow, parseFilter("-pid:4321"), false, false)).toBe(false);
    expect(matchFlow(baseFlow, parseFilter("!process:curl"), false, false)).toBe(false);
    expect(
      matchFlow({ ...baseFlow, processName: "Python" }, parseFilter("-process:curl"), false, false),
    ).toBe(true);
  });

  it("source: also matches processName", () => {
    // appName/appDisplayName cleared so only processName can match.
    const procOnly = { ...baseFlow, appName: "", appDisplayName: "", processName: "curl" };
    expect(matchFlow(procOnly, parseFilter("source:curl"), false, false)).toBe(true);
    expect(
      matchFlow({ ...procOnly, processName: "Safari" }, parseFilter("source:curl"), false, false),
    ).toBe(false);
  });

  it("reads processName/pid from _rc for detail flows", () => {
    const detailFlow = {
      ...baseFlow,
      processName: undefined,
      pid: undefined,
      _rc: { processName: "Code.exe", pid: 777 },
    };
    expect(matchFlow(detailFlow, parseFilter("process:code"), false, false)).toBe(true);
    expect(matchFlow(detailFlow, parseFilter("pid:777"), false, false)).toBe(true);
  });
});
