import type React from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../../components/common/Input";
import { Label } from "../../components/common/Label";
import { Select } from "../../components/common/Select";
import { Switch } from "../../components/common/Switch";
import { cn } from "../../lib/utils";

interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
  title?: string;
}

interface JSONSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  title?: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string; // e.g., 'color', 'email'
}

interface PluginSettingsRendererProps {
  schema: JSONSchema;
  data: Record<string, any>;
  onChange: (newData: Record<string, any>) => void;
  className?: string;
  pluginId: string;
  i18nNamespace?: string;
}

export const PluginSettingsRenderer: React.FC<PluginSettingsRendererProps> = ({
  schema,
  data,
  onChange,
  className,
  pluginId,
  i18nNamespace,
}) => {
  const { t } = useTranslation();

  // Align with pluginLoader.ts derivation logic
  const derivedNamespace = (i18nNamespace || pluginId).replace(/\./g, "_");
  const namespace = derivedNamespace;

  if (!schema?.properties) {
    return (
      <div className="text-muted-foreground text-sm italic">
        {t("plugins.settings.no_schema", "No configuration available for this plugin.")}
      </div>
    );
  }

  const handleChange = (key: string, value: any) => {
    onChange({
      ...data,
      [key]: value,
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {schema.description && (
        <p className="text-[11px] text-muted-foreground/60 mb-2 leading-relaxed px-1">
          {schema.description}
        </p>
      )}

      <div className="space-y-2.5">
        {Object.entries(schema.properties).map(([key, prop]) => {
          const value = data[key] !== undefined ? data[key] : prop.default;

          // I18n resolution
          const titleKey = `settings.${key}.title`;
          const descKey = `settings.${key}.description`;

          const displayTitle = t(`${namespace}:${titleKey}`, {
            defaultValue: prop.title || key,
          });
          const displayDesc = t(`${namespace}:${descKey}`, {
            defaultValue: prop.description,
          });

          return (
            <div key={key} className="space-y-2">
              {/* Boolean (Switch) */}
              {prop.type === "boolean" && (
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-all border border-border/5">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor={key}
                      className="text-system font-semibold text-foreground/90 cursor-pointer"
                    >
                      {displayTitle}
                    </Label>
                    {displayDesc && (
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                        {displayDesc}
                      </p>
                    )}
                  </div>
                  <Switch
                    id={key}
                    checked={value}
                    onCheckedChange={(checked) => handleChange(key, checked)}
                    className="scale-90 data-[state=checked]:bg-primary"
                  />
                </div>
              )}

              {/* String / Number / Enum / Color */}
              {prop.type !== "boolean" && (
                <div className="space-y-2.5 bg-secondary/30 p-3.5 rounded-xl border border-border/5 transition-all">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor={key}
                      className="flex items-center gap-2 text-system font-semibold text-foreground/90"
                    >
                      {displayTitle}
                      {schema.required?.includes(key) && (
                        <span className="text-destructive">*</span>
                      )}
                    </Label>
                    {displayDesc && (
                      <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                        {displayDesc}
                      </p>
                    )}
                  </div>

                  {prop.enum ? (
                    <Select
                      value={String(value)}
                      onChange={(val) =>
                        handleChange(key, prop.type === "number" ? Number(val) : val)
                      }
                      placeholder={t("common.select")}
                      options={prop.enum.map((opt: any) => ({
                        label: String(opt),
                        value: String(opt),
                      }))}
                      className="bg-background shadow-sm h-9 text-[12px]"
                    />
                  ) : (
                    <Input
                      id={key}
                      type={prop.type === "number" || prop.type === "integer" ? "number" : "text"}
                      value={value ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (prop.type === "number" || prop.type === "integer") {
                          const num = parseFloat(val);
                          handleChange(key, Number.isNaN(num) ? undefined : num);
                        } else {
                          handleChange(key, val);
                        }
                      }}
                      placeholder={prop.default ? String(prop.default) : undefined}
                      min={prop.minimum}
                      max={prop.maximum}
                      className="h-9 text-[12px] bg-background border-border/50 shadow-sm focus:border-primary/50 transition-all rounded-lg"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
