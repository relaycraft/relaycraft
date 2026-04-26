import { RotateCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "../../lib/notify";
import { wsInjectFrame } from "../../lib/traffic";
import type { RcWebSocketFrame } from "../../types";
import { Button } from "../common/Button";
import { Editor } from "../common/Editor";
import { Modal } from "../common/Modal";

interface WsResendDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  flowId: string;
  frame: RcWebSocketFrame | null;
}

/**
 * 编辑并重发一条客户端→服务端的 WebSocket 帧。
 *
 * - text 帧：CodeMirror 编辑器，可自由修改
 * - binary 帧：只读显示 base64，顶部提示"只能原样重发"
 * - 发送后抽屉关闭，新帧会通过已有的轮询管线出现在帧列表里并带 `injected` 徽标
 */
export function WsResendDrawer({ isOpen, onClose, flowId, frame }: WsResendDrawerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);

  const isBinary = frame?.encoding === "base64";
  const byteLength = frame?.length ?? 0;

  useEffect(() => {
    if (isOpen && frame) {
      setContent(frame.content ?? "");
      setIsSending(false);
    }
  }, [isOpen, frame]);

  const editorLanguage = useMemo(() => {
    if (isBinary) return "text";
    const trimmed = (frame?.content ?? "").trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
    return "text";
  }, [frame, isBinary]);

  const sendDisabled = isSending || !frame;

  const handleSend = async () => {
    if (!frame || sendDisabled) return;
    setIsSending(true);
    try {
      await wsInjectFrame({
        flowId,
        type: isBinary ? "binary" : "text",
        payload: content,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notify.error(`${t("traffic.websocket.resend_failed")}: ${message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("traffic.websocket.resend")}
      icon={<RotateCw className="w-4 h-4 text-primary" />}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-3 min-h-[320px]">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/80">
          <span className="px-1.5 py-0.5 rounded bg-muted/30 font-mono">
            {isBinary ? "BINARY" : "TEXT"}
          </span>
          <span>{byteLength} bytes</span>
        </div>

        {isBinary && (
          <div className="text-tiny text-muted-foreground/70 border border-border/40 bg-muted/10 rounded px-2 py-1.5">
            {t("traffic.websocket.resend_binary_readonly")}
          </div>
        )}

        <div className="h-[240px] border border-border/40 rounded overflow-hidden">
          <Editor
            value={content}
            onChange={setContent}
            language={editorLanguage}
            options={{
              readOnly: isBinary,
              lineWrapping: true,
              lineNumbers: "off",
            }}
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={sendDisabled}
            isLoading={isSending}
            onClick={handleSend}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" />
            {t("traffic.websocket.send")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
