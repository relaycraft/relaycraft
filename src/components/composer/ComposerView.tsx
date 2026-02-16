import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Code2, Download, Eraser, Globe, Loader2, Send, X, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatJson } from "../../lib/contentUtils";
import { parseCurl } from "../../lib/curlParser";
import { cn } from "../../lib/utils";
import { useComposerStore } from "../../stores/composerStore";
import { Button } from "../common/Button";
import { CopyButton } from "../common/CopyButton";
import { Editor } from "../common/Editor";
import { EmptyState } from "../common/EmptyState";
import { Input } from "../common/Input";
import { Select } from "../common/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../common/Tabs";
import { Textarea } from "../common/Textarea";
import { Tooltip } from "../common/Tooltip";
import { BodyFormEditor } from "./BodyFormEditor";
import { HeaderListEditor } from "./HeaderListEditor";

// Define the response type from the backend
interface ReplayResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function ComposerView() {
  const { t } = useTranslation();
  const {
    method,
    setMethod,
    url,
    setUrl,
    headers,
    setHeaders,
    body,
    setBody,
    bodyType,
    setBodyType,
    bodyFormData,
    setBodyFormData,
    lastResponse,
    setLastResponse,
    reset,
  } = useComposerStore();

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    type: "error";
    message: string;
  } | null>(null);
  const [curlInput, setCurlInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [showCurlModal, setShowCurlModal] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");

  const handleFormatJson = () => {
    if (!body.trim()) return;
    try {
      const parsed = JSON.parse(body);
      setBody(JSON.stringify(parsed, null, 2));
    } catch (_e) {
      // Handle error silently or show feedback
    }
  };

  const handleDownload = async () => {
    if (!lastResponse) return;
    try {
      const filePath = await save({
        defaultPath: "response.json",
        filters: [
          { name: "JSON", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (filePath) await writeTextFile(filePath, lastResponse.body);
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  };

  const handleSend = async () => {
    if (!url || sending) return;
    setSending(true);
    setResult(null);
    try {
      const headerMap: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.enabled && h.key) headerMap[h.key] = h.value;
      });

      // Add minimum delay to show feedback
      const [response] = await Promise.all([
        invoke<ReplayResponse>("replay_request", {
          req: { method, url, headers: headerMap, body: body || null },
        }),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);

      setLastResponse({
        status: response.status,
        headers: response.headers,
        body: response.body,
      });
    } catch (error: any) {
      const errorMsg = error.toString();
      // Match "builder error for url (URL)" - often from reqwest/rust backend
      // and "error sending request for url (URL)"
      const builderMatch = errorMsg.match(/builder error for url \((.+)\)/i);
      const sendingMatch = errorMsg.match(/error sending request for url \((.+)\)/i);

      let localizedMessage = errorMsg;

      if (builderMatch) {
        localizedMessage = t("composer.url_builder_error", {
          url: builderMatch[1],
        });
      } else if (sendingMatch) {
        localizedMessage = t("composer.error_sending_request", {
          url: sendingMatch[1],
        });
      } else if (errorMsg.toLowerCase().includes("builder error")) {
        localizedMessage = t("composer.generic_builder_error");
      }

      setResult({ type: "error", message: localizedMessage });
      setLastResponse(null);
    } finally {
      setSending(false);
    }
  };

  const handleParseCurl = () => {
    if (!curlInput.trim()) {
      setParseError(t("composer.curl_modal.error_empty"));
      return;
    }
    const parsed = parseCurl(curlInput);
    if (parsed) {
      setMethod(parsed.method);
      setUrl(parsed.url);
      setHeaders(
        Object.entries(parsed.headers).map(([key, value]) => ({
          key,
          value,
          enabled: true,
        })),
      );
      setBody(parsed.body || "");
      setShowCurlModal(false);
      setCurlInput("");
      setParseError(null);
    } else {
      setParseError(t("composer.curl_modal.error_format"));
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-green-500 bg-green-500/10 border-green-500/20";
    if (status >= 300 && status < 400) return "text-blue-500 bg-blue-500/10 border-blue-500/20";
    if (status >= 400 && status < 500)
      return "text-orange-500 bg-orange-500/10 border-orange-500/20";
    return "text-red-500 bg-red-500/10 border-red-500/20";
  };

  return (
    <div className="h-full flex flex-col bg-background/50 backdrop-blur-3xl overflow-hidden no-scrollbar">
      {/* Command Center Bar */}
      <header className="px-6 py-4 flex-shrink-0 z-20">
        <div className="flex items-center gap-1 p-1 bg-muted/20 backdrop-blur-xl border border-border/40 rounded-lg shadow-sm group focus-within:ring-1 ring-primary/20 transition-all">
          {/* Method Selector */}
          <div className="w-[72px] shrink-0">
            <Select
              value={method}
              onChange={(val) => setMethod(val)}
              className="bg-primary/10 border-none text-primary font-bold h-8 text-ui tracking-wider"
            >
              {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-px h-4 bg-border/20 mx-0" />

          {/* URL Input */}
          <div className="flex-1 relative flex items-center min-w-0 -ml-1">
            <Globe className="absolute left-2 w-3.5 h-3.5 text-muted-foreground/50 group-focus-within:text-primary transition-colors shrink-0" />
            <Input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSend();
                }
              }}
              placeholder={t("composer.url_placeholder")}
              className="w-full bg-transparent border-none h-8 text-xs font-sans pl-7 pr-4 shadow-none ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/30"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 pr-1 shrink-0">
            <Tooltip content={t("composer.parse_curl_tooltip")}>
              <Button
                variant="quiet"
                size="icon-sm"
                onClick={() => setShowCurlModal(true)}
                className="h-7 w-7 rounded-lg text-muted-foreground"
              >
                <Code2 className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t("composer.reset")}>
              <Button
                variant="quiet"
                size="icon-sm"
                onClick={reset}
                className="h-7 w-7 rounded-lg hover:text-destructive group/reset"
              >
                <Eraser className="w-3.5 h-3.5 opacity-60 group-hover/reset:opacity-100" />
              </Button>
            </Tooltip>

            <Button
              onClick={handleSend}
              disabled={!url || sending}
              className={cn(
                "h-8 w-28 rounded-md font-bold text-xs tracking-widest gap-2 shadow-sm",
                sending && "opacity-80",
              )}
              variant="default"
            >
              <div className="flex items-center justify-center gap-2 w-full">
                {sending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="opacity-80">{t("composer.sending")}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>{t("composer.send")}</span>
                  </>
                )}
              </div>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content: Two Panel Layout */}
      <main className="flex-1 flex flex-col md:flex-row gap-0 overflow-hidden px-6 pb-6">
        {/* Panel 1: Request Configuration */}
        <div className="flex-1 flex flex-col bg-card/20 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-sm">
          <Tabs defaultValue="headers" className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-muted/10">
              <TabsList className="bg-muted/20 p-0.5 rounded-lg border border-border/20 h-8">
                <TabsTrigger
                  value="headers"
                  className="h-7 px-4 text-xs font-bold rounded-md data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
                >
                  {t("composer.headers")}
                </TabsTrigger>
                <TabsTrigger
                  value="body"
                  className="h-7 px-4 text-xs font-bold rounded-md data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm"
                >
                  {t("composer.body")}
                </TabsTrigger>
              </TabsList>

              {/* Contextual Action for Body */}
              <TabsContent value="body" className="mt-0">
                <Select
                  value={bodyType}
                  onChange={(val) => setBodyType(val as any)}
                  align="right"
                  className="bg-muted/40 h-7 !text-caption !font-black uppercase border-border/20 min-w-[80px]"
                >
                  <option value="none">None</option>
                  <option value="x-www-form-urlencoded">Form-data</option>
                  <option value="raw">JSON</option>
                </Select>
              </TabsContent>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent
                value="headers"
                className="m-0 p-4 animate-in fade-in slide-in-from-left-2 duration-300 h-full overflow-y-auto no-scrollbar"
              >
                <HeaderListEditor headers={headers} onChange={setHeaders} />
              </TabsContent>

              <TabsContent
                value="body"
                className="m-0 p-4 animate-in fade-in slide-in-from-right-2 duration-300 h-full flex flex-col overflow-y-auto no-scrollbar"
              >
                {bodyType === "none" ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/30">
                    <Eraser className="w-10 h-10 mb-3 opacity-10" />
                    <p className="text-caption font-bold uppercase tracking-widest">
                      {t("composer.body_none")}
                    </p>
                  </div>
                ) : bodyType === "x-www-form-urlencoded" ? (
                  <BodyFormEditor data={bodyFormData} onChange={setBodyFormData} />
                ) : (
                  <div className="flex-1 flex flex-col min-h-[300px]">
                    <div className="flex-1 relative bg-muted/10 border border-white/10 rounded-xl overflow-hidden group">
                      <Editor
                        value={body}
                        onChange={(val: string) => setBody(val)}
                        language="json"
                        options={{
                          lineNumbers: "on",
                          folding: true,
                          minimap: { enabled: false },
                        }}
                      />
                      <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity z-20 flex gap-2 pointer-events-none">
                        <div className="pointer-events-auto">
                          <Tooltip content={t("common.format")}>
                            <Button
                              variant="quiet"
                              size="icon-sm"
                              onClick={handleFormatJson}
                              className="h-8 w-8 bg-background/80 backdrop-blur rounded-lg border border-border/20 shadow-sm"
                            >
                              <Code2 className="w-3.5 h-3.5 text-primary" />
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Separator / Gap */}
        <div className="w-6 shrink-0 h-6" />

        {/* Panel 2: Response View */}
        <div className="flex-1 flex flex-col bg-card/20 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-sm relative group/response">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-muted/10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-2 h-2 rounded-full transition-all duration-500",
                  lastResponse
                    ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    : "bg-muted-foreground/30",
                )}
              />
              <span className="text-caption font-black uppercase tracking-[0.2em] text-foreground/60">
                {t("composer.response")}
              </span>
            </div>

            {lastResponse && (
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-md text-caption font-black border",
                    getStatusColor(lastResponse.status || 0),
                  )}
                >
                  {lastResponse.status}
                </span>
                <div className="flex items-center bg-muted/30 p-0.5 rounded-lg border border-border/20">
                  <button
                    onClick={() => setViewMode("preview")}
                    className={cn(
                      "px-2 py-0.5 text-caption font-bold rounded-md transition-all",
                      viewMode === "preview"
                        ? "bg-background text-primary shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("composer.preview")}
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={cn(
                      "px-2 py-0.5 text-caption font-bold rounded-md transition-all",
                      viewMode === "raw"
                        ? "bg-background text-primary shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("composer.raw")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto no-scrollbar relative">
            <AnimatePresence mode="wait">
              {lastResponse ? (
                <motion.div
                  key="resp"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col"
                >
                  <div className="flex-1 relative min-h-0 bg-transparent">
                    <Editor
                      value={
                        viewMode === "raw"
                          ? lastResponse.body
                          : lastResponse.body.length > 1024 * 1024 // 1MB threshold for formatting
                            ? lastResponse.body
                            : formatJson(lastResponse.body)
                      }
                      language={viewMode === "raw" ? "text" : "json"}
                      options={{
                        readOnly: true,
                        lineWrapping: true,
                        lineNumbers: true,
                      }}
                    />
                  </div>

                  {/* Action Floating Bar */}
                  <div className="absolute right-4 bottom-4 flex items-center gap-2 opacity-0 group-hover/response:opacity-100 transition-opacity">
                    <CopyButton
                      text={lastResponse.body}
                      variant="quiet"
                      className="h-9 w-9 rounded-xl shadow-lg bg-background/90"
                    />
                    <Tooltip content={t("content_preview.download")}>
                      <Button
                        variant="quiet"
                        size="icon-sm"
                        onClick={handleDownload}
                        className="h-9 w-9 bg-background/90 backdrop-blur rounded-xl border border-white/10 shadow-lg"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </Tooltip>
                  </div>
                </motion.div>
              ) : result?.type === "error" ? (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex items-center justify-center p-8"
                >
                  <EmptyState
                    icon={AlertCircle}
                    title={t("composer.request_failed")}
                    description={result.message}
                    status="destructive"
                    variant="minimal"
                    animation="pulse"
                    action={{
                      label: t("composer.clear_error"),
                      onClick: () => setResult(null),
                      icon: X,
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex items-center justify-center"
                >
                  <EmptyState
                    icon={Zap}
                    title={t("composer.send_desc")}
                    description={t("composer.url_placeholder")}
                    animation="pulse"
                    variant="minimal"
                    className="opacity-30"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* cURL Modal (Redesigned) */}
      {showCurlModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-8 bg-black/25 backdrop-blur-[1px] animate-in fade-in duration-300">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card w-full max-w-xl rounded-2xl border border-white/5 shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-muted/20">
              <h3 className="text-sm font-bold tracking-tight text-foreground">
                {t("composer.curl_modal.title")}
              </h3>
              <button
                onClick={() => {
                  setShowCurlModal(false);
                  setParseError(null);
                }}
                className="text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-small text-muted-foreground/80 leading-relaxed font-medium">
                {t("composer.curl_modal.desc")}
              </p>
              <div className="relative group">
                <Textarea
                  value={curlInput}
                  onChange={(e) => {
                    setCurlInput(e.target.value);
                    if (parseError) setParseError(null);
                  }}
                  placeholder={t("composer.curl_modal.placeholder")}
                  rows={10}
                  className={cn(
                    "w-full p-4 bg-muted/10 border rounded-2xl text-small font-mono focus:outline-none focus:ring-2 transition-all resize-none shadow-inner",
                    parseError
                      ? "border-red-500/50 focus:ring-red-500/20"
                      : "border-white/5 focus:ring-primary/20",
                  )}
                />
                {parseError && (
                  <div className="absolute top-4 right-4 text-caption text-red-400 font-bold bg-background/90 backdrop-blur px-2 py-1 rounded-lg border border-red-500/20 shadow-sm flex items-center gap-1.5 animate-in slide-in-from-top-1">
                    <AlertCircle className="w-3 h-3" /> {parseError}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="quiet"
                  onClick={() => {
                    setShowCurlModal(false);
                    setParseError(null);
                  }}
                  className="px-6 rounded-xl text-muted-foreground hover:text-foreground"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleParseCurl}
                  disabled={!curlInput}
                  className="px-8 rounded-xl shadow-lg shadow-primary/20"
                >
                  {t("composer.curl_modal.parse_btn")}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
