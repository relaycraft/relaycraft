import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Globe,
  Monitor,
  MonitorSmartphone,
  Settings,
  Smartphone,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { CopyButton } from "../common/CopyButton";
import { Modal } from "../common/Modal";

interface SetupGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SetupGuideModal({ isOpen, onClose }: SetupGuideProps) {
  const [localIp, setLocalIp] = useState<string>("127.0.0.1");
  const proxyPort = useProxyStore((state) => state.port);
  const { t } = useTranslation();

  useEffect(() => {
    // Fetch local IP (simplified)
    invoke<string>("get_local_ip")
      .then(setLocalIp)
      .catch(() => setLocalIp("127.0.0.1"));
  }, []);

  const certUrl = "http://relay.guide";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("setup_guide.title")}
      className="max-w-3xl"
      icon={<MonitorSmartphone className="w-5 h-5 text-primary" />}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: General Info */}
        <div className="space-y-6">
          <div className="bg-primary/5 rounded-xl p-3 border border-primary/10">
            <p className="text-xs font-black text-primary/70 uppercase tracking-widest">
              {t("setup_guide.current_proxy")}
            </p>
            <div className="mt-1.5 flex items-center justify-between">
              <div className="font-mono text-base font-bold text-foreground tracking-tight">
                {localIp}:{proxyPort}
              </div>
              <CopyButton text={`${localIp}:${proxyPort}`} label={t("setup_guide.copy_address")} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-border/30">
              <Monitor className="w-3.5 h-3.5 text-muted-foreground/70" />
              <h3 className="font-black text-xs uppercase tracking-wider">
                {t("setup_guide.pc_config")}
              </h3>
            </div>
            <ul className="space-y-5">
              <li className="flex gap-3 text-xs text-foreground/90">
                <span>
                  <Globe className="w-3 h-3 inline mr-1.5 -mt-0.5 text-primary/80" />
                  <span className="font-bold">{t("setup_guide.switchy_omega")}</span>
                  <p
                    className="mt-1 text-ui text-muted-foreground/70 leading-relaxed"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted localized string with basic formatting
                    dangerouslySetInnerHTML={{
                      __html: t("setup_guide.switchy_omega_desc", {
                        ip: localIp,
                        port: proxyPort,
                      }),
                    }}
                  />
                </span>
              </li>
              <li className="flex gap-3 text-xs text-foreground/90">
                <span>
                  <Settings className="w-3 h-3 inline mr-1.5 -mt-0.5 text-primary/80" />
                  <span className="font-bold">{t("setup_guide.system_proxy")}</span>
                  <p className="mt-1 text-ui text-muted-foreground/70 leading-relaxed">
                    {t("setup_guide.system_proxy_desc")}
                  </p>
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right: Mobile Info */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border/30">
            <Smartphone className="w-3.5 h-3.5 text-muted-foreground/70" />
            <h3 className="font-black text-xs uppercase tracking-wider">
              {t("setup_guide.mobile_config")}
            </h3>
          </div>

          {/* Step 1 */}
          <div className="flex gap-3 text-xs text-foreground/90">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary mt-0.5">
              1
            </div>
            <span>
              <span className="font-bold">{t("setup_guide.install_cert_step1")}</span>
              <p
                className="mt-1 text-ui text-muted-foreground/70 leading-relaxed"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted localized string with basic formatting
                dangerouslySetInnerHTML={{
                  __html: t("setup_guide.install_cert_step1_desc", {
                    ip: localIp,
                    port: proxyPort,
                  }),
                }}
              />
            </span>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 text-xs text-foreground/90">
            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary mt-0.5">
              2
            </div>
            <span className="flex-1">
              <span className="font-bold">{t("setup_guide.install_cert_step2")}</span>
              <p className="mt-1 text-ui text-muted-foreground/70 leading-relaxed">
                {t("setup_guide.install_cert_step2_desc")}
              </p>
              {/* URL + compact QR — always visible */}
              <div className="mt-2 flex items-center gap-3 bg-primary/5 border border-primary/15 rounded-xl px-3 py-2.5">
                <a
                  href={certUrl}
                  target="_blank"
                  className="flex-1 font-mono text-[11px] font-semibold text-primary hover:underline truncate"
                >
                  {certUrl}
                </a>
                <div className="flex-shrink-0 p-1 bg-white rounded-lg border border-border/20 shadow-sm">
                  <QRCodeSVG
                    value={certUrl}
                    size={72}
                    bgColor="#ffffff"
                    fgColor="#0b0c0f"
                    level="M"
                  />
                </div>
              </div>
            </span>
          </div>

          {/* Fallback tip */}
          <div className="bg-muted/10 rounded-xl p-3 border border-border/20 flex gap-3 mt-1">
            <div className="p-1.5 bg-yellow-500/5 rounded-lg h-fit text-yellow-500/60">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-tight text-yellow-500/70">
                {t("setup_guide.install_cert_fallback")}
              </p>
              <p className="text-xs text-muted-foreground/60 leading-normal mt-0.5">
                {t("setup_guide.install_cert_fallback_desc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Troubleshooting — full width */}
      <div className="mt-4 bg-muted/10 rounded-xl p-3 border border-border/20 flex gap-3">
        <div className="p-1.5 bg-yellow-500/5 rounded-lg h-fit text-yellow-500/60">
          <AlertTriangle className="w-3.5 h-3.5" />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-tight text-yellow-500/70">
            {t("setup_guide.trouble")}
          </p>
          <p className="text-xs text-muted-foreground/60 leading-normal mt-0.5">
            {t("setup_guide.trouble_desc", { port: proxyPort })}
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
        >
          {t("setup_guide.got_it")}
        </button>
      </div>
    </Modal>
  );
}
