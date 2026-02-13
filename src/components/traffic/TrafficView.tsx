import { AnimatePresence, motion } from "framer-motion";
import * as LucideIcons from "lucide-react";
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
  const { running, certTrusted, certWarningIgnored, setCertWarningIgnored } = useProxyStore();
  const { breakpoints } = useBreakpointStore();
  const { setActiveTab } = useUIStore();

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
  const [atBottom, setAtBottom] = useState(true);
  const [newRequestsCount, setNewRequestsCount] = useState(0);
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

  // Dynamic width calculation for ID column (based on indices count)
  const idColWidth = Math.max(20, (indices.length?.toString().length || 1) * 7 + 4);

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

  const [lastBaselineCount, setLastBaselineCount] = useState(filteredIndices.length);

  useEffect(() => {
    if (atBottom) {
      setLastBaselineCount(filteredIndices.length);
      setNewRequestsCount(0);
    } else {
      const diff = filteredIndices.length - lastBaselineCount;
      setNewRequestsCount(Math.max(0, diff));
    }
  }, [filteredIndices.length, atBottom, lastBaselineCount]);

  // Keyboard Navigation for sequential selection
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
        if (filteredIndices.length === 0) return;

        e.preventDefault();
        const currentIndex = selectedFlow
          ? filteredIndices.findIndex((idx) => idx.id === selectedFlow.id)
          : -1;

        let nextIndex = currentIndex;
        if (e.key === "ArrowDown") {
          nextIndex = currentIndex < filteredIndices.length - 1 ? currentIndex + 1 : currentIndex;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
        }

        if (nextIndex !== currentIndex && nextIndex >= 0) {
          const nextIdx = filteredIndices[nextIndex];
          selectFlow(nextIdx.id);

          // Scroll into view if needed
          virtuosoRef.current?.scrollToIndex({
            index: nextIndex,
            behavior: "auto",
            align: "center",
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredIndices, selectedFlow, selectFlow]);

  return (
    <div className="h-full flex flex-col">
      {!(certTrusted || certWarningIgnored) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
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
              <p className="text-[11px] text-amber-500/80 leading-tight mt-0.5">
                {t("traffic.security.untrusted_desc")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] px-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 border border-amber-500/30 font-bold"
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
                ) : !running ? (
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
                        <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground mt-1">
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
                              <span className="text-[11px] font-bold">
                                {t("traffic.setup.system")}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {t("traffic.setup.system_desc")}
                            </p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-left group hover:bg-muted/50 transition-all">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="p-1 bg-purple-500/10 rounded text-purple-500">
                                <QrCode className="w-3.5 h-3.5" />
                              </div>
                              <span className="text-[11px] font-bold">
                                {t("traffic.setup.mobile")}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {t("traffic.setup.mobile_desc")}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-4 pt-2">
                          <button
                            onClick={() => setIsGuideOpen(true)}
                            className="text-[11px] text-primary hover:underline flex items-center gap-1"
                          >
                            <Info className="w-3 h-3" />
                            {t("traffic.setup.guide")}
                          </button>
                          <button
                            onClick={() => {
                              useUIStore.getState().setSettingsTab("certificate");
                              setActiveTab("settings");
                            }}
                            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
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
                  followOutput={"auto"}
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
                <AnimatePresence>
                  {(!atBottom || (newRequestsCount > 0 && !atBottom)) && showJumpBubble && (
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
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/90 hover:bg-muted text-muted-foreground border border-white/5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all text-[11px] font-medium backdrop-blur-xl ring-1 ring-white/5"
                      >
                        {newRequestsCount > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <div className="px-1 min-w-[14px] h-3.5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[9px] font-bold">
                              {newRequestsCount > 99 ? "99+" : newRequestsCount}
                            </div>
                            <span>{t("traffic.new_requests", "New Requests")}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <LucideIcons.ChevronDown className="w-3 h-3 opacity-70" />
                            <span>{t("traffic.jump_to_latest", "Jump to Latest")}</span>
                          </div>
                        )}
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
