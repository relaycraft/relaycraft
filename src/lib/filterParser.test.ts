import { describe, expect, it } from "vitest";
import { parseFilter } from "./filterParser";

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
