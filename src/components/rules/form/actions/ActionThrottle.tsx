import { useTranslation } from "react-i18next";
import { Input } from "../../../common/Input";

interface ActionThrottleProps {
  delayMs: number;
  onChangeDelayMs: (val: number) => void;
  packetLoss: number;
  onChangePacketLoss: (val: number) => void;
  bandwidthKbps: number;
  onChangeBandwidthKbps: (val: number) => void;
}

const LABEL_STYLE =
  "text-[11px] font-bold text-foreground/50 uppercase tracking-widest mb-1.5 block";

export function ActionThrottle({
  delayMs,
  onChangeDelayMs,
  packetLoss,
  onChangePacketLoss,
  bandwidthKbps,
  onChangeBandwidthKbps,
}: ActionThrottleProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-3.5 bg-muted/20 rounded-xl border border-border/40">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="throttle-delay" className={LABEL_STYLE}>
              {t("rule_editor.action.throttle.delay")}
            </label>
            <span className="text-[10px] text-muted-foreground/40 font-medium mb-1.5 uppercase tracking-tighter">
              {t("common.optional")}
            </span>
          </div>
          <Input
            id="throttle-delay"
            type="number"
            min={0}
            value={delayMs || ""}
            onChange={(e) => {
              const val = e.target.value;
              onChangeDelayMs(val === "" ? 0 : parseInt(val, 10));
            }}
            placeholder="0"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="throttle-loss" className={LABEL_STYLE}>
              {t("rule_editor.action.throttle.packet_loss")}
            </label>
            <span className="text-[10px] text-muted-foreground/40 font-medium mb-1.5 uppercase tracking-tighter">
              {t("common.optional")}
            </span>
          </div>
          <Input
            id="throttle-loss"
            type="number"
            min={0}
            max={100}
            value={packetLoss || ""}
            onChange={(e) => {
              const val = e.target.value;
              onChangePacketLoss(val === "" ? 0 : parseInt(val, 10));
            }}
            placeholder="0"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="throttle-bandwidth" className={LABEL_STYLE}>
              {t("rule_editor.action.throttle.bandwidth")}
            </label>
            <span className="text-[10px] text-muted-foreground/40 font-medium mb-1.5 uppercase tracking-tighter">
              {t("common.optional")}
            </span>
          </div>
          <Input
            id="throttle-bandwidth"
            type="number"
            min={0}
            value={bandwidthKbps || ""}
            onChange={(e) => {
              const val = e.target.value;
              onChangeBandwidthKbps(val === "" ? 0 : parseInt(val, 10));
            }}
            placeholder="Unlimited"
            className="font-mono text-xs"
          />
        </div>
      </div>
    </div>
  );
}
