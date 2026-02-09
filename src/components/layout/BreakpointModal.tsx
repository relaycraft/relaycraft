import {
  AlertOctagon,
  ArrowRightLeft,
  CheckCircle2,
  Globe,
  Hash,
  Layers,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Flow } from "../../types";
import { HeaderListEditor } from "../composer/HeaderListEditor";

interface BreakpointModalProps {
  flows: Flow[];
  onClose: () => void;
  onResume: (flowId: string, modifications: any) => void;
}

export function BreakpointModal({ flows, onClose, onResume }: BreakpointModalProps) {
  const { t } = useTranslation();
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(flows[0]?.id || null);

  // Find current active flow from the list
  const flow = flows.find((f) => f.id === selectedFlowId) || flows[0];

  // Local state for the CURRENTLY SELECTED flow's modifications
  const [headers, setHeaders] = useState<any[]>([]);
  const [body, setBody] = useState("");
  const [statusCode, setStatusCode] = useState(200);

  const isRequest = flow?.interceptPhase === "request";

  // Sync state when selection changes
  useEffect(() => {
    if (!flow) return;

    const sourceHeaders = isRequest ? flow.requestHeaders : flow.responseHeaders || {};
    setHeaders(
      Object.entries(sourceHeaders).map(([key, value]) => ({
        key,
        value,
        enabled: true,
      })),
    );
    setBody((isRequest ? flow.requestBody : flow.responseBody) || "");
    setStatusCode(flow.statusCode || 200);
  }, [
    flow?.id,
    isRequest,
    flow.requestBody,
    flow.requestHeaders,
    flow.responseBody,
    flow.responseHeaders,
    flow,
  ]);

  if (!flow) return null;

  const handleResume = (id: string, mods: any) => {
    // If we only have one flow left and we're resuming it, the modal will close via App.tsx
    // but we might want to automatically select the NEXT flow in the list if available
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/25 backdrop-blur-[1px] animate-in fade-in duration-300">
      <div className="bg-card w-full max-w-4xl h-[75vh] rounded-2xl border border-primary/20 shadow-2xl shadow-primary/10 overflow-hidden flex flex-col scale-in-center">
        {/* Master Header */}
        <div className="px-5 py-3.5 bg-primary/5 flex items-center justify-between border-b border-primary/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl text-primary shadow-sm ring-1 ring-primary/20">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-system font-bold text-foreground flex items-center gap-2">
                {t("breakpoint.control_center")}
                <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-[9px] rounded-full font-black">
                  {flows.length}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBatchAction("abort")}
              className="flex items-center gap-1.5 px-3 h-8 text-[11px] font-bold text-red-500 hover:bg-red-500/10 border border-red-500/10 rounded-lg transition-all"
            >
              <Trash2 className="w-3 h-3" />
              {t("breakpoint.abort_all")}
            </button>
            <button
              onClick={() => handleBatchAction("resume")}
              className="flex items-center gap-1.5 px-3 h-8 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-[11px] font-bold shadow-md shadow-primary/10 transition-all"
            >
              <CheckCircle2 className="w-3 h-3" />
              {t("breakpoint.resume_all")}
            </button>
            <div className="w-px h-5 bg-border mx-1" />
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Flow List */}
          <div className="w-56 border-r border-border bg-muted/5 flex flex-col overflow-hidden">
            <div className="p-2.5 border-b border-border bg-muted/10">
              <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest pl-1">
                {t("breakpoint.queue")}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 no-scrollbar">
              {flows.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFlowId(f.id)}
                  className={`w-full text-left p-2.5 rounded-xl transition-all group relative overflow-hidden ${
                    selectedFlowId === f.id
                      ? "bg-primary/10 border border-primary/20 shadow-sm"
                      : "hover:bg-muted/40 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm border ${
                        f.interceptPhase === "request"
                          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                          : "bg-green-500/10 text-green-600 border-green-500/20"
                      }`}
                    >
                      {f.method}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground/40">
                      #{f.id.slice(-4)}
                    </span>
                  </div>
                  <div
                    className={`text-[12px] font-mono truncate leading-tight ${selectedFlowId === f.id ? "text-primary font-bold" : "text-foreground/60 group-hover:text-foreground/80"}`}
                  >
                    {f.url}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Panel: Content Editor */}
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Subheader for current flow */}
            <div className="px-5 py-2.5 border-b border-border/40 flex items-center justify-between bg-muted/5">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="p-1 bg-amber-500/10 rounded-lg text-amber-600 shrink-0">
                  <AlertOctagon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border shrink-0 ${isRequest ? "bg-blue-500/10 text-blue-600 border-blue-500/20" : "bg-green-500/10 text-green-600 border-green-500/20"}`}
                    >
                      {isRequest ? t("breakpoint.request") : t("breakpoint.response")}
                    </span>
                    <span className="text-[11px] font-bold text-foreground/70 truncate font-mono">
                      {flow.url}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-4">
                <button
                  onClick={() => handleResume(flow.id, { action: "abort" })}
                  className="px-3 h-7 text-[10px] font-bold text-red-500 hover:bg-red-500/5 rounded-lg transition-all"
                >
                  {t("breakpoint.abort")}
                </button>
                <button
                  onClick={handleCurrentResume}
                  className="flex items-center gap-2 px-4 h-7 text-green-600 hover:bg-green-600/10 rounded-lg text-[10px] font-extrabold transition-all"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  {t("breakpoint.resume")}
                </button>
              </div>
            </div>

            {/* Scrolling Editor Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 pl-1">
                    <Globe className="w-3 h-3 text-primary" />
                    <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                      {t("breakpoint.method_protocol")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2 bg-muted/20 border border-border/40 rounded-xl font-mono text-[11px] font-bold">
                    <span className="text-primary">{flow.method}</span>
                    <span className="text-muted-foreground opacity-30">|</span>
                    <span className="text-foreground/60 uppercase">HTTP/1.1</span>
                  </div>
                </div>
                {!isRequest && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 pl-1">
                      <Hash className="w-3 h-3 text-primary" />
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                        {t("breakpoint.status_code")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-muted/20 border border-border/40 rounded-xl font-mono text-[11px] font-bold">
                      <input
                        type="number"
                        value={statusCode}
                        onChange={(e) => setStatusCode(parseInt(e.target.value, 10))}
                        className="bg-transparent w-full outline-none text-green-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 pl-1">
                  <ArrowRightLeft className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                    {t("breakpoint.headers")}
                  </span>
                </div>
                <div className="bg-muted/10 border border-border/40 rounded-xl p-3">
                  <HeaderListEditor headers={headers} onChange={setHeaders} />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 pl-1">
                  <Layers className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                    {t("breakpoint.body_content")}
                  </span>
                </div>
                <div className="bg-muted/10 border border-border/40 rounded-xl p-3">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full h-40 bg-transparent text-xs font-mono resize-y outline-none"
                    placeholder={t("common.no_content")}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
