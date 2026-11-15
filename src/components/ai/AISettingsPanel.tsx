import {
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Radio,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROVIDERS } from "../../lib/ai/providers";
import { Logger } from "../../lib/logger";
import { useAIStore } from "../../stores/aiStore";
import { useUIStore } from "../../stores/uiStore";
import type { AiKeyStatus } from "../../types/ai";
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
  const settings = useAIStore((state) => state.settings);
  const loading = useAIStore((state) => state.loading);
  const testingConnection = useAIStore((state) => state.testingConnection);
  const connectionStatus = useAIStore((state) => state.connectionStatus);
  const loadSettings = useAIStore((state) => state.loadSettings);
  const loadProfiles = useAIStore((state) => state.loadProfiles);
  const saveSettings = useAIStore((state) => state.saveSettings);
  const probeCapabilities = useAIStore((state) => state.probeCapabilities);
  const getKeyStatus = useAIStore((state) => state.getKeyStatus);
  const deleteKey = useAIStore((state) => state.deleteKey);
  const showConfirm = useUIStore((state) => state.showConfirm);
  const connectionMessage = useAIStore((state) => state.connectionMessage);
  const profiles = useAIStore((state) => state.profiles);
  const capabilityProbe = useAIStore((state) => state.capabilityProbe);

  const [localSettings, setLocalSettings] = useState(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const prevConnectionFingerprintRef = useRef("");
  // The stored key is never sent to the frontend: the input only holds what
  // the user types, and saved-key state comes from get_ai_key_status.
  const [typedKey, setTypedKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<AiKeyStatus | null>(null);
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
    setHasChanges(
      JSON.stringify(localSettings) !== JSON.stringify(settings) || typedKey.length > 0,
    );
  }, [localSettings, settings, typedKey]);

  // Load saved-key status whenever the selected provider changes.
  useEffect(() => {
    const provider = localSettings.provider;
    let cancelled = false;
    getKeyStatus(provider).then((status) => {
      if (!cancelled && status.provider === provider) {
        setKeyStatus(status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [localSettings.provider, getKeyStatus]);

  useEffect(() => {
    if (localSettings.provider !== "custom") {
      return;
    }
    setCustomDraft({
      apiKey: typedKey,
      customEndpoint: localSettings.customEndpoint || "",
      model: localSettings.model || "",
    });
  }, [localSettings.provider, localSettings.customEndpoint, localSettings.model, typedKey]);

  const connectionFingerprint = JSON.stringify({
    provider: localSettings.provider,
    profileId: localSettings.profileId,
    adapterMode: localSettings.adapterMode,
    customEndpoint: localSettings.customEndpoint,
    apiKey: typedKey,
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

  const refreshKeyStatus = (provider: string) => {
    getKeyStatus(provider).then(setKeyStatus);
  };

  const handleSave = async () => {
    try {
      // An empty typed key means "keep the stored one" — the backend only
      // persists non-empty keys.
      await saveSettings({ ...localSettings, apiKey: typedKey });
      setTypedKey("");
      refreshKeyStatus(localSettings.provider);
    } catch (error) {
      Logger.error("Save error:", error);
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

  const handleRemoveKey = () => {
    const provider = localSettings.provider;
    showConfirm({
      title: t("ai.api_key_remove_confirm_title"),
      message: t("ai.api_key_remove_confirm_msg", { provider }),
      variant: "warning",
      confirmLabel: t("ai.api_key_remove"),
      onConfirm: () => {
        deleteKey(provider)
          .then(() => {
            setTypedKey("");
            refreshKeyStatus(provider);
          })
          .catch((error) => {
            Logger.error("Failed to remove AI key:", error);
            alert(t("ai.api_key_remove_failed"));
          });
      },
    });
  };

  const handleTestConnection = async () => {
    try {
      if (hasChanges) {
        await saveSettings({ ...localSettings, apiKey: typedKey });
        setTypedKey("");
        refreshKeyStatus(localSettings.provider);
      }
      await probeCapabilities();
    } catch (error) {
      Logger.error("Connection test failed:", error);
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
              Logger.error("Failed to save AI enable status", e);
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
                      apiKey: "",
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

                // The key input always starts empty for a different provider;
                // the custom draft restores only the still-unsaved typed key.
                setTypedKey(providerId === "custom" ? customDraft.apiKey : "");
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
            <div className="flex items-center gap-2">
              <div className="relative">
                <SettingsInput
                  className="w-64 pr-8 placeholder:font-sans"
                  type={showApiKey ? "text" : "password"}
                  value={typedKey}
                  onChange={(e) => setTypedKey(e.target.value)}
                  placeholder={
                    keyStatus?.hasKey
                      ? t("ai.api_key_saved_placeholder", { masked: keyStatus.masked })
                      : localSettings.provider === "openai"
                        ? t("ai.connection.placeholder_openai")
                        : t("ai.connection.placeholder_optional")
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              {keyStatus?.hasKey && (
                <button
                  type="button"
                  onClick={handleRemoveKey}
                  aria-label={t("ai.api_key_remove")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow title={t("ai.model")} description={t("ai.model_desc")}>
            <div className="relative w-64">
              <SettingsInput
                className="w-64 pr-10"
                type="text"
                value={localSettings.model}
                onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value })}
                placeholder="gpt-5.6-luna"
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
                  (localSettings.provider !== "custom" && !typedKey && !keyStatus?.hasKey)
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
