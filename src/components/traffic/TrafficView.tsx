import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Info,
  ListFilter,
  Lock,
  QrCode,
  Search,
  Terminal,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { matchFlow, parseFilter } from "../../lib/filterParser";
import { useBreakpointStore } from "../../stores/breakpointStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import type { FlowIndex } from "../../types";
import { Button } from "../common/Button";
import { ContextMenu } from "../common/ContextMenu";
import { EmptyState } from "../common/EmptyState";
import { SetupGuideModal } from "../layout/SetupGuideModal";
import { FilterBar } from "./FilterBar";
import { FlowDetail } from "./FlowDetail";
import { useTrafficContextMenu } from "./hooks/useTrafficContextMenu";
import { TrafficListItem } from "./TrafficListItem";

interface TrafficViewProps {
  onToggleProxy: () => void;
}

export function TrafficView({ onToggleProxy }: TrafficViewProps) {
  const { t } = useTranslation();
  const { indices, selectedFlow, selectFlow } = useTrafficStore();
  const { active, certTrusted, certWarningIgnored, setCertWarningIgnored } = useProxyStore();
  const { breakpoints } = useBreakpointStore();
  const { setActiveTab } = useUIStore();
  const { showSessionId, dbSessions } = useSessionStore();

  // Check if viewing historical session (not the one currently being written)
  // A session is historical if:
  // 1. Proxy is running and viewing a different session than the active one, OR
  // 2. Proxy is not running (all sessions are historical in this case)
  const isHistoricalSession = useMemo(() => {
    const activeSession = dbSessions.find((s) => s.is_active === 1);

    // If proxy is not running, all sessions are historical
    if (!active) {
      return true;
    }

    // If proxy is running, check if viewing a different session
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
  } = useTrafficContextMenu();

  // Local State
  const virtuosoRef = useRef<any>(null);
  const [autoScroll, setAutoScroll] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newRequestsCount, setNewRequestsCount] = useState(0);
  const [idColWidth, setIdColWidth] = useState(40); // Fixed base width to prevent layout shifts
  const [showJumpBubble, setShowJumpBubble] = useState(false);
  const bubbleTimeoutRef = useRef<any>(null);
  const [filterText, setFilterText] = useState("");
  const [debouncedFilterText, setDebouncedFilterText] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Debounce filter text for performance (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilterText(filterText);
    }, 300);
    return () => clearTimeout(timer);
  }, [filterText]);

  const handleScrollStateChange = (scrolling: boolean) => {
    if (scrolling) {
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
      setShowJumpBubble(true);
    } else {
      bubbleTimeoutRef.current = setTimeout(() => {
        setShowJumpBubble(false);
      }, 5000);
    }
  };

  // Use debounced filter text for actual filtering (performance optimization)
  const filterCriteria = useMemo(() => parseFilter(debouncedFilterText), [debouncedFilterText]);

  // Filter indices (lightweight) instead of full flows
  const filteredIndices = useMemo(() => {
    const sourceIndices = pausedIndices || indices;
    return sourceIndices.filter((idx) => {
      if (onlyMatched && (!idx.hits || idx.hits.length === 0)) return false;
      if (!debouncedFilterText) return true;
      // Match against index fields
      return matchFlow(idx, filterCriteria, isRegex, caseSensitive);
    });
  }, [
    pausedIndices,
    indices,
    onlyMatched,
    debouncedFilterText,
    filterCriteria,
    isRegex,
    caseSensitive,
  ]);

  const [lastBaselineCount, setLastBaselineCount] = useState(0);
  const prevSessionIdRef = useRef<string | null>(null);
  const prevIndicesLengthRef = useRef(0);

  // Handle new requests count based on scroll position and data changes
  useEffect(() => {
    // In historical session or auto-scroll mode, never show new requests count
    if (isHistoricalSession || autoScroll) {
      setNewRequestsCount(0);
      setLastBaselineCount(filteredIndices.length);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Session changed - reset everything
    if (prevSessionIdRef.current !== showSessionId) {
      prevSessionIdRef.current = showSessionId;
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Data was cleared (e.g., clearLocal was called)
    if (filteredIndices.length === 0 && prevIndicesLengthRef.current > 0) {
      setLastBaselineCount(0);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = 0;
      return;
    }

    // Data just loaded after clear
    if (filteredIndices.length > 0 && lastBaselineCount === 0) {
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
      prevIndicesLengthRef.current = filteredIndices.length;
      return;
    }

    // Normal operation: update bubble count based on scroll position
    if (atBottom) {
      // User is at bottom - update baseline to current and reset count
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
    } else {
      // User scrolled up - show difference from baseline
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

  // Use refs to mirror state for the stable keyboard listener.
  // This prevents the listener from re-binding on every traffic update.
  const filteredIndicesRef = useRef(filteredIndices);

  useEffect(() => {
    filteredIndicesRef.current = filteredIndices;
  }, [filteredIndices]);

  // Manual "Sticky" Auto-scroll logic:
  // We rely on native followOutput for persistent tracking.
  // This effector now ONLY handles the initial "docking" when toggling ON.
  // Note: We use a 100px threshold in the Virtuoso component below to account for
  // sub-pixel rendering jitter and dynamic layout shifts during high-traffic throughput.
  useEffect(() => {
    if (autoScroll && atBottom && filteredIndices.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: filteredIndices.length - 1,
        behavior: "auto",
        align: "end",
      });
    }
  }, [autoScroll, atBottom, filteredIndices.length]);

  // Adjust ID column width based on digit count magnitude to minimize layout shifts.
  // Instead of exact calculation, we jump in larger steps (e.g., 40px, 50px, 60px).
  useEffect(() => {
    const maxId = filteredIndices.length;
    const digits = maxId.toString().length;
    const newWidth = Math.max(32, digits * 10 + 4);
    if (Math.abs(newWidth - idColWidth) > 8) {
      // Only update if magnitude changes significantly
      setIdColWidth(newWidth);
    }
  }, [filteredIndices.length, idColWidth]);

  // Keyboard Navigation for sequential selection (Zero-Latency Version)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in inputs
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
        // Direct access to store state ensures zero latency and perfect synchronization
        // even during high-frequency traffic updates.
        const store = useTrafficStore.getState();
        const { selectedFlow: currentSelected } = store;

        // Use the debounced/filtered logic if applicable, or fallback to current state indices
        // In TrafficView, filteredIndices is derived, so we should actually use the same logic
        // if we want to bypass React rendering cycle, but for now we'll use the refs
        // or just rely on the fact that this listener is stable.
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

          // Atomic coordination: scroll immediately
          requestAnimationFrame(() => {
            // scrollIntoView is more elegant than scrollToIndex as it only moves the view
            // if the item is not already fully visible, and doesn't force a specific alignment.
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

  return (
    <div className="h-full flex flex-col">
      {!(certTrusted || certWarningIgnored) && (
        <motion.div
          initial={false}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between group overflow-hidden"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-500 leading-tight">
                {t("traffic.security.untrusted_title")}
              </p>
              <p className="text-ui text-amber-500/80 leading-tight mt-0.5">
                {t("traffic.security.untrusted_desc")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-ui px-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border border-amber-500/30 font-bold"
              onClick={() => {
                useUIStore.getState().setSettingsTab("certificate");
                setActiveTab("settings");
              }}
            >
              {t("traffic.security.fix_now")}
            </Button>
            <button
              onClick={() => setCertWarningIgnored(true)}
              className="p-1 hover:bg-amber-500/10 rounded-md text-amber-500/40 hover:text-amber-500 transition-colors"
              title={t("common.dismiss", "Dismiss")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
      <div className="h-full flex flex-1 overflow-hidden">
        {/* Traffic List */}
        <div className="flex-1 border-r border-border flex flex-col bg-muted/5 min-w-0">
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
                {indices.length > 0 ? (
                  <EmptyState
                    icon={Search}
                    title={t("traffic.empty_search")}
                    description={
                      <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
                        {t("traffic.filter.current")}
                        {filterText && (
                          <span className="font-mono text-primary/80 bg-primary/5 px-1.5 py-0.5 rounded">
                            {filterText}
                          </span>
                        )}
                        {onlyMatched && (
                          <span className="font-bold text-purple-500/80 bg-purple-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <ListFilter className="w-3 h-3" />
                            {t("traffic.filter.matched_tooltip")}
                          </span>
                        )}
                      </div>
                    }
                    action={{
                      label: t("common.clear_filter"),
                      onClick: () => {
                        setFilterText("");
                        setOnlyMatched(false);
                      },
                    }}
                    animation="pulse"
                  />
                ) : !active ? (
                  <EmptyState
                    icon={Activity}
                    title={t("traffic.proxy_stopped")}
                    description={t("traffic.start_hint")}
                    action={{
                      label: t("traffic.start_proxy"),
                      onClick: onToggleProxy,
                      icon: Wifi,
                    }}
                    animation="pulse"
                    className="py-12"
                  />
                ) : (
                  <EmptyState
                    icon={Wifi}
                    title={t("traffic.listening")}
                    description={
                      <div className="space-y-6">
                        <div className="flex items-center justify-center gap-2 text-ui text-muted-foreground mt-1">
                          <span className="px-1.5 py-0.5 bg-muted rounded border border-border/50 font-mono">
                            127.0.0.1:9090
                          </span>
                          <span>•</span>
                          <span className="text-primary font-medium">
                            {t("traffic.server_status")}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/40">
                          <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-left group hover:bg-muted/50 transition-all">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="p-1 bg-blue-500/10 rounded text-blue-500">
                                <Terminal className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-ui font-bold">{t("traffic.setup.system")}</span>
                            </div>
                            <p className="text-ui text-muted-foreground leading-relaxed">
                              {t("traffic.setup.system_desc")}
                            </p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-left group hover:bg-muted/50 transition-all">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="p-1 bg-purple-500/10 rounded text-purple-500">
                                <QrCode className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-ui font-bold">{t("traffic.setup.mobile")}</span>
                            </div>
                            <p className="text-ui text-muted-foreground leading-relaxed">
                              {t("traffic.setup.mobile_desc")}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-4 pt-2">
                          <button
                            onClick={() => setIsGuideOpen(true)}
                            className="text-ui text-primary hover:underline flex items-center gap-1"
                          >
                            <Info className="w-3 h-3" />
                            {t("traffic.setup.guide")}
                          </button>
                          <button
                            onClick={() => {
                              useUIStore.getState().setSettingsTab("certificate");
                              setActiveTab("settings");
                            }}
                            className="text-ui text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <Lock className="w-3 h-3" />
                            {t("traffic.setup.cert")}
                          </button>
                        </div>
                      </div>
                    }
                    animation="radar"
                  />
                )}
              </div>
            ) : (
              <>
                <Virtuoso
                  ref={virtuosoRef}
                  data={filteredIndices}
                  style={{ height: "100%" }}
                  // Crucial: use a unique key for each item so Virtuoso can track
                  // their positions accurately even as the list grows rapidly.
                  computeItemKey={(_, item) => item.id}
                  // Increase buffer to stabilize height calculations during high traffic
                  // and reduce blank space during fast scrolling
                  increaseViewportBy={{ top: 500, bottom: 500 }}
                  // Relax the threshold for "at bottom" significantly to ensure stickiness.
                  atBottomThreshold={100}
                  // Native followOutput={true} handles "if at bottom, stay at bottom".
                  followOutput={autoScroll}
                  atBottomStateChange={setAtBottom}
                  isScrolling={handleScrollStateChange}
                  itemContent={(index: number, idx: FlowIndex) => (
                    <TrafficListItem
                      key={idx.id}
                      index={idx}
                      seq={index + 1}
                      isSelected={selectedFlow?.id === idx.id}
                      idColWidth={idColWidth}
                      breakpoints={breakpoints}
                      onSelect={(i) => selectFlow(i.id)}
                      onContextMenu={handleContextMenu}
                    />
                  )}
                />

                {/* Jump to Bottom Bubble */}
                {/* Rules:
                    - Historical session: NEVER show (no new data coming in)
                    - Active session with auto-scroll ON: NEVER show (already tracking latest)
                    - Active session with auto-scroll OFF: show when scrolled up AND there are new requests
                */}
                <AnimatePresence>
                  {!(isHistoricalSession || autoScroll || atBottom) &&
                    newRequestsCount > 0 &&
                    showJumpBubble && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 4 }}
                        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
                      >
                        <button
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
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/90 hover:bg-muted text-muted-foreground border border-white/5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all text-ui font-medium backdrop-blur-xl ring-1 ring-white/5"
                        >
                          <div className="flex items-center gap-1.5">
                            <div className="px-1 min-w-[14px] h-3.5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                              {newRequestsCount > 99 ? "99+" : newRequestsCount}
                            </div>
                            <span>{t("traffic.new_requests", "New Requests")}</span>
                          </div>
                        </button>
                      </motion.div>
                    )}
                </AnimatePresence>
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
    </div>
  );
}
