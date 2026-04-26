import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { matchFlow, parseFilter } from "../../lib/filterParser";
import { searchFlowContent } from "../../lib/traffic";
import { useProxyStore } from "../../stores/proxyStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import type { FlowIndex } from "../../types";
import { ContextMenu } from "../common/ContextMenu";
import { SetupGuideModal } from "../layout/SetupGuideModal";
import { AddBreakpointModal } from "./AddBreakpointModal";
import { CertificateWarningBanner } from "./CertificateWarningBanner";
import { FilterBar } from "./FilterBar";
import { FlowDetail } from "./FlowDetail";
import { useTrafficContextMenu } from "./hooks/useTrafficContextMenu";
import { JumpToBottomBubble } from "./JumpToBottomBubble";
import { TrafficEmptyStates } from "./TrafficEmptyStates";
import { TrafficListItem } from "./TrafficListItem";

interface TrafficViewProps {
  onToggleProxy: () => void;
  loading?: boolean;
}

export function TrafficView({ onToggleProxy, loading }: TrafficViewProps) {
  const { t } = useTranslation();
  const indices = useTrafficStore((state) => state.indices);
  const selectedFlow = useTrafficStore((state) => state.selectedFlow);
  const selectFlow = useTrafficStore((state) => state.selectFlow);
  const active = useProxyStore((state) => state.active);
  const port = useProxyStore((state) => state.port);
  const certTrusted = useProxyStore((state) => state.certTrusted);
  const certWarningIgnored = useProxyStore((state) => state.certWarningIgnored);
  const setCertWarningIgnored = useProxyStore((state) => state.setCertWarningIgnored);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const displayDensity = useSettingsStore((state) => state.config.display_density);
  const showSessionId = useSessionStore((state) => state.showSessionId);
  const dbSessions = useSessionStore((state) => state.dbSessions);

  // Keep virtualized row height aligned with actual row layout per density mode.
  const trafficRowHeight = useMemo(() => {
    switch (displayDensity) {
      case "compact":
        return 48;
      case "relaxed":
        return 60;
      default:
        return 54;
    }
  }, [displayDensity]);

  const trafficViewportBuffer = useMemo(() => {
    switch (displayDensity) {
      case "compact":
        return { top: 420, bottom: 700 };
      case "relaxed":
        return { top: 620, bottom: 980 };
      default:
        return { top: 500, bottom: 800 };
    }
  }, [displayDensity]);

  // Check if viewing historical session
  const isHistoricalSession = useMemo(() => {
    const activeSession = dbSessions.find((s) => s.is_active === 1);

    // All sessions are historical if proxy is stopped
    if (!active) {
      return true;
    }

    // Check if viewing a different session if proxy is running
    return activeSession && showSessionId && activeSession.id !== showSessionId;
  }, [active, dbSessions, showSessionId]);

  // Custom Hooks
  const {
    menuVisible,
    menuPosition,
    contextMenuItems,
    handleContextMenu,
    handleCloseMenu,
    pausedIndices,
    breakpointModal,
    closeBreakpointModal,
  } = useTrafficContextMenu();

  // Local State
  const virtuosoRef = useRef<any>(null);
  const [autoScroll, setAutoScroll] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [idColWidth, setIdColWidth] = useState(40); // Fixed base width to prevent layout shifts
  const [showJumpBubble, setShowJumpBubble] = useState(false);
  const bubbleTimeoutRef = useRef<any>(null);
  const scrollActiveRef = useRef(false);
  const filterText = useTrafficStore((state) => state.filterText);
  const setFilterText = useTrafficStore((state) => state.setFilterText);
  const [debouncedFilterText, setDebouncedFilterText] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Debounce filter text (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilterText(filterText);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterText]);

  const handleScrollStateChange = (scrolling: boolean) => {
    if (scrolling) {
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
      if (!scrollActiveRef.current) {
        scrollActiveRef.current = true;
        setShowJumpBubble(true);
      }
    } else {
      scrollActiveRef.current = false;
      bubbleTimeoutRef.current = setTimeout(() => {
        setShowJumpBubble(false);
      }, 5000);
    }
  };

  // Use debounced filter text
  const filterCriteria = useMemo(() => parseFilter(debouncedFilterText), [debouncedFilterText]);

  // Deep search state — backend API results for body/header criteria
  const [deepMatchIds, setDeepMatchIds] = useState<Set<string> | null>(null);
  const [deepSearching, setDeepSearching] = useState(false);

  // Trigger backend deep search when body or header criteria change
  useEffect(() => {
    const resTerms = filterCriteria.body;
    const reqTerms = filterCriteria.reqbody;
    const headerTerms = filterCriteria.header;
    if (resTerms.length === 0 && reqTerms.length === 0 && headerTerms.length === 0) {
      setDeepMatchIds(null);
      return;
    }

    let cancelled = false;
    setDeepSearching(true);

    const run = async () => {
      try {
        const ids = new Set<string>();
        const tasks: Promise<void>[] = [];
        for (const term of resTerms) {
          tasks.push(
            searchFlowContent(term.value, "response", showSessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        for (const term of reqTerms) {
          tasks.push(
            searchFlowContent(term.value, "request", showSessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        for (const term of headerTerms) {
          tasks.push(
            searchFlowContent(term.value, "header", showSessionId).then(({ matches }) => {
              if (!cancelled) for (const id of matches) ids.add(id);
            }),
          );
        }
        await Promise.all(tasks);
        if (!cancelled) setDeepMatchIds(ids);
      } catch (_e) {
        if (!cancelled) setDeepMatchIds(new Set());
      } finally {
        if (!cancelled) setDeepSearching(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [filterCriteria.body, filterCriteria.reqbody, filterCriteria.header, showSessionId]);

  // filterCriteria without deep-search fields — those are handled by deepMatchIds
  const filterCriteriaNoDeep = useMemo(
    () => ({ ...filterCriteria, body: [], reqbody: [], header: [] }),
    [filterCriteria],
  );

  // Filter indices instead of full flows
  const filteredIndices = useMemo(() => {
    const sourceIndices = pausedIndices || indices;
    return sourceIndices.filter((idx) => {
      if (onlyMatched && (!idx.hits || idx.hits.length === 0)) return false;
      if (!debouncedFilterText) return true;
      // Deep search: require flow to be in backend match set (null = no deep filter active)
      if (deepMatchIds !== null && !deepMatchIds.has(idx.id)) return false;
      // Match index fields — body/header criteria stripped (handled by deepMatchIds)
      return matchFlow(idx, filterCriteriaNoDeep, isRegex, caseSensitive);
    });
  }, [
    pausedIndices,
    indices,
    onlyMatched,
    debouncedFilterText,
    filterCriteriaNoDeep,
    isRegex,
    caseSensitive,
    deepMatchIds,
  ]);

  const [lastBaselineCount, setLastBaselineCount] = useState(0);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIndicesLengthRef = useRef(0);

  // Handle new requests count
  useEffect(() => {
    // Hide new requests count in historical or auto-scroll mode
    if (isHistoricalSession || autoScroll) {
      setNewRequestsCount(0);
      setLastBaselineCount(filteredIndices.length);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Reset on session change
    if (prevSessionIdRef.current !== showSessionId) {
      prevSessionIdRef.current = showSessionId;
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Handle cleared data
    if (filteredIndices.length === 0 && prevIndicesLengthRef.current > 0) {
      setLastBaselineCount(0);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = 0;
      return;
    }

    // Handle data load after clear
    if (filteredIndices.length > 0 && lastBaselineCount === 0) {
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Update bubble count based on scroll position
    if (atBottom) {
      // Update baseline and reset count if at bottom
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
    } else {
      // Show difference from baseline if scrolled up
      const diff = filteredIndices.length - lastBaselineCount;
      setNewRequestsCount(Math.max(0, diff));
    }

    prevIndicesLengthRef.current = filteredIndices.length;
  }, [
    filteredIndices.length,
    atBottom,
    autoScroll,
    lastBaselineCount,
    isHistoricalSession,
    showSessionId,
  ]);

  // Mirror state for stable keyboard listener
  const filteredIndicesRef = useRef(filteredIndices);

  useEffect(() => {
    filteredIndicesRef.current = filteredIndices;
  }, [filteredIndices]);

  // Manual "Sticky" Auto-scroll logic (initial docking)
  useEffect(() => {
    if (autoScroll && atBottom && filteredIndices.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: filteredIndices.length - 1,
        behavior: "auto",
        align: "end",
      });
    }
  }, [autoScroll, atBottom, filteredIndices.length]);

  // Adjust ID column width based on digit magnitude
  useEffect(() => {
    const maxId = filteredIndices.length;
    const digits = maxId.toString().length;
    const newWidth = Math.max(32, digits * 10 + 4);
    if (Math.abs(newWidth - idColWidth) > 8) {
      // Update if magnitude changes significantly
      setIdColWidth(newWidth);
    }
  }, [filteredIndices.length, idColWidth]);

  // Sequential keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // Direct store access for zero latency
        const store = useTrafficStore.getState();
        const { selectedFlow: currentSelected } = store;

        // Use debounced logic or fallback to current state indices
        const currentFiltered = filteredIndicesRef.current;

        if (currentFiltered.length === 0) return;

        e.preventDefault();
        const currentIndex = currentSelected
          ? currentFiltered.findIndex((idx: FlowIndex) => idx.id === currentSelected.id)
          : -1;

        let nextIndex = currentIndex;
        if (e.key === "ArrowDown") {
          nextIndex = currentIndex < currentFiltered.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }

        if (nextIndex !== currentIndex && nextIndex >= 0) {
          const nextIdx = currentFiltered[nextIndex];
          store.selectFlow(nextIdx.id);

          // Scroll immediately
          requestAnimationFrame(() => {
            // Use scrollIntoView to move view seamlessly
            virtuosoRef.current?.scrollIntoView({
              index: nextIndex,
            });
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []); // Empty dependency array ensures this listener is bound only once

  // Prevent list item re-renders
  const handleSelect = useCallback(
    (idx: FlowIndex) => {
      selectFlow(idx.id);
    },
    [selectFlow],
  );

  const virtuosoItemContent = useCallback(
    (index: number, idx: FlowIndex) => (
      <TrafficListItem
        index={idx}
        seq={index + 1}
        isSelected={selectedFlow?.id === idx.id}
        idColWidth={idColWidth}
        rowHeight={trafficRowHeight}
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
      />
    ),
    [selectedFlow?.id, idColWidth, trafficRowHeight, handleSelect, handleContextMenu],
  );

  return (
    <div className="h-full flex flex-col">
      <CertificateWarningBanner
        visible={!(certTrusted || certWarningIgnored)}
        t={t}
        onFixNow={() => {
          useUIStore.getState().setSettingsTab("certificate");
          setActiveTab("settings");
        }}
        onDismiss={() => setCertWarningIgnored(true)}
      />
      <div className="h-full flex flex-1 overflow-hidden">
        {/* Traffic List */}
        <div className="flex-1 border-r border-border flex flex-col bg-muted/30 min-w-0">
          <FilterBar
            filterText={filterText}
            setFilterText={setFilterText}
            isRegex={isRegex}
            setIsRegex={setIsRegex}
            caseSensitive={caseSensitive}
            setCaseSensitive={setCaseSensitive}
            onlyMatched={onlyMatched}
            setOnlyMatched={setOnlyMatched}
            filteredCount={filteredIndices.length}
            totalCount={indices.length}
            autoScroll={autoScroll}
            bodySearching={deepSearching}
            onToggleAutoScroll={() => {
              const nextValue = !autoScroll;
              setAutoScroll(nextValue);
              if (nextValue && filteredIndices.length > 0) {
                virtuosoRef.current?.scrollToIndex({
                  index: filteredIndices.length - 1,
                  behavior: "auto",
                  align: "end",
                });
              }
            }}
          />

          <div className="flex-1 relative flex flex-col min-h-0 z-0">
            {filteredIndices.length === 0 ? (
              <div className="flex-1">
                <TrafficEmptyStates
                  t={t}
                  hasAnyIndices={indices.length > 0}
                  filterText={filterText}
                  onlyMatched={onlyMatched}
                  active={active}
                  port={port}
                  loading={loading}
                  onClearFilter={() => {
                    setFilterText("");
                    setOnlyMatched(false);
                  }}
                  onToggleProxy={onToggleProxy}
                  onOpenGuide={() => setIsGuideOpen(true)}
                  onOpenCertificateSettings={() => {
                    useUIStore.getState().setSettingsTab("certificate");
                    setActiveTab("settings");
                  }}
                />
              </div>
            ) : (
              <>
                <Virtuoso
                  ref={virtuosoRef}
                  data={filteredIndices}
                  style={{ height: "100%" }}
                  computeItemKey={(_, item) => item.id}
                  fixedItemHeight={trafficRowHeight}
                  increaseViewportBy={trafficViewportBuffer}
                  atBottomThreshold={100}
                  followOutput={autoScroll}
                  atBottomStateChange={setAtBottom}
                  isScrolling={handleScrollStateChange}
                  itemContent={virtuosoItemContent}
                />

                <JumpToBottomBubble
                  visible={
                    !(isHistoricalSession || autoScroll || atBottom) &&
                    newRequestsCount > 0 &&
                    showJumpBubble
                  }
                  newRequestsCount={newRequestsCount}
                  t={t}
                  onClick={() => {
                    virtuosoRef.current?.scrollToIndex({
                      index: filteredIndices.length - 1,
                      behavior: "smooth",
                    });
                    setAtBottom(true);
                    setNewRequestsCount(0);
                    setShowJumpBubble(false);
                    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
                  }}
                />
              </>
            )}
          </div>
        </div>

        <AnimatePresence>
          {selectedFlow && (
            <motion.div
              key="flow-detail-drawer"
              initial={{ width: 0, minWidth: 0, opacity: 0 }}
              animate={{ width: "50%", minWidth: 450, opacity: 1 }}
              exit={{ width: 0, minWidth: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden bg-background border-l border-border shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.2)] flex flex-col max-w-[1200px] will-change-[width,min-width,opacity]"
            >
              <FlowDetail
                key={selectedFlow.id}
                flow={selectedFlow}
                onClose={() => selectFlow(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ContextMenu
        visible={menuVisible}
        x={menuPosition.x}
        y={menuPosition.y}
        items={contextMenuItems}
        onClose={handleCloseMenu}
      />
      <SetupGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />

      {/* Add Breakpoint Modal */}
      <AddBreakpointModal
        isOpen={breakpointModal.isOpen}
        onClose={closeBreakpointModal}
        initialUrl={breakpointModal.url}
        initialMethod={breakpointModal.method}
      />
    </div>
  );
}
