import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Code, Download, Eye, FileDigit, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  detectContentType,
  formatJson,
  formatXml,
  getExtensionFromHeaders,
} from "../../lib/contentUtils";
import { CodeBlock } from "../common/CodeBlock";
import { CopyButton } from "../common/CopyButton";
import { Tooltip } from "../common/Tooltip";

interface ContentPreviewProps {
  content: string | undefined; // Base64 encoded for binaries/images, plain text for text
  encoding?: "text" | "base64";
  headers: Record<string, string> | null;
}

export function ContentPreview({ content, encoding, headers }: ContentPreviewProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");

  // Determine content type based on headers, but fallback to binary if explicit base64 encoding provided without specific type
  const contentType = useMemo(() => {
    const type = detectContentType(headers, content || null);
    if (encoding === "base64" && type === "text") {
      // If detected as text but encoded as base64, assume it's binary or unknown
      return "binary";
    }
    return type;
  }, [headers, content, encoding]);

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-muted-foreground/50 bg-muted/5 rounded-lg border border-border/30 mt-2 h-24">
        <FileText className="w-4 h-4 opacity-30 mb-1" />
        <span className="text-[10px] font-medium opacity-60">
          {t("content_preview.no_content")}
        </span>
      </div>
    );
  }

  const handleDownload = async () => {
    try {
      const extension = getExtensionFromHeaders(headers, contentType);
      const defaultPath = `response.${extension} `;

      const filePath = await save({
        defaultPath,
        filters: [
          {
            name: "File",
            extensions: [extension],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (!filePath) return;

      if (encoding === "base64") {
        // Decode base64 to binary
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        await writeFile(filePath, bytes);
      } else {
        // Write text directly
        await writeTextFile(filePath, content);
      }
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  };

  // Render Logic
  const renderContent = () => {
    if (contentType === "image") {
      const contentTypeKey = Object.keys(headers || {}).find(
        (k) => k.toLowerCase() === "content-type",
      );
      const mimeType = contentTypeKey && headers ? headers[contentTypeKey] : "image/jpeg";

      const src = encoding === "base64" ? `data:${mimeType}; base64, ${content} ` : content;

      return (
        <div className="flex items-center justify-center bg-checkered p-4 rounded min-h-[200px]">
          <img
            src={src}
            alt="Preview"
            className="max-w-full max-h-[500px] object-contain shadow-sm"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      );
    }

    if (contentType === "json") {
      const decoded = encoding === "base64" ? atob(content || "") : content;
      const formatted = formatJson(decoded || "");
      return <CodeBlock code={formatted} language="json" />;
    }

    if (contentType === "html" || contentType === "xml") {
      const formatted = contentType === "xml" ? formatXml(content || "") : content;
      return <CodeBlock code={formatted || ""} language={contentType} />;
    }

    if (contentType === "binary" || encoding === "base64") {
      return (
        <div className="flex flex-col items-center justify-center p-12 bg-muted/10 border border-dashed border-border rounded-lg">
          <FileDigit className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <p className="font-medium mb-1">
            {contentType === "binary" ? t("content_preview.binary") : t("content_preview.base64")}
          </p>
          <p className="text-xs text-muted-foreground mb-4">{content?.length || 0} bytes</p>
        </div>
      );
    }

    return (
      <pre className="font-mono text-xs bg-background p-4 rounded border overflow-auto max-h-[600px] whitespace-pre-wrap break-all text-foreground text-ellipsis">
        {content}
      </pre>
    );
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded-md bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {contentType}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {content.length > 1024
              ? `${(content.length / 1024).toFixed(2)} KB`
              : `${content.length} B`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {(contentType === "json" || contentType === "html" || contentType === "xml") && (
            <Tooltip
              content={
                viewMode === "preview"
                  ? t("content_preview.view_source")
                  : t("content_preview.view_parsed")
              }
            >
              <button
                onClick={() => setViewMode(viewMode === "preview" ? "raw" : "preview")}
                className={`p-1.5 rounded transition ${viewMode === "raw" ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"}`}
              >
                {viewMode === "preview" ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <Code className="w-4 h-4" />
                )}
              </button>
            </Tooltip>
          )}

          <CopyButton text={content} className="p-1.5" />

          <Tooltip content={t("content_preview.download")}>
            <button
              onClick={handleDownload}
              className="p-1.5 hover:bg-muted text-muted-foreground rounded transition"
            >
              <Download className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {viewMode === "raw" ? (
          <CodeBlock code={content} language="text" hideHeader />
        ) : (
          renderContent()
        )}
      </div>
    </div>
  );
}
