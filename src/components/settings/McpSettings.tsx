import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { Button } from "../common/Button";
import { SettingsInput, SettingsRow, SettingsSection, SettingsToggle } from "./SettingsLayout";

interface McpStatus {
  running: boolean;
  port: number;
}

export function McpSettings() {
  const { t } = useTranslation();
  const { config, updateMcpConfig } = useSettingsStore();
  const mcp = config.mcp_config ?? { enabled: false, port: 7090 };

  const [status, setStatus] = React.useState<McpStatus>({ running: false, port: mcp.port });
  const [portInput, setPortInput] = React.useState(String(mcp.port));
  const [copied, setCopied] = React.useState(false);
  const [token, setToken] = React.useState("");

  // Fetch the Bearer token once on mount
  React.useEffect(() => {
    invoke<string>("get_mcp_token")
      .then(setToken)
      .catch(() => {});
  }, []);

  // Poll MCP server status every 3 s while this panel is mounted
  React.useEffect(() => {
    let active = true;
    const poll = () => {
      invoke<McpStatus>("get_mcp_status")
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Keep port input in sync with config changes
  React.useEffect(() => {
    setPortInput(String(mcp.port));
  }, [mcp.port]);

  const handleToggle = async (enabled: boolean) => {
    await updateMcpConfig({ ...mcp, enabled });
    // Refresh status shortly after toggling
    setTimeout(() => {
      invoke<McpStatus>("get_mcp_status")
        .then(setStatus)
        .catch(() => {});
    }, 400);
  };

  const handlePortBlur = () => {
    let port = parseInt(portInput, 10);
    if (Number.isNaN(port) || port < 1024 || port > 65535) port = 7090;
    setPortInput(String(port));
    if (port !== mcp.port) updateMcpConfig({ ...mcp, port });
  };

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        relaycraft: {
          type: "http",
          url: `http://localhost:${status.port}/mcp`,
          headers: {
            Authorization: token ? `Bearer ${token}` : "Bearer <token>",
          },
        },
      },
    },
    null,
    2,
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 pb-24">
      <SettingsSection title={t("mcp.section_title")}>
        {/* Enable toggle with live status badge */}
        <SettingsRow title={t("mcp.enable")} description={t("mcp.enable_desc")}>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                status.running ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
              }`}
            >
              {status.running ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {status.running
                ? t("mcp.status_running", { port: status.port })
                : t("mcp.status_stopped")}
            </span>
            <SettingsToggle checked={mcp.enabled} onCheckedChange={handleToggle} />
          </div>
        </SettingsRow>

        {/* Port */}
        <SettingsRow title={t("mcp.port")} description={t("mcp.port_desc")}>
          <SettingsInput
            value={portInput}
            onChange={(e) => {
              if (/^\d*$/.test(e.target.value)) setPortInput(e.target.value);
            }}
            onBlur={handlePortBlur}
            className="w-24"
          />
        </SettingsRow>

        {/* Privacy notice — always visible, matches the subtle info style used elsewhere */}
        <div className="px-4 py-3 flex items-start gap-2.5">
          <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground/55 leading-relaxed">
            {t("mcp.privacy_notice")}
          </p>
        </div>
      </SettingsSection>

      {/* Config snippet for pasting into Claude Desktop / Cursor */}
      <SettingsSection
        title={t("mcp.config_snippet")}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs font-medium"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-500">{t("mcp.copied")}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                {t("mcp.copy_config")}
              </>
            )}
          </Button>
        }
      >
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            {t("mcp.config_snippet_desc")}
          </p>
          <pre className="text-xs font-mono bg-muted/40 border border-border/40 rounded-lg p-3 overflow-x-auto leading-relaxed text-foreground/80 select-all">
            {configSnippet}
          </pre>
        </div>
      </SettingsSection>
    </div>
  );
}
