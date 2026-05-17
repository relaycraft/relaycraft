import { useEffect, useMemo, useState } from "react";
import { matchFlow, parseFilter } from "../../../lib/filterParser";
import { searchFlowContent } from "../../../lib/traffic";
import type { FlowIndex } from "../../../types";

interface UseTrafficSearchOptions {
  indices: FlowIndex[];
  pausedIndices?: FlowIndex[] | null;
  filterText: string;
  onlyMatched: boolean;
  isRegex: boolean;
  caseSensitive: boolean;
  sessionId: string | null;
}

interface UseTrafficSearchResult {
  filteredIndices: FlowIndex[];
  bodySearching: boolean;
}

export function useTrafficSearch({
  indices,
  pausedIndices,
  filterText,
  onlyMatched,
  isRegex,
  caseSensitive,
  sessionId,
}: UseTrafficSearchOptions): UseTrafficSearchResult {
  const filterCriteria = useMemo(() => parseFilter(filterText), [filterText]);
  const [deepMatchIds, setDeepMatchIds] = useState<Set<string> | null>(null);
  const [bodySearching, setBodySearching] = useState(false);

  useEffect(() => {
    const resTerms = filterCriteria.body;
    const reqTerms = filterCriteria.reqbody;
    const headerTerms = filterCriteria.header;
    if (resTerms.length === 0 && reqTerms.length === 0 && headerTerms.length === 0) {
      setDeepMatchIds(null);
      return;
    }

    let cancelled = false;
    setBodySearching(true);

    const run = async () => {
      try {
        const ids = new Set<string>();
        const tasks: Promise<void>[] = [];
        for (const term of resTerms) {
          tasks.push(
            searchFlowContent(term.value, "response", sessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        for (const term of reqTerms) {
          tasks.push(
            searchFlowContent(term.value, "request", sessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        for (const term of headerTerms) {
          tasks.push(
            searchFlowContent(term.value, "header", sessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        await Promise.all(tasks);
        if (!cancelled) setDeepMatchIds(ids);
      } catch (_e) {
        if (!cancelled) setDeepMatchIds(new Set());
      } finally {
        if (!cancelled) setBodySearching(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [filterCriteria.body, filterCriteria.reqbody, filterCriteria.header, sessionId]);

  const filterCriteriaNoDeep = useMemo(
    () => ({ ...filterCriteria, body: [], reqbody: [], header: [] }),
    [filterCriteria],
  );

  const filteredIndices = useMemo(() => {
    const sourceIndices = pausedIndices || indices;
    return sourceIndices.filter((idx) => {
      if (onlyMatched && (!idx.hits || idx.hits.length === 0)) return false;
      if (!filterText) return true;
      if (deepMatchIds !== null && !deepMatchIds.has(idx.id)) return false;
      return matchFlow(idx, filterCriteriaNoDeep, isRegex, caseSensitive);
    });
  }, [
    pausedIndices,
    indices,
    onlyMatched,
    filterText,
    filterCriteriaNoDeep,
    isRegex,
    caseSensitive,
    deepMatchIds,
  ]);

  return { filteredIndices, bodySearching };
}
