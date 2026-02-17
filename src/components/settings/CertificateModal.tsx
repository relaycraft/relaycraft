import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ExternalLink,
  Globe,
  Info,
  Monitor,
  QrCode,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { CopyButton } from "../common/CopyButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../common/Tabs";

interface CertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CertificateModal({ isOpen, onClose }: CertificateModalProps) {
  const { t } = useTranslation();
  const [certPath, setCertPath] = useState<string | null>(null);
  const [localIp, setLocalIp] = useState<string>("127.0.0.1");
  const [proxyPort, setProxyPort] = useState<number>(9090);
  const [showQr, setShowQr] = useState(false);
  const [certFormat, setCertFormat] = useState<"pem" | "crt">("pem");
  const isMacOS = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

  const loadCertContext = useCallback(async () => {
    try {
      const [ip, config, path] = await Promise.all([
        invoke<string>("get_local_ip").catch(() => "127.0.0.1"),
        invoke<any>("load_config").catch(() => ({})),
        invoke<string>("get_cert_path").catch(() => null),
      ]);

      if (ip) setLocalIp(ip);
      if (config?.proxy_port) setProxyPort(config.proxy_port);
      if (path) setCertPath(path);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadCertContext();
    }
  }, [isOpen, loadCertContext]);

  if (!isOpen) return null;

  // Prepare steps with translation components
  const windowsSteps = (t("cert.manual.guides.windows", { returnObjects: true }) as string[]).map(
    // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted localized string with basic formatting
    (step: string, i) => <span key={i} dangerouslySetInnerHTML={{ __html: step }} />,
  );
  const macosSteps = (t("cert.manual.guides.macos", { returnObjects: true }) as string[]).map(
    // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted localized string with basic formatting
    (step: string, i) => <span key={i} dangerouslySetInnerHTML={{ __html: step }} />,
  );
  const iosSteps = (t("cert.manual.guides.ios", { returnObjects: true }) as string[]).map(
    (step: string, i) => <span key={i}>{step}</span>,
  );
  const androidSteps = [
    ...(t("cert.manual.guides.android", { returnObjects: true }) as string[]).map(
      (step: string, i) => <span key={i}>{step}</span>,
    ),
    <span key="hint" className="text-amber-600/90 font-medium">
      {t("cert.manual.guides.mobile_android_hint")}
    </span>,
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/25 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="w-full max-w-3xl max-h-[650px] h-[85vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/40 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              {t("cert.manual.guides.title")}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted/80 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-card">
          <Tabs defaultValue="desktop" className="flex-1 flex flex-col h-full">
            <div className="flex-none px-5 pt-4 pb-2">
              <TabsList className="grid w-full grid-cols-2 bg-muted/50 p-1 rounded-lg h-auto border border-border/40">
                <TabsTrigger
                  value="desktop"
                  className="rounded-md py-2 text-xs font-bold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Monitor className="w-3.5 h-3.5" />
                    {t("cert.manual.tabs.desktop")}
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="mobile"
                  className="rounded-md py-2 text-xs font-bold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Smartphone className="w-3.5 h-3.5" />
                    {t("cert.manual.tabs.mobile")}
                  </div>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-8 scrollbar-thin scrollbar-thumb-border/40 scrollbar-track-transparent">
              <TabsContent value="desktop" className="mt-0 h-full">
                <Tabs defaultValue={isMacOS ? "macos" : "windows"} className="flex flex-col h-full">
                  <div className="flex-none mb-4 flex justify-start sticky top-0 bg-card z-10 py-2">
                    <TabsList className="bg-muted/30 p-0.5 border border-border/40 w-fit h-auto gap-0.5 rounded-lg">
                      <TabsTrigger
                        value="windows"
                        className="px-4 py-1.5 rounded-md text-ui font-medium transition-all"
                      >
                        {t("cert.manual.desktop.windows")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="macos"
                        className="px-4 py-1.5 rounded-md text-ui font-medium transition-all"
                      >
                        {t("cert.manual.desktop.macos")}
                      </TabsTrigger>
                      <TabsTrigger
                        value="linux"
                        className="px-4 py-1.5 rounded-md text-ui font-medium transition-all"
                      >
                        {t("cert.manual.desktop.linux")}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1">
                    <TabsContent value="windows" className="mt-0">
                      <Stepper steps={windowsSteps} />
                    </TabsContent>
                    <TabsContent value="macos" className="mt-0">
                      <div className="space-y-5">
                        <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <h4 className="text-xs font-bold text-amber-600">
                                {t("cert.manual.guides.macos_sequoia_hint_title")}
                              </h4>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                <span
                                  // biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted localized string with basic formatting
                                  dangerouslySetInnerHTML={{
                                    __html: t("cert.manual.guides.macos_sequoia_hint_desc"),
                                  }}
                                />
                              </p>
                            </div>
                          </div>
                        </div>

                        <Stepper steps={macosSteps} />

                        <div className="pt-4 border-t border-border/40">
                          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                            {t("cert.manual.guides.terminal_hint")}
                          </div>
                          <div className="bg-zinc-950 rounded-lg p-3 group relative border border-white/5 ring-1 ring-white/5 shadow-sm">
                            <div className="font-mono text-xs text-zinc-300 break-all pr-8 leading-relaxed">
                              sudo security add-trusted-cert -d -r trustRoot -p ssl -p basic -k
                              /Library/Keychains/System.keychain "
                              {certPath || "~/.mitmproxy/mitmproxy-ca-cert.pem"}"
                            </div>
                            <div className="absolute right-2 top-2">
                              <CopyButton
                                text={`sudo security add-trusted-cert -d -r trustRoot -p ssl -p basic -k /Library/Keychains/System.keychain "${certPath || "~/.mitmproxy/mitmproxy-ca-cert.pem"}"`}
                                className="p-1.5 bg-white/5 hover:bg-white/10 text-white rounded transition-all border border-white/10 active:scale-95"
                                label={t("cert.manual.guides.terminal_copy")}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="linux" className="mt-0">
                      <div className="space-y-4">
                        <div className="space-y-3">
                          {[
                            {
                              id: "debian",
                              label: t("cert.manual.guides.linux_debian"),
                              cmd: t("cert.manual.guides.linux_debian_cmd"),
                            },
                            {
                              id: "fedora",
                              label: t("cert.manual.guides.linux_fedora"),
                              cmd: t("cert.manual.guides.linux_fedora_cmd"),
                            },
                            {
                              id: "arch",
                              label: t("cert.manual.guides.linux_arch"),
                              cmd: t("cert.manual.guides.linux_arch_cmd"),
                            },
                          ].map((distro) => (
                            <div key={distro.id} className="space-y-1.5">
                              <div className="text-xs font-bold text-muted-foreground uppercase px-1">
                                {distro.label}
                              </div>
                              <div className="bg-zinc-950 rounded-lg p-3 group relative border border-white/5 shadow-sm">
                                <div className="font-mono text-xs text-zinc-300 break-all pr-8 leading-relaxed">
                                  {distro.cmd.replace(
                                    "{{path}}",
                                    certPath || "~/relaycraft-ca-cert.pem",
                                  )}
                                </div>
                                <div className="absolute right-2 top-2">
                                  <CopyButton
                                    text={distro.cmd.replace(
                                      "{{path}}",
                                      certPath || "~/relaycraft-ca-cert.pem",
                                    )}
                                    className="p-1.5 bg-white/5 hover:bg-white/10 text-white rounded transition-all border border-white/10 active:scale-95"
                                    label={t("common.copy")}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </TabsContent>
                  </div>
                </Tabs>
              </TabsContent>

              <TabsContent value="mobile" className="mt-0 h-full">
                <div className="space-y-6 pb-12">
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold flex items-center gap-2 text-foreground">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      {t("cert.manual.guides.mobile_step1")}
                    </h3>
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 relative overflow-hidden group">
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3 max-w-lg font-medium">
                        {t("cert.manual.guides.mobile_step1_desc")}
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-background/80 rounded-lg p-3 border border-border/50 shadow-sm relative z-10">
                          <div className="text-xs font-bold text-muted-foreground mb-1 uppercase tracking-tight">
                            {t("cert.manual.guides.mobile_wifi_config")}
                          </div>
                          <div className="font-mono text-xs flex items-center justify-between">
                            <span className="text-muted-foreground">
                              {t("cert.info.ip")}{" "}
                              <span className="select-all text-primary font-bold">{localIp}</span>
                            </span>
                            <span className="text-muted-foreground">
                              {t("cert.info.port")}{" "}
                              <span className="text-primary font-bold">{proxyPort}</span>
                            </span>
                          </div>
                        </div>
                        <div className="bg-background/80 rounded-lg p-3 border border-border/50 shadow-sm relative z-10 flex items-center justify-between gap-2 transition-all hover:border-primary/30 group/linkbox">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-muted-foreground mb-1 uppercase tracking-tight">
                              {t("cert.manual.guides.mobile_browser_access")}
                            </div>
                            <a
                              href={`http://${localIp}:${proxyPort}/cert`}
                              target="_blank"
                              className="font-mono text-xs text-primary font-bold flex items-center gap-2 hover:underline group/link"
                            >
                              <span className="truncate">
                                http://{localIp}:{proxyPort}/cert
                              </span>
                              <ExternalLink className="w-3 h-3 shrink-0 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                            </a>
                          </div>
                          <button
                            onClick={() => setShowQr(!showQr)}
                            className={cn(
                              "p-1.5 rounded-md border transition-all shrink-0",
                              showQr
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/50 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground",
                            )}
                            title={t("cert.manual.guides.mobile_qr_code_hint")}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {showQr && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 flex flex-col items-center gap-3 py-4 bg-muted/40 rounded-lg border border-border/40 shadow-inner">
                              <div className="p-2 bg-white rounded-lg shadow-sm border border-border/20">
                                <QRCodeSVG
                                  value={`http://${localIp}:${proxyPort}/cert?format=${certFormat}`}
                                  size={130}
                                  level="H"
                                  includeMargin={false}
                                />
                              </div>
                              <span className="text-xs font-bold text-muted-foreground/70 uppercase tracking-widest">
                                {t("cert.manual.guides.mobile_qr_code_hint")}
                              </span>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{t("cert.format.label", "Format")}:</span>
                                <button
                                  onClick={() => setCertFormat("pem")}
                                  className={cn(
                                    "px-2 py-0.5 rounded transition-colors",
                                    certFormat === "pem"
                                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                                      : "bg-muted hover:bg-muted/80",
                                  )}
                                >
                                  PEM
                                </button>
                                <button
                                  onClick={() => setCertFormat("crt")}
                                  className={cn(
                                    "px-2 py-0.5 rounded transition-colors",
                                    certFormat === "crt"
                                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                                      : "bg-muted hover:bg-muted/80",
                                  )}
                                >
                                  CRT
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="mt-3 flex items-start gap-2 px-1">
                        <div className="w-1 h-1 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                        <p className="text-xs text-muted-foreground italic leading-relaxed">
                          {t("cert.manual.guides.mobile_manual_transfer_tip")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pb-4">
                    <h3 className="text-xs font-bold flex items-center gap-2 text-foreground">
                      <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                      {t("cert.manual.guides.mobile_step2")}
                    </h3>

                    <Tabs defaultValue="ios" className="w-full">
                      <TabsList className="bg-muted/20 p-0.5 border border-border/40 w-fit justify-start h-auto gap-0.5 rounded-lg mb-3">
                        <TabsTrigger
                          value="ios"
                          className="px-4 py-1 rounded-md text-xs font-medium transition-all"
                        >
                          iOS / iPadOS
                        </TabsTrigger>
                        <TabsTrigger
                          value="android"
                          className="px-4 py-1 rounded-md text-xs font-medium transition-all"
                        >
                          Android
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="ios" className="mt-0">
                        <Stepper steps={iosSteps} />
                      </TabsContent>
                      <TabsContent value="android" className="mt-0">
                        <Stepper steps={androidSteps} />
                      </TabsContent>
                    </Tabs>
                  </div>

                  {/* Troubleshooting New Section */}
                  <div className="pt-2">
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-amber-600 mb-2">
                        <Info className="w-3.5 h-3.5" />
                        <h4 className="text-ui font-bold uppercase tracking-tight">
                          {t("cert.manual.guides.mobile_troubleshooting_title")}
                        </h4>
                      </div>
                      <ul className="space-y-2">
                        <li className="flex gap-2 items-start text-xs text-muted-foreground leading-relaxed">
                          <div className="w-1 h-1 rounded-full bg-amber-500/40 mt-1.5 shrink-0" />
                          {t("cert.manual.guides.mobile_troubleshooting_ios_trust")}
                        </li>
                        <li className="flex gap-2 items-start text-xs text-muted-foreground leading-relaxed">
                          <div className="w-1 h-1 rounded-full bg-amber-500/40 mt-1.5 shrink-0" />
                          {t("cert.manual.guides.mobile_troubleshooting_app_pinning")}
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Stepper({ steps }: { steps: React.ReactNode[] }) {
  return (
    <div className="pl-1 pt-1">
      {steps.map((step, i) => (
        <div key={i} className="relative pl-10 pb-5 last:pb-0 group">
          {/* Connecting Line */}
          {i !== steps.length - 1 && (
            <div className="absolute left-[15px] top-8 bottom-0 w-[1px] bg-border group-hover:bg-primary/20 transition-colors" />
          )}

          {/* Badge */}
          <div className="absolute left-1 top-1 w-7 h-7 rounded-lg bg-muted text-foreground/70 group-hover:bg-primary group-hover:text-primary-foreground flex items-center justify-center text-xs font-black shadow-sm transition-all duration-300 ring-4 ring-background z-10 border border-border/10">
            {i + 1}
          </div>

          {/* Content */}
          <div className="text-xs leading-relaxed pt-1.5 text-foreground/90 group-hover:text-foreground transition-colors font-medium">
            {step}
          </div>
        </div>
      ))}
    </div>
  );
}
