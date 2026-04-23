import type { Rule } from "../../types/rules";

function assignWindowPriorities(
  count: number,
  lowerBound?: number,
  upperBound?: number,
): number[] | null {
  if (count <= 0) return [];

  if (lowerBound !== undefined && upperBound !== undefined) {
    const available = upperBound - lowerBound - 1;
    if (available < count) return null;
    return Array.from({ length: count }, (_, index) => lowerBound + index + 1);
  }

  if (lowerBound !== undefined) {
    return Array.from({ length: count }, (_, index) => lowerBound + index + 1);
  }

  if (upperBound !== undefined) {
    const start = upperBound - count;
    return Array.from({ length: count }, (_, index) => start + index);
  }

  return Array.from({ length: count }, (_, index) => index + 1);
}

export function compareRulesByExecutionOrder(a: Rule, b: Rule) {
  if (a.execution.priority !== b.execution.priority) {
    return a.execution.priority - b.execution.priority;
  }
  if (a.name !== b.name) {
    return a.name.localeCompare(b.name);
  }
  return a.id.localeCompare(b.id);
}

export function sortRulesByExecutionOrder(rules: Rule[]) {
  return [...rules].sort(compareRulesByExecutionOrder);
}

export function computeMoveWindow(
  orderedRules: Rule[],
  fromIndex: number,
  toIndex: number,
): { start: number; end: number; priorities: number[] } {
  const reordered = [...orderedRules];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  let start = Math.min(fromIndex, toIndex);
  let end = Math.max(fromIndex, toIndex);

  while (true) {
    while (
      start > 0 &&
      reordered[start - 1].execution.priority === reordered[start].execution.priority
    ) {
      start -= 1;
    }
    while (
      end < reordered.length - 1 &&
      reordered[end + 1].execution.priority === reordered[end].execution.priority
    ) {
      end += 1;
    }

    const lowerBound = start > 0 ? reordered[start - 1].execution.priority : undefined;
    const upperBound =
      end < reordered.length - 1 ? reordered[end + 1].execution.priority : undefined;
    const priorities = assignWindowPriorities(end - start + 1, lowerBound, upperBound);

    if (priorities) {
      return { start, end, priorities };
    }

    if (start > 0) {
      start -= 1;
      continue;
    }
    if (end < reordered.length - 1) {
      end += 1;
      continue;
    }

    return {
      start: 0,
      end: reordered.length - 1,
      priorities: Array.from({ length: reordered.length }, (_, index) => index + 1),
    };
  }
}
