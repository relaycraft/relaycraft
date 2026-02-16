import { CheckCircle, Eye, EyeOff, Loader2, RotateCw, Save, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_PROVIDERS, getProviderById } from "../../lib/ai/providers";
import { useAIStore } from "../../stores/aiStore";
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
    saveSettings,
    testConnection,
    connectionMessage,
  } = useAIStore();

  const [localSettings, setLocalSettings] = useState(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setHasChanges(JSON.stringify(localSettings) !== JSON.stringify(settings));
  }, [localSettings, settings]);

  // Reset connection status if settings change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when settings change
  useEffect(() => {
    if (connectionStatus !== "idle") {
      useAIStore.getState().resetConnectionStatus();
    }
  }, [localSettings]);

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
                const provider = getProviderById(val);
                // Fetch saved key for this provider
                useAIStore
                  .getState()
                  .getProviderKey(val)
                  .then((key) => {
                    setLocalSettings({
                      ...localSettings,
                      provider: val as any,
                      apiKey: key || "", // Use fetched key or empty
                      customEndpoint: undefined,
                      model: provider?.defaultModel || localSettings.model,
                    });
                  });
              }}
              options={AI_PROVIDERS.map((p) => ({
                label: t(`ai.providers.${p.id}`) || p.description || p.id,
                value: p.id,
              }))}
            />
          </SettingsRow>

          {/* Only show Endpoint for Custom provider OR if it differs from default */}
          {(localSettings.provider === "custom" ||
            (localSettings.customEndpoint &&
              localSettings.customEndpoint !==
                getProviderById(localSettings.provider)?.defaultEndpoint)) && (
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
            <SettingsInput
              className="w-48"
              type="text"
              value={localSettings.model}
              onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value })}
              placeholder="gpt-4-turbo"
            />
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
              {connectionStatus !== "idle" && (
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-small font-medium ${
                    connectionStatus === "success"
                      ? "text-green-600 bg-green-500/10"
                      : "text-destructive bg-destructive/10"
                  }`}
                >
                  {connectionStatus === "success" ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" />
                  )}
                  {connectionStatus === "success"
                    ? t("ai.connection.success")
                    : t("ai.connection.failure")}
                </div>
              )}
              {connectionStatus !== "idle" &&
                connectionMessage &&
                !connectionMessage.toLowerCase().includes("success") && (
                  <div
                    className="text-caption text-muted-foreground/60 max-w-[200px] truncate"
                    title={connectionMessage}
                  >
                    {connectionMessage}
                  </div>
                )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={testConnection}
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
