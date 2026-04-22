import type { AIMessage } from "../../types/ai";

const HISTORY_SUMMARY_MAX_CHARS = 900;
const MIN_ALWAYS_CARRY_TURNS = 1;

const truncateText = (text: string, max = 120): string => {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

export const buildTurnsFromHistory = (history: AIMessage[]): AIMessage[][] => {
  const turns: AIMessage[][] = [];
  let currentTurn: AIMessage[] | null = null;

  for (const msg of history) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      if (currentTurn && currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
      continue;
    }
    if (!currentTurn) continue;
    currentTurn.push(msg);
  }

  if (currentTurn && currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
};

const flattenTurns = (turns: AIMessage[][]): AIMessage[] => turns.flat();

const extractKeywords = (text: string): Set<string> => {
  const latin = (text.toLowerCase().match(/[a-z0-9_]{3,}/g) || []).map((s) => s.trim());
  const cjkChunks = (text.match(/[\u4e00-\u9fff]{2,}/g) || []).map((s) => s.trim());
  const cjkNgrams = cjkChunks.flatMap((chunk) => {
    const grams: string[] = [];
    const maxGram = Math.min(4, chunk.length);
    for (let size = 2; size <= maxGram; size += 1) {
      for (let i = 0; i + size <= chunk.length; i += 1) {
        grams.push(chunk.slice(i, i + size));
      }
    }
    return grams;
  });
  return new Set([...latin, ...cjkNgrams].filter(Boolean));
};

const GENERIC_TOPIC_WORDS = new Set([
  "请求",
  "问题",
  "这个",
  "那个",
  "怎么",
  "如何",
  "分析",
  "处理",
  "结果",
  "情况",
  "接口",
  "response",
  "request",
  "issue",
  "error",
  "problem",
  "analyze",
]);

const isStrongKeyword = (keyword: string): boolean => {
  if (!keyword) return false;
  if (GENERIC_TOPIC_WORDS.has(keyword.toLowerCase())) return false;
  if (/[./:_-]/.test(keyword)) return true; // URL/path/domain-ish token
  if (/^\d{3,}$/.test(keyword)) return true; // status/error code-like token
  const hasCJK = /[\u4e00-\u9fff]/.test(keyword);
  // Language-aware threshold:
  // - CJK tokens are semantically denser, so 2+ chars are often high-signal.
  // - Latin tokens keep a stricter 4+ threshold to avoid noisy linking.
  if (hasCJK) return keyword.length >= 2;
  return keyword.length >= 4;
};

const getStrongKeywords = (text: string): Set<string> =>
  new Set([...extractKeywords(text)].filter((key) => isStrongKeyword(key)));

export const shouldCarryRecentTurns = (input: string, turns: AIMessage[][]): boolean => {
  if (!turns.length) return false;
  const referentialPattern =
    /(上面|上述|刚才|之前|继续|接着|延续|previous|earlier|continue|follow[\s-]?up)/i;
  if (referentialPattern.test(input)) {
    return true;
  }

  const inputKeys = getStrongKeywords(input);
  if (!inputKeys.size) return false;

  const recentUserMsgs = turns
    .slice(-3)
    .map((turn) => turn.find((m) => m.role === "user")?.content || "");
  const recentKeys = new Set(recentUserMsgs.flatMap((msg) => [...getStrongKeywords(msg)]));
  let overlap = 0;
  for (const key of inputKeys) {
    if (recentKeys.has(key)) overlap += 1;
  }

  // Conservative carry rule:
  // - either at least two strong overlaps,
  // - or one strong overlap that accounts for most of short query semantics.
  if (overlap >= 2) return true;
  if (overlap === 1 && inputKeys.size <= 2) return true;
  return false;
};

export const buildDroppedTurnsSummary = (droppedTurns: AIMessage[][]): string => {
  const sampledTurns = droppedTurns.slice(-8);
  const lines = sampledTurns.map((turn, idx) => {
    const user = turn.find((m) => m.role === "user")?.content || "";
    const assistant = turn.find((m) => m.role === "assistant")?.content || "";
    return `${idx + 1}. U: ${truncateText(user, 80)} | A: ${truncateText(assistant, 80)}`;
  });
  let summary = [
    `Earlier conversation summary (${droppedTurns.length} older turn(s) compressed):`,
    ...lines,
    "Use this only as background. Prioritize the latest user request.",
  ].join("\n");
  if (summary.length > HISTORY_SUMMARY_MAX_CHARS) {
    summary = truncateText(summary, HISTORY_SUMMARY_MAX_CHARS);
  }
  return summary;
};

export const prepareHistoryForRequest = (
  history: AIMessage[],
  input: string,
  maxTurns: number,
): AIMessage[] => {
  if (maxTurns <= 0) return [];
  const turns = buildTurnsFromHistory(history);
  if (!turns.length) return [];

  const alwaysCarry = turns.slice(-Math.min(MIN_ALWAYS_CARRY_TURNS, maxTurns));
  const olderTurns = turns.slice(0, Math.max(0, turns.length - MIN_ALWAYS_CARRY_TURNS));

  const carryOlderTurns = olderTurns.length > 0 && shouldCarryRecentTurns(input, olderTurns);

  if (!carryOlderTurns) {
    return flattenTurns(alwaysCarry);
  }

  const olderBudget = Math.max(0, maxTurns - alwaysCarry.length);
  const boundedOlder = olderTurns.slice(-olderBudget);
  const droppedTurns = olderTurns.slice(0, Math.max(0, olderTurns.length - olderBudget));
  const prepared: AIMessage[] = [];

  if (droppedTurns.length > 0) {
    prepared.push({
      role: "assistant",
      content: `[Conversation Summary]\n${buildDroppedTurnsSummary(droppedTurns)}`,
    });
  }
  prepared.push(...flattenTurns(boundedOlder));
  prepared.push(...flattenTurns(alwaysCarry));
  return prepared;
};
