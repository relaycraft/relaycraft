import { useEffect, useMemo, useRef, useState } from "react";
import { fetchSseEvents } from "../../../lib/traffic";
import type { SseEvent } from "../../../types";

const SSE_MAX_STORED_EVENTS = 2000;

interface UseSSEPanelOptions {
  flowId: string;
  isSse: boolean;
  initialEvents?: SseEvent[];
  initialStreamOpen?: boolean;
  autoRefresh: boolean;
  keywordFilter: string;
}

export function useSSEPanel({
  flowId,
  isSse,
  initialEvents = [],
  initialStreamOpen = false,
  autoRefresh,
  keywordFilter,
}: UseSSEPanelOptions) {
  const [sseEvents, setSseEvents] = useState<SseEvent[]>([]);
  const [sseStreamOpen, setSseStreamOpen] = useState<boolean>(initialStreamOpen);
  const [sseDroppedCount, setSseDroppedCount] = useState<number>(0);
  const sseNextSeqRef = useRef(0);

  useEffect(() => {
    const nextSeq = initialEvents.length > 0 ? initialEvents[initialEvents.length - 1].seq + 1 : 0;
    sseNextSeqRef.current = nextSeq;
    setSseEvents(initialEvents);
    setSseDroppedCount(0);
    setSseStreamOpen(!!initialStreamOpen);
  }, [initialEvents, initialStreamOpen]);

  useEffect(() => {
    if (!isSse) return;
    setSseStreamOpen(!!initialStreamOpen);
  }, [initialStreamOpen, isSse]);

  useEffect(() => {
    if (!isSse) return;
    if (!autoRefresh) return;

    let cancelled = false;
    const poll = async () => {
      const data = await fetchSseEvents(flowId, sseNextSeqRef.current, 200);
      if (!data || cancelled) return;

      sseNextSeqRef.current = data.nextSeq;
      setSseStreamOpen(!!data.streamOpen);
      setSseDroppedCount(data.droppedCount || 0);
      if (data.events && data.events.length > 0) {
        setSseEvents((prev) => [...prev, ...data.events].slice(-SSE_MAX_STORED_EVENTS));
      }
    };

    poll().catch(() => undefined);
    const timer = window.setInterval(() => {
      poll().catch(() => undefined);
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flowId, isSse, autoRefresh]);

  const filteredSseEvents = useMemo(() => {
    const keyword = keywordFilter.trim().toLowerCase();
    if (!keyword) return sseEvents;
    return sseEvents.filter((evt) => evt.data.toLowerCase().includes(keyword));
  }, [sseEvents, keywordFilter]);

  return {
    sseEvents,
    sseStreamOpen,
    sseDroppedCount,
    filteredSseEvents,
  };
}
