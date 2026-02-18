import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  AlertOctagon,
  ArrowRightLeft,
  CheckCircle2,
  Hash,
  Layers,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Flow } from "../../types";
import type { HarHeader } from "../../types/flow";
import { Button } from "../common/Button";
import { HeaderListEditor } from "../composer/HeaderListEditor";

interface BreakpointModalProps {
  flows: Flow[];
  onClose: () => void;
  onResume: (flowId: string, modifications: any) => void;
}

// Animation variants
const backdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 350,
      damping: 28,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: 16,
    transition: { duration: 0.15 },
  },
};

export function BreakpointModal({ flows, onClose, onResume }: BreakpointModalProps) {
  const { t } = useTranslation();
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(flows[0]?.id || null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  // Find current active flow from the list
  const flow = flows.find((f) => f.id === selectedFlowId) || flows[0];

  // Local state for the CURRENTLY SELECTED flow's modifications
  const [headers, setHeaders] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [statusCode, setStatusCode] = useState(200);

  const isRequest = flow?._rc?.intercept?.phase === "request";

  // Mouse tracking for glow effect
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      setMousePosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };

    const handleMouseEnter = () => setIsHovering(true);
    const handleMouseLeave = () => setIsHovering(false);

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  // Sync state when selection changes
  useEffect(() => {
    if (!flow) return;

    const sourceHeaders: HarHeader[] = isRequest
      ? flow.request.headers
      : flow.response.headers || [];
    setHeaders(
      sourceHeaders.map((h) => ({
        key: h.name,
        value: h.value,
        enabled: true,
      })),
    );
    setBody((isRequest ? flow.request.postData?.text : flow.response.content.text) || "");
    setStatusCode(flow.response.status || 200);
  }, [
    flow?.id,
    isRequest,
    flow.request.postData?.text,
    flow.request.headers,
    flow.response.content.text,
    flow.response.headers,
    flow,
  ]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!flow) return null;

  const handleResume = (id: string, mods: any) => {
    const currentIndex = flows.findIndex((f) => f.id === id);
    if (flows.length > 1) {
      const nextFlow = flows[currentIndex + 1] || flows[currentIndex - 1];
      if (nextFlow) setSelectedFlowId(nextFlow.id);
    }
    onResume(id, mods);
  };

  const handleCurrentResume = () => {
    const headerMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key) headerMap[h.key] = h.value;
    });

    const modifications: any = {};
    if (isRequest) {
      modifications.requestHeaders = headerMap;
      modifications.requestBody = body;
    } else {
      modifications.responseHeaders = headerMap;
      modifications.responseBody = body;
      modifications.statusCode = statusCode;
    }

    handleResume(flow.id, modifications);
  };

  const handleBatchAction = (action: "resume" | "abort") => {
    flows.forEach((f) => {
      onResume(f.id, action === "abort" ? { action: "abort" } : {});
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      >
        <motion.div
          ref={cardRef}
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="relative w-full max-w-5xl h-[80vh] bg-background/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
          style={
            {
              "--mouse-x": `${mousePosition.x}px`,
              "--mouse-y": `${mousePosition.y}px`,
            } as React.CSSProperties
          }
        >
          {/* Glow Effect */}
          {isHovering && (
            <div
              className="pointer-events-none absolute inset-0 transition-opacity duration-300 z-0"
              style={{
                opacity: isHovering ? 0.5 : 0,
                background: `radial-gradient(280px circle at var(--mouse-x) var(--mouse-y), rgba(59, 130, 246, 0.15), transparent 70%)`,
              }}
            />
          )}

          {/* Header */}
          <div className="relative z-10 flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/5 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-primary/10 rounded-lg text-primary">
                <Layers className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-foreground/90 tracking-tight flex items-center gap-2">
                {t("breakpoint.control_center")}
                <span className="px-1.5 py-0.5 bg-primary/15 text-primary text-tiny rounded-md font-bold">
                  {flows.length}
                </span>
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="xs"
                onClick={() => handleBatchAction("abort")}
                className="gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {t("breakpoint.abort_all")}
              </Button>
              <Button size="xs" onClick={() => handleBatchAction("resume")} className="gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {t("breakpoint.resume_all")}
              </Button>
              <div className="w-px h-5 bg-border/60 mx-1" />
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground/60 hover:text-foreground rounded-lg transition-all hover:bg-muted/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex-1 flex overflow-hidden">
            {/* Left Sidebar: Flow List */}
            <div className="w-52 border-r border-border/40 bg-muted/5 flex flex-col overflow-hidden">
              <div className="px-3 py-2 border-b border-border/40 bg-muted/10">
                <span className="text-tiny font-bold text-muted-foreground uppercase tracking-wider">
                  {t("breakpoint.queue")}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                {flows.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFlowId(f.id)}
                    className={`w-full text-left p-2 rounded-lg transition-colors group relative ${
                      selectedFlowId === f.id
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted/40 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-tiny font-bold px-1.5 py-0.5 rounded border ${
                          f._rc?.intercept?.phase === "request"
                            ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                            : "bg-green-500/10 text-green-600 border-green-500/20"
                        }`}
                      >
                        {f.request.method}
                      </span>
                      <span className="text-tiny font-mono text-muted-foreground/40">
                        #{f.id.slice(-4)}
                      </span>
                    </div>
                    <div
                      className={`text-tiny font-mono truncate leading-tight ${
                        selectedFlowId === f.id
                          ? "text-primary font-medium"
                          : "text-foreground/60 group-hover:text-foreground/80"
                      }`}
                    >
                      {f.request.url}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Panel: Content Editor */}
            <div className="flex-1 flex flex-col overflow-hidden bg-background">
              {/* Subheader for current flow */}
              <div className="px-4 py-2 border-b border-border/40 flex items-center justify-between bg-muted/5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="p-1 bg-amber-500/10 rounded text-amber-600 shrink-0">
                    <AlertOctagon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-tiny font-bold uppercase tracking-wide border shrink-0 ${
                          isRequest
                            ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                            : "bg-green-500/10 text-green-600 border-green-500/20"
                        }`}
                      >
                        {isRequest ? t("breakpoint.request") : t("breakpoint.response")}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-tiny font-bold bg-primary/10 text-primary border border-primary/20 shrink-0">
                        {flow.request.method}
                      </span>
                      <span className="text-tiny font-mono text-muted-foreground/50 shrink-0">
                        {flow.request.httpVersion}
                      </span>
                      <span className="text-tiny font-medium text-foreground/60 truncate font-mono">
                        {flow.request.url}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 ml-3">
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => handleResume(flow.id, { action: "abort" })}
                  >
                    {t("breakpoint.abort")}
                  </Button>
                  <Button
                    size="xs"
                    onClick={handleCurrentResume}
                    className="gap-1.5 bg-green-600/15 text-green-600 border-green-600/20 hover:bg-green-600/25"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    {t("breakpoint.resume")}
                  </Button>
                </div>
              </div>

              {/* Scrolling Editor Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {/* Status Code Editor - Only for response */}
                {!isRequest && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-tiny font-medium text-muted-foreground shrink-0">
                      <Hash className="w-3 h-3 opacity-70" />
                      {t("breakpoint.status_code")}
                    </label>
                    <input
                      type="number"
                      value={statusCode}
                      onChange={(e) => setStatusCode(parseInt(e.target.value, 10) || 200)}
                      className="px-2 py-1 bg-muted/30 border border-border/50 rounded font-mono text-tiny font-medium text-green-600 w-20 outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-tiny font-medium text-muted-foreground">
                    <ArrowRightLeft className="w-3 h-3 opacity-70" />
                    {t("breakpoint.headers")}
                  </label>
                  <div className="bg-muted/20 border border-border/40 rounded-lg p-2.5">
                    <HeaderListEditor headers={headers} onChange={setHeaders} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-tiny font-medium text-muted-foreground">
                    <Layers className="w-3 h-3 opacity-70" />
                    {t("breakpoint.body_content")}
                  </label>
                  <div className="bg-muted/20 border border-border/40 rounded-lg p-2.5">
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="w-full h-36 bg-transparent text-xs font-mono resize-y outline-none placeholder:text-muted-foreground/30"
                      placeholder={t("common.no_content")}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
