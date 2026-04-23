interface ParseAIResponseOptions {
  parseYAML: (input: string) => unknown;
}

type ParseAIResponseResult =
  | {
      type: "message";
      message: string;
    }
  | {
      type: "rule";
      ruleData: Record<string, unknown>;
    }
  | {
      type: "none";
      parseError: unknown | null;
    };

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const tryParse = (raw: string, parseYAML: (input: string) => unknown): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObjectLike(parsed)) return parsed;
    throw new Error("Parsed response is not an object");
  } catch (_e) {
    const cleaned = raw
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
      .replace(/'/g, '"');

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      if (isObjectLike(parsed)) return parsed;
      throw new Error("Cleaned response is not an object");
    } catch (jsonError) {
      if (raw.includes("name:") && raw.includes("type:")) {
        try {
          const yamlParsed = parseYAML(raw);
          if (isObjectLike(yamlParsed)) return yamlParsed;
        } catch (_yamlError) {}
      }
      throw jsonError;
    }
  }
};

const extractJSONCandidate = (fullResponse: string): string => {
  const codeBlockMatch = fullResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1];

  const firstBraceIndex = fullResponse.indexOf("{");
  if (firstBraceIndex !== -1) {
    let braceCount = 0;
    let lastBraceIndex = -1;
    for (let i = firstBraceIndex; i < fullResponse.length; i++) {
      if (fullResponse[i] === "{") braceCount++;
      else if (fullResponse[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          lastBraceIndex = i;
          break;
        }
      }
    }
    if (lastBraceIndex !== -1) {
      return fullResponse.substring(firstBraceIndex, lastBraceIndex + 1);
    }
  }

  if (firstBraceIndex !== -1) {
    const lastBrace = fullResponse.lastIndexOf("}");
    if (lastBrace !== -1 && lastBrace > firstBraceIndex) {
      return fullResponse.substring(firstBraceIndex, lastBrace + 1);
    }
  }

  if (fullResponse.includes('"rule":') || fullResponse.includes('"name":')) {
    const fragmentMatch = fullResponse.match(/("rule"|"name")\s*:\s*(\{[\s\S]*\}|"[^"]*")/);
    if (fragmentMatch) {
      return `{ ${fragmentMatch[0]} }`;
    }
  }

  return "";
};

export function parseAIResponse(
  fullResponse: string,
  { parseYAML }: ParseAIResponseOptions,
): ParseAIResponseResult {
  const msgMatch = fullResponse.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (msgMatch && !fullResponse.includes('"rule"')) {
    return {
      type: "message",
      message: msgMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    };
  }

  const jsonString = extractJSONCandidate(fullResponse);
  if (!jsonString) {
    return { type: "none", parseError: null };
  }

  try {
    const aiData = tryParse(jsonString, parseYAML);

    const message = aiData.message;
    if (typeof message === "string" && !aiData.rule) {
      let finalMessage = message;
      if (finalMessage.startsWith('"') && finalMessage.endsWith('"')) {
        try {
          const unescaped = JSON.parse(finalMessage) as unknown;
          if (typeof unescaped === "string") {
            finalMessage = unescaped;
          }
        } catch (_e) {}
      }
      return { type: "message", message: finalMessage };
    }

    const hasName = typeof aiData.name === "string";
    const hasType = typeof aiData.type === "string";
    const nestedRule = aiData.rule;
    if (isObjectLike(nestedRule)) {
      return { type: "rule", ruleData: nestedRule };
    }
    if (hasName && hasType) {
      return { type: "rule", ruleData: aiData };
    }
  } catch (e) {
    return { type: "none", parseError: e };
  }

  return { type: "none", parseError: null };
}
