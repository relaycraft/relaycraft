import {
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Radio,
  RotateCcw,
  RotateCw,
  Save,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROVIDERS } from "../../lib/ai/providers";
import { useAIStore } from "../../stores/aiStore";
import { Tooltip } from "../common/Tooltip";
import {
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsToggle,
} from "../settings/SettingsLayout";

export function AISettingsPanel() {
  const { t } = useTranslation();
  const {
    settings,
    loading,
    testingConnection,
    connectionStatus,
    loadSettings,
    loadProfiles,
    saveSettings,
    probeCapabilities,
    connectionMessage,
    profiles,
    capabilityProbe,
  } = useAIStore();

  const [localSettings, setLocalSettings] = useState(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const prevConnectionFingerprintRef = useRef("");
  const [customDraft, setCustomDraft] = useState({
    apiKey: "",
    customEndpoint: "",
    model: "",
  });

  useEffect(() => {
    loadSettings();
    loadProfiles();
  }, [loadProfiles, loadSettings]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setHasChanges(JSON.stringify(localSettings) !== JSON.stringify(settings));
  }, [localSettings, settings]);

  useEffect(() => {
    if (localSettings.provider !== "custom") {
      return;
    }
    setCustomDraft({
      apiKey: localSettings.apiKey || "",
      customEndpoint: localSettings.customEndpoint || "",
      model: localSettings.model || "",
    });
  }, [
    localSettings.provider,
    localSettings.apiKey,
    localSettings.customEndpoint,
    localSettings.model,
  ]);

  const connectionFingerprint = JSON.stringify({
    provider: localSettings.provider,
    profileId: localSettings.profileId,
    adapterMode: localSettings.adapterMode,
    customEndpoint: localSettings.customEndpoint,
    apiKey: localSettings.apiKey,
    model: localSettings.model,
  });

  // Reset connection status only when connection-critical config changes.
  // Keep probe result when tuning non-connectivity params (temperature/tokens/history).
  useEffect(() => {
    const prevFingerprint = prevConnectionFingerprintRef.current;
    if (
      prevFingerprint &&
      prevFingerprint !== connectionFingerprint &&
      connectionStatus !== "idle"
    ) {
      useAIStore.getState().resetConnectionStatus();
    }
    prevConnectionFingerprintRef.current = connectionFingerprint;
  }, [connectionFingerprint, connectionStatus]);

  const handleSave = async () => {
    try {
      await saveSettings(localSettings);
    } catch (error) {
      console.error("Save error:", error);
      alert(
        t("ai.connection.save") +
          " Failed: " +
          (error instanceof Error ? error.message : JSON.stringify(error)),
      );
    }
  };

  const visibleProfiles = profiles.filter((profile) => profile.supportLevel === "verified");

  const providerProfiles = visibleProfiles.filter(
    (profile) => profile.providerId === localSettings.provider,
  );

  const activeProfile =
    providerProfiles.find((profile) => profile.id === localSettings.profileId) ||
    providerProfiles[0];
  const preferredDefaultModel = activeProfile?.defaultModel || "";

  const handleTestConnection = async () => {
    try {
      if (hasChanges) {
        await saveSettings(localSettings);
      }
      await probeCapabilities();
    } catch (error) {
      console.error("Connection test failed:", error);
    }
  };
  const hasAnyCapabilityIcon =
    Boolean(capabilityProbe?.stream.ok) || Boolean(capabilityProbe?.tools.ok);
  const canResetModel =
    Boolean(preferredDefaultModel) && localSettings.model !== preferredDefaultModel;

  const statusText = testingConnection
    ? t("ai.connection.checking")
    : connectionStatus === "success"
      ? t("ai.connection.success")
      : connectionStatus === "error"
        ? t("ai.connection.failure")
        : t("ai.connection.idle");
  const statusClassName = testingConnection
    ? "text-muted-foreground bg-muted/20"
    : connectionStatus === "success"
      ? "text-green-600 bg-green-500/10"
      : connectionStatus === "error"
        ? "text-destructive bg-destructive/10"
        : "text-muted-foreground bg-muted/20";

  return (
    <SettingsSection title={t("ai.title")}>
      <SettingsRow title={t("ai.enable")} description={t("ai.enable_desc")}>
        <SettingsToggle
          checked={localSettings.enabled}
          onCheckedChange={async (val) => {
            const newSettings = { ...localSettings, enabled: val };
            setLocalSettings(newSettings);
            // Immediate save for the enable toggle
            try {
              await saveSettings(newSettings);
            } catch (e) {
              console.error("Failed to save AI enable status", e);
            }
          }}
        />
      </SettingsRow>

      {localSettings.enabled && (
        <>
          <SettingsRow title={t("ai.provider")} description={t("ai.provider_desc")}>
            <SettingsSelect
              value={localSettings.provider}
              onChange={(val) => {
                const providerId = val;
                const nextProfile = visibleProfiles.find(
                  (profile) => profile.providerId === providerId,
                );

                setLocalSettings((prev) => {
                  if (providerId === "custom") {
                    return {
                      ...prev,
                      provider: "custom",
                      profileId: undefined,
                      adapterMode: "openai_compatible",
                      apiKey: customDraft.apiKey,
                      customEndpoint: customDraft.customEndpoint,
                      model: customDraft.model,
                    };
                  }

                  return {
                    ...prev,
                    provider: providerId as any,
                    profileId: nextProfile?.id,
                    adapterMode: nextProfile?.adapterMode,
                    apiKey: "",
                    customEndpoint: undefined,
                    model: nextProfile?.defaultModel || prev.model,
                  };
                });

                // Fetch saved key for this provider
                useAIStore
                  .getState()
                  .getProviderKey(providerId)
                  .then((key) => {
                    setLocalSettings((prev) => {
                      if (prev.provider !== providerId) {
                        return prev;
                      }

                      if (providerId === "custom") {
                        return {
                          ...prev,
                          apiKey: key || prev.apiKey || "",
                        };
                      }

                      return {
                        ...prev,
                        apiKey: key || "",
                      };
                    });
                  });
              }}
              options={AI_PROVIDERS.map((p) => ({
                label: t(`ai.providers.${p.id}`) || p.description || p.id,
                value: p.id,
              }))}
            />
          </SettingsRow>

          {localSettings.provider !== "custom" && (
            <SettingsRow title={t("ai.profile")} description={t("ai.profile_desc")}>
              <SettingsSelect
                className="w-64"
                value={activeProfile?.id || ""}
                onChange={(val) => {
                  const profile = providerProfiles.find((p) => p.id === val);
                  if (!profile) {
                    return;
                  }
                  setLocalSettings({
                    ...localSettings,
                    profileId: profile.id,
                    adapterMode: profile.adapterMode,
                    customEndpoint: undefined,
                    model: profile.defaultModel || localSettings.model,
                  });
                }}
                options={providerProfiles.map((p) => ({
                  label: p.label,
                  value: p.id,
                }))}
              />
            </SettingsRow>
          )}

          {/* Only show Endpoint for Custom provider OR if it differs from default */}
          {(localSettings.provider === "custom" ||
            (localSettings.customEndpoint &&
              localSettings.customEndpoint !== activeProfile?.baseUrl)) && (
            <SettingsRow title={t("ai.endpoint")} description={t("ai.endpoint_desc")}>
              <SettingsInput
                className="w-full min-w-[320px]"
                type="url"
                value={localSettings.customEndpoint || ""}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    customEndpoint: e.target.value,
                  })
                }
                placeholder="https://api.openai.com/v1"
              />
            </SettingsRow>
          )}

          <SettingsRow title={t("ai.api_key")} description={t("ai.api_key_desc")}>
            <div className="relative flex items-center gap-2">
              <SettingsInput
                className="w-64 pr-8 placeholder:font-sans"
                type={showApiKey ? "text" : "password"}
                value={localSettings.apiKey}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    apiKey: e.target.value,
                  })
                }
                placeholder={
                  localSettings.provider === "openai"
                    ? t("ai.connection.placeholder_openai")
                    : t("ai.connection.placeholder_optional")
                }
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow title={t("ai.model")} description={t("ai.model_desc")}>
            <div className="relative w-64">
              <SettingsInput
                className="w-64 pr-10"
                type="text"
                value={localSettings.model}
                onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value })}
                placeholder="gpt-5-mini"
              />
              {preferredDefaultModel && (
                <button
                  type="button"
                  onClick={() =>
                    setLocalSettings({
                      ...localSettings,
                      model: preferredDefaultModel,
                    })
                  }
                  disabled={!canResetModel}
                  aria-label={t("ai.model_reset")}
                  className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Tooltip content={t("ai.model_reset")}>
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Tooltip>
                </button>
              )}
            </div>
          </SettingsRow>

          {/* Advanced Params */}
          <SettingsRow title={t("ai.temperature")} description={t("ai.temperature_desc")}>
            <div className="flex items-center gap-3 min-w-[140px]">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={localSettings.temperature}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    temperature: parseFloat(e.target.value),
                  })
                }
                className="flex-1 h-1.5 bg-muted-foreground/20 rounded-lg appearance-none cursor-pointer outline-none transition-all hover:bg-muted-foreground/30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_5px_rgba(59,130,246,0.6)] [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary-foreground/20 [&::-webkit-slider-thumb]:cursor-grab active:[&::-webkit-slider-thumb]:cursor-grabbing"
                style={{
                  background: `linear-gradient(to right, var(--color-primary) ${(localSettings.temperature / 2) * 100}%, var(--color-border) ${(localSettings.temperature / 2) * 100}%)`,
                }}
              />
              <span className="text-xs font-mono w-8 text-right">{localSettings.temperature}</span>
            </div>
          </SettingsRow>

          <SettingsRow title={t("ai.max_tokens")} description={t("ai.max_tokens_desc")}>
            <SettingsInput
              className="w-20"
              type="number"
              value={localSettings.maxTokens}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  maxTokens: parseInt(e.target.value, 10),
                })
              }
            />
          </SettingsRow>

          <SettingsRow title={t("ai.memory_turns")} description={t("ai.memory_turns_desc")}>
            <SettingsInput
              className="w-20"
              type="number"
              min="0"
              max="50"
              value={localSettings.maxHistoryMessages}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  maxHistoryMessages: parseInt(e.target.value, 10),
                })
              }
            />
          </SettingsRow>

          {/* Actions Row - Only visible when enabled */}
          <div className="flex items-center justify-between p-3 bg-muted/10 border-t border-border/40">
            <div className="flex items-center gap-2">
              {/* Connection Status */}
              <div
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${statusClassName}`}
              >
                {testingConnection ? (
                  <RotateCw className="w-3.5 h-3.5" />
                ) : connectionStatus === "success" ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : connectionStatus === "error" ? (
                  <XCircle className="w-3.5 h-3.5" />
                ) : (
                  <RotateCw className="w-3.5 h-3.5" />
                )}
                {statusText}
              </div>
              {connectionStatus === "success" && !testingConnection && hasAnyCapabilityIcon && (
                <div className="inline-flex h-8 items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1.5 text-muted-foreground">
                  {capabilityProbe?.stream.ok && (
                    <Tooltip content={t("ai.capabilities.stream_tooltip")}>
                      <span className="rounded p-1 transition-colors hover:bg-muted/60">
                        <Radio className="w-3.5 h-3.5" />
                      </span>
                    </Tooltip>
                  )}
                  {capabilityProbe?.tools.ok && (
                    <Tooltip content={t("ai.capabilities.tools_tooltip")}>
                      <span className="rounded p-1 transition-colors hover:bg-muted/60">
                        <Wrench className="w-3.5 h-3.5" />
                      </span>
                    </Tooltip>
                  )}
                </div>
              )}
              {connectionStatus !== "idle" &&
                connectionMessage &&
                !connectionMessage.toLowerCase().includes("success") &&
                connectionMessage.toLowerCase() !== "connection failed" && (
                  <div
                    className="text-xs text-muted-foreground/60 max-w-[200px] truncate"
                    title={connectionMessage}
                  >
                    {connectionMessage}
                  </div>
                )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={
                  testingConnection ||
                  (localSettings.provider !== "custom" && !localSettings.apiKey)
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
              >
                {testingConnection ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCw className="w-3.5 h-3.5" />
                )}
                {t("ai.connection.test")}
              </button>

              {hasChanges && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-primary-foreground bg-primary hover:bg-primary/90 rounded-md shadow-sm transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  {t("ai.connection.save")}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
