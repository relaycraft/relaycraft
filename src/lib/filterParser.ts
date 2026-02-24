export interface FilterItem {
  key: string;
  value: string;
  operator?: ">" | "<" | ">=" | "<=";
  negative?: boolean;
}

export interface FilterCriteria {
  text: FilterItem[];
  method: FilterItem[];
  status: FilterItem[];
  domain: FilterItem[];
  type: FilterItem[];
  header: FilterItem[];
  body: FilterItem[];
  reqbody: FilterItem[];
  size: FilterItem[];
  duration: FilterItem[];
  ip: FilterItem[];
  source: FilterItem[];
}

export function parseFilter(input: string): FilterCriteria {
  const criteria: FilterCriteria = {
    text: [],
    method: [],
    status: [],
    domain: [],
    type: [],
    header: [],
    body: [],
    reqbody: [],
    size: [],
    duration: [],
    ip: [],
    source: [],
  };

  const parts = input.split(" ").filter((p) => p.trim() !== "");

  parts.forEach((part) => {
    let isNegative = false;
    let cleanPart = part;

    if (part.startsWith("!") || part.startsWith("-")) {
      isNegative = true;
      cleanPart = part.substring(1);
    }

    if (cleanPart.includes(":")) {
      const firstColonIndex = cleanPart.indexOf(":");
      const key = cleanPart.substring(0, firstColonIndex).toLowerCase();
      let value = cleanPart.substring(firstColonIndex + 1);

      let operator: FilterItem["operator"];
      if (value.startsWith(">=") || value.startsWith("<=")) {
        operator = value.substring(0, 2) as any;
        value = value.substring(2);
      } else if (value.startsWith(">") || value.startsWith("<")) {
        operator = value.substring(0, 1) as any;
        value = value.substring(1);
      }

      const item: FilterItem = {
        key,
        value: value, // Retain case for sensitive searches
        negative: isNegative,
        operator,
      };

      switch (key) {
        case "method":
        case "m":
          criteria.method.push(item);
          break;
        case "status":
        case "s":
          criteria.status.push(item);
          break;
        case "domain":
        case "d":
        case "host":
          criteria.domain.push(item);
          break;
        case "type":
        case "t":
          criteria.type.push(item);
          break;
        case "header":
        case "h":
          criteria.header.push(item);
          break;
        case "body":
        case "resbody":
          criteria.body.push(item);
          break;
        case "reqbody":
        case "rb":
          criteria.reqbody.push(item);
          break;
        case "size":
        case "sz":
          criteria.size.push(item);
          break;
        case "duration":
        case "dur":
          criteria.duration.push(item);
          break;
        case "ip":
          criteria.ip.push(item);
          break;
        case "src":
        case "source":
          criteria.source.push(item);
          break;
        default:
          criteria.text.push({
            key: "",
            value: part, // Retain case for sensitive searches
            negative: isNegative,
          });
      }
    } else {
      criteria.text.push({
        key: "",
        value: cleanPart, // Retain case for sensitive searches
        negative: isNegative,
      });
    }
  });

  return criteria;
}

function parseSize(val: string): number {
  const num = parseFloat(val);
  if (isNaN(num)) return 0;
  const unit = val
    .toLowerCase()
    .replace(/[0-9.]/g, "")
    .trim();
  if (unit === "kb" || unit === "k") return num * 1024;
  if (unit === "mb" || unit === "m") return num * 1024 * 1024;
  if (unit === "gb" || unit === "g") return num * 1024 * 1024 * 1024;
  return num;
}

function parseDuration(val: string): number {
  const num = parseFloat(val);
  if (isNaN(num)) return 0;
  const unit = val
    .toLowerCase()
    .replace(/[0-9.]/g, "")
    .trim();
  if (unit === "s") return num * 1000;
  if (unit === "m") return num * 60 * 1000;
  return num; // Default ms
}

function compare(actual: number, expected: number, operator: FilterItem["operator"]): boolean {
  switch (operator) {
    case ">":
      return actual > expected;
    case "<":
      return actual < expected;
    case ">=":
      return actual >= expected;
    case "<=":
      return actual <= expected;
    default:
      return actual === expected;
  }
}

export function matchFlow(
  flow: any,
  criteria: FilterCriteria,
  isRegex: boolean,
  caseSensitive: boolean,
): boolean {
  // Helper function for case-aware string matching
  const matchString = (actual: string, search: string): boolean => {
    if (caseSensitive) {
      return actual.includes(search);
    }
    return actual.toLowerCase().includes(search.toLowerCase());
  };

  // Helper function for case-aware equality check
  const equalsString = (actual: string, search: string): boolean => {
    if (caseSensitive) {
      return actual === search;
    }
    return actual.toLowerCase() === search.toLowerCase();
  };

  const checkGroup = (items: FilterItem[], matchFn: (item: FilterItem) => boolean) => {
    if (items.length === 0) return true;
    // Logic: OR within group, negative acts as exclusion
    const positive = items.filter((i) => !i.negative);
    const negative = items.filter((i) => i.negative);

    const posMatch = positive.length === 0 || positive.some(matchFn);

    if (negative.length > 0) {
      // Exclude if any negative matches
      if (negative.some((i) => matchFn({ ...i, negative: false }))) return false;
    }

    return posMatch;
  };

  // 1. Method
  if (!checkGroup(criteria.method, (item) => equalsString(flow.method || "", item.value)))
    return false;

  // 2. Status
  if (
    !checkGroup(criteria.status, (item) => {
      // Support Flow and FlowIndex status
      const flowStatus = (flow.statusCode ?? flow.status)?.toString() || "";
      if (item.value.endsWith("xx")) {
        return flowStatus.startsWith(item.value[0]);
      }
      return flowStatus === item.value;
    })
  )
    return false;

  // 3. Domain
  if (
    !checkGroup(criteria.domain, (item) => {
      return matchString(flow.host || "", item.value);
    })
  )
    return false;

  // 4. Type (case-insensitive)
  if (
    !checkGroup(criteria.type, (item) => {
      const contentType = (
        flow.responseHeaders?.["content-type"] ||
        flow.contentType ||
        ""
      ).toLowerCase();
      const url = (flow.url || "").toLowerCase();
      const val = item.value.toLowerCase();
      if (val === "json") return contentType.includes("json");
      if (val === "image" || val === "img") return contentType.includes("image");
      if (val === "js" || val === "script")
        return contentType.includes("javascript") || url.endsWith(".js");
      if (val === "css") return contentType.includes("css") || url.endsWith(".css");
      if (val === "html") return contentType.includes("html");
      return contentType.includes(val);
    })
  )
    return false;

  // 5. IP (Any)
  if (
    !checkGroup(criteria.ip, (item) => {
      return (
        (flow.clientIp || "").includes(item.value) || (flow.serverIp || "").includes(item.value)
      );
    })
  )
    return false;

  // 6. Source IP (Strict)
  if (
    !checkGroup(criteria.source, (item) => {
      return (flow.clientIp || "").includes(item.value);
    })
  )
    return false;

  // 7. Sizing
  if (
    !checkGroup(criteria.size, (item) => {
      const actual = flow.size || 0;
      const expected = parseSize(item.value);
      return compare(actual, expected, item.operator);
    })
  )
    return false;

  // 8. Duration
  if (
    !checkGroup(criteria.duration, (item) => {
      // Support Flow duration and FlowIndex time
      const actual = flow.duration ?? (flow.time || 0);
      const expected = parseDuration(item.value);
      return compare(actual, expected, item.operator);
    })
  )
    return false;

  // 9. Headers
  if (
    !checkGroup(criteria.header, (item) => {
      const reqHeaders = flow.requestHeaders || {};
      const resHeaders = flow.responseHeaders || {};
      const combined = { ...reqHeaders, ...resHeaders };

      // item.value might be "key:val" or just "val" (search in all keys/values)
      if (item.value.includes(":")) {
        const colonIndex = item.value.indexOf(":");
        const hKey = item.value.substring(0, colonIndex);
        const hVal = item.value.substring(colonIndex + 1);
        const actualVal = Object.entries(combined).find(
          ([k]) => k.toLowerCase() === hKey.toLowerCase(),
        )?.[1] as string;
        return actualVal ? matchString(actualVal, hVal) : false;
      }

      // Search in all headers
      return Object.entries(combined).some(
        ([k, v]) => matchString(k, item.value) || matchString(String(v), item.value),
      );
    })
  )
    return false;

  // 10. Body
  const matchText = (actual: string | undefined, search: string) => {
    if (!actual) return false;
    if (isRegex) {
      try {
        return new RegExp(search, caseSensitive ? "" : "i").test(actual);
      } catch (e) {
        return false;
      }
    }
    return matchString(actual, search);
  };

  if (!checkGroup(criteria.body, (item) => matchText(flow.responseBody, item.value))) return false;
  if (!checkGroup(criteria.reqbody, (item) => matchText(flow.requestBody, item.value)))
    return false;

  // 11. General Text (AND logic)
  if (criteria.text.length > 0) {
    // General text: AND logic
    for (const item of criteria.text) {
      // Support Flow and FlowIndex status
      const statusStr = (flow.statusCode ?? flow.status)?.toString() || "";
      const url = flow.url || "";
      const method = flow.method || "";
      const host = flow.host || "";

      let isMatch: boolean;
      if (isRegex) {
        // Use regex matching for general text search
        try {
          const regex = new RegExp(item.value, caseSensitive ? "" : "i");
          isMatch =
            regex.test(url) || regex.test(method) || regex.test(statusStr) || regex.test(host);
        } catch (e) {
          // Invalid regex, fall back to literal search
          isMatch =
            matchString(url, item.value) ||
            matchString(method, item.value) ||
            statusStr.includes(item.value) ||
            matchString(host, item.value);
        }
      } else {
        // Use literal matching with case sensitivity support
        isMatch =
          matchString(url, item.value) ||
          matchString(method, item.value) ||
          statusStr.includes(item.value) ||
          matchString(host, item.value);
      }

      if (item.negative) {
        if (isMatch) return false;
      } else {
        if (!isMatch) return false;
      }
    }
  }

  return true;
}
