import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CheckCircle2, Copy, RefreshCcw, XCircle } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Button } from "../common/Button";
import { SettingsInput, SettingsRow, SettingsSection, SettingsToggle } from "./SettingsLayout";

export function NetworkSettings() {
  const { t } = useTranslation();
  const {
    config,
    loading,
    updateProxyPort,
    updateSslInsecure,
    updateUpstreamProxy,
    updateShareConfig,
    testingUpstream,
    upstreamStatus,
    testUpstreamConnectivity,
    resetUpstreamStatus,
  } = useSettingsStore();

  const { running, restartProxy, ipAddress } = useProxyStore();

  const share = config.share ?? {
    enabled: false,
    port: 9080,
    upstream_url: "",
    listen_lan: false,
  };

  const networkSnapshot = React.useRef({
    proxy_port: config.proxy_port,
    ssl_insecure: config.ssl_insecure,
    upstream_proxy: config.upstream_proxy,
    share: config.share,
  });
  const snapshotReady = React.useRef(false);

  const networkChanged =
    running &&
    snapshotReady.current &&
    (config.proxy_port !== networkSnapshot.current.proxy_port ||
      config.ssl_insecure !== networkSnapshot.current.ssl_insecure ||
      JSON.stringify(config.upstream_proxy) !==
        JSON.stringify(networkSnapshot.current.upstream_proxy) ||
      JSON.stringify(config.share) !== JSON.stringify(networkSnapshot.current.share));

  const [restarting, setRestarting] = React.useState(false);
  const [shareUrlCopied, setShareUrlCopied] = React.useState(false);
  const [sharePortInUse, setSharePortInUse] = React.useState(false);

  const shareUpstreamInvalid =
    share.enabled &&
    share.upstream_url.trim() !== "" &&
    !/^https?:\/\/.+/.test(share.upstream_url.trim());
  const sharePortConflict = share.enabled && share.port === config.proxy_port;
  const shareHost = share.listen_lan && ipAddress ? ipAddress : "127.0.0.1";
  const shareUrl = `http://${shareHost}:${share.port}`;

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareUrlCopied(true);
      setTimeout(() => setShareUrlCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — ignore.
    }
  };

  const handleRestartEngine = async () => {
    setRestarting(true);
    try {
      await restartProxy();
      networkSnapshot.current = {
        proxy_port: config.proxy_port,
        ssl_insecure: config.ssl_insecure,
        upstream_proxy: config.upstream_proxy,
        share: config.share,
      };
    } finally {
      setRestarting(false);
    }
  };

  React.useEffect(() => {
    if (!running) {
      snapshotReady.current = false;
      return;
    }
    if (loading || snapshotReady.current) return;
    networkSnapshot.current = {
      proxy_port: config.proxy_port,
      ssl_insecure: config.ssl_insecure,
      upstream_proxy: config.upstream_proxy,
      share: config.share,
    };
    snapshotReady.current = true;
  }, [
    running,
    loading,
    config.proxy_port,
    config.ssl_insecure,
    config.upstream_proxy,
    config.share,
  ]);

  // Best-effort port occupancy hint. Only checked while the engine is stopped:
  // when it is running, our own share listener legitimately holds the port.
  React.useEffect(() => {
    if (!share.enabled || running || sharePortConflict) {
      setSharePortInUse(false);
      return;
    }
    let cancelled = false;
    invoke<boolean>("check_port_available", { port: share.port })
      .then((available) => {
        if (!cancelled) setSharePortInUse(!available);
      })
      .catch(() => {
        if (!cancelled) setSharePortInUse(false);
      });
    return () => {
      cancelled = true;
    };
  }, [share.enabled, share.port, running, sharePortConflict]);

  React.useEffect(() => {
    return () => {
      resetUpstreamStatus();
    };
  }, [resetUpstreamStatus]);

  React.useEffect(() => {
    if (upstreamStatus === "success" || upstreamStatus === "error") {
      const timer = setTimeout(() => {
        resetUpstreamStatus();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [upstreamStatus, resetUpstreamStatus]);

  return (
    <SettingsSection title={t("settings.network.title")}>
      <SettingsRow title={t("settings.network.port")} description={t("settings.network.port_desc")}>
        <SettingsInput
          value={config.proxy_port}
          onChange={(e) => {
            const val = e.target.value;
            if (/^\d*$/.test(val)) updateProxyPort(val === "" ? 0 : parseInt(val, 10));
          }}
          onBlur={(e) => {
            let port = parseInt(e.target.value, 10) || 9090;
            port = Math.max(1024, Math.min(65535, port));
            updateProxyPort(port);
          }}
          className="w-24"
        />
      </SettingsRow>

      <SettingsRow
        title={t("settings.network.ssl_insecure")}
        description={
          <span className="flex flex-col gap-1">
            <span>{t("settings.network.ssl_insecure_desc")}</span>
            {config.ssl_insecure && (
              <span className="text-destructive inline-flex items-center gap-1 font-medium scale-90 origin-left">
                <AlertTriangle className="w-3 h-3" /> {t("settings.network.mitm_risk")}
              </span>
            )}
          </span>
        }
      >
        <SettingsToggle
          checked={config.ssl_insecure}
          onCheckedChange={(val) => updateSslInsecure(val)}
        />
      </SettingsRow>

      <SettingsRow
        title={t("settings.network.upstream_title")}
        description={t("settings.network.upstream_desc")}
      >
        <SettingsToggle
          checked={config.upstream_proxy?.enabled}
          onCheckedChange={(val) => {
            updateUpstreamProxy({
              ...config.upstream_proxy!,
              enabled: val,
            });
          }}
        />
      </SettingsRow>

      {config.upstream_proxy?.enabled && (
        <div>
          <SettingsRow
            title={t("settings.network.upstream_url")}
            description={t("settings.network.upstream_url_desc")}
          >
            <div className="flex flex-col items-end gap-2">
              <SettingsInput
                value={config.upstream_proxy?.url || ""}
                onChange={(e) => {
                  updateUpstreamProxy({
                    ...config.upstream_proxy!,
                    url: e.target.value,
                  });
                  resetUpstreamStatus();
                }}
                placeholder={t("settings.network.upstream_placeholder")}
                className="w-64"
              />
              <div className="flex items-center gap-2">
                {upstreamStatus !== "idle" && (
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                      upstreamStatus === "success"
                        ? "text-green-600 bg-green-500/10"
                        : "text-destructive bg-destructive/10"
                    }`}
                  >
                    {upstreamStatus === "success" ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    {upstreamStatus === "success"
                      ? t("settings.network.upstream_check_success")
                      : t("settings.network.upstream_check_failed")}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  className="text-xs h-7 px-2 gap-1.5"
                  onClick={testUpstreamConnectivity}
                  disabled={testingUpstream || !config.upstream_proxy?.url}
                >
                  {testingUpstream ? (
                    <RefreshCcw className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCcw className="w-3 h-3" />
                  )}
                  {testingUpstream
                    ? t("settings.network.upstream_checking")
                    : t("settings.network.upstream_check")}
                </Button>
              </div>
            </div>
          </SettingsRow>
        </div>
      )}

      <SettingsRow
        title={t("settings.network.share_title")}
        description={t("settings.network.share_desc")}
      >
        <SettingsToggle
          checked={share.enabled}
          onCheckedChange={(val) => updateShareConfig({ ...share, enabled: val })}
        />
      </SettingsRow>

      {share.enabled && (
        <div>
          <SettingsRow
            title={t("settings.network.share_upstream")}
            description={
              <span className="flex flex-col gap-1">
                <span>{t("settings.network.share_upstream_desc")}</span>
                {shareUpstreamInvalid && (
                  <span className="text-destructive inline-flex items-center gap-1 font-medium scale-90 origin-left">
                    <AlertTriangle className="w-3 h-3" />{" "}
                    {t("settings.network.share_invalid_upstream")}
                  </span>
                )}
              </span>
            }
          >
            <SettingsInput
              value={share.upstream_url}
              onChange={(e) => updateShareConfig({ ...share, upstream_url: e.target.value })}
              placeholder={t("settings.network.share_upstream_placeholder")}
              className="w-64"
            />
          </SettingsRow>

          <SettingsRow
            title={t("settings.network.share_port")}
            description={
              <span className="flex flex-col gap-1">
                <span>{t("settings.network.share_port_desc")}</span>
                {(sharePortConflict || sharePortInUse) && (
                  <span className="text-destructive inline-flex items-center gap-1 font-medium scale-90 origin-left">
                    <AlertTriangle className="w-3 h-3" />{" "}
                    {sharePortConflict
                      ? t("settings.network.share_port_conflict")
                      : t("settings.network.share_port_in_use")}
                  </span>
                )}
              </span>
            }
          >
            <SettingsInput
              value={share.port}
              onChange={(e) => {
                const val = e.target.value;
                if (/^\d*$/.test(val))
                  updateShareConfig({ ...share, port: val === "" ? 0 : parseInt(val, 10) });
              }}
              onBlur={(e) => {
                let port = parseInt(e.target.value, 10) || 9080;
                port = Math.max(1024, Math.min(65535, port));
                updateShareConfig({ ...share, port });
              }}
              className="w-24"
            />
          </SettingsRow>

          <SettingsRow
            title={t("settings.network.share_lan")}
            description={t("settings.network.share_lan_desc")}
          >
            <SettingsToggle
              checked={share.listen_lan}
              onCheckedChange={(val) => updateShareConfig({ ...share, listen_lan: val })}
            />
          </SettingsRow>

          <SettingsRow
            title={t("settings.network.share_url")}
            description={t("settings.network.share_url_desc")}
          >
            <div className="flex items-center gap-2">
              <code className="px-2 py-1 rounded bg-muted text-xs font-mono select-all">
                {shareUrl}
              </code>
              <Button
                variant="outline"
                size="xs"
                className="text-xs h-7 px-2 gap-1.5"
                onClick={handleCopyShareUrl}
              >
                {shareUrlCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {shareUrlCopied
                  ? t("settings.network.share_url_copied")
                  : t("settings.network.share_url_copy")}
              </Button>
            </div>
          </SettingsRow>
        </div>
      )}

      <AnimatePresence>
        {networkChanged && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mx-0 mt-0 flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/8 border-t border-amber-500/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1 rounded-md bg-amber-500/15 text-amber-500 shrink-0">
                  <RefreshCcw className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 leading-tight">
                    {t("settings.network.pending_restart_title")}
                  </p>
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70 leading-tight mt-0.5">
                    {t("settings.network.pending_restart_desc")}
                  </p>
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                onClick={handleRestartEngine}
                disabled={restarting}
                className="shrink-0 h-7 px-3 gap-1.5 text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60"
              >
                <RefreshCcw className={`w-3 h-3 ${restarting ? "animate-spin" : ""}`} />
                {restarting ? t("settings.network.restarting") : t("settings.network.restart_now")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </SettingsSection>
  );
}
