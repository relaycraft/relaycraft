import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type InspectedGrpcMessage, inspectGrpcBody } from "../../lib/grpc";
import { cn } from "../../lib/utils";
import { CopyButton } from "../common/CopyButton";

interface GrpcPanelProps {
  content?: string;
  encoding?: string;
}

export function GrpcPanel({ content, encoding }: GrpcPanelProps) {
  const { t } = useTranslation();
  const messages = useMemo(() => inspectGrpcBody(content, encoding), [content, encoding]);
  const [rawIndex, setRawIndex] = useState<number | null>(null);

  if (messages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/50 italic px-1 py-3">{t("flow.grpc.empty")}</p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-tiny text-muted-foreground/70">{t("flow.grpc.heuristic_note")}</p>
      {messages.map((msg) => (
        <GrpcMessageCard
          key={msg.index}
          message={msg}
          showRaw={rawIndex === msg.index}
          onToggleRaw={() => setRawIndex((current) => (current === msg.index ? null : msg.index))}
        />
      ))}
    </div>
  );
}

function GrpcMessageCard({
  message,
  showRaw,
  onToggleRaw,
}: {
  message: InspectedGrpcMessage;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const { t } = useTranslation();
  const json = message.decoded == null ? "" : JSON.stringify(message.decoded, null, 2);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/40 bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-tiny font-semibold uppercase tracking-wider text-muted-foreground">
            {t("flow.grpc.message_n", { n: message.index + 1 })}
          </span>
          {message.compressed && (
            <span className="text-tiny px-1.5 py-0 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {t("flow.grpc.compressed")}
            </span>
          )}
          {message.truncated && (
            <span className="text-tiny px-1.5 py-0 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              {t("flow.grpc.truncated")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {json && (
            <>
              <button
                type="button"
                onClick={onToggleRaw}
                className={cn(
                  "text-tiny px-1.5 py-0.5 rounded border",
                  showRaw
                    ? "border-primary/40 text-primary"
                    : "border-border/50 text-muted-foreground hover:text-foreground",
                )}
              >
                {t("flow.grpc.raw")}
              </button>
              <CopyButton text={json} label={t("common.copy")} showLabel={false} />
            </>
          )}
        </div>
      </div>
      <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-80 overflow-auto">
        {message.compressed
          ? t("flow.grpc.compressed")
          : message.truncated
            ? t("flow.grpc.truncated")
            : json || t("flow.grpc.empty")}
      </pre>
    </div>
  );
}
