import { useTranslation } from "react-i18next";
import {
  BODY_TRUNCATE_LIMIT,
  SENSITIVE_HEADERS,
  SENSITIVE_QUERY_PARAMS,
  URL_TRUNCATE_LIMIT,
} from "../../../lib/ai/context/utils";
import { SettingsSection } from "../SettingsLayout";

export function SentToAiSection() {
  const { t } = useTranslation();

  return (
    <SettingsSection title={t("privacy.sent.title")}>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground/70 leading-relaxed">{t("privacy.sent.desc")}</p>
        <p className="text-tiny text-muted-foreground/50 leading-relaxed">
          {t("privacy.sent.note")}
        </p>

        <div>
          <div className="text-tiny font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
            {t("privacy.sent.headers_label")}
          </div>
          <div className="flex flex-wrap gap-1">
            {SENSITIVE_HEADERS.map((header) => (
              <code
                key={header}
                className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-tiny font-mono text-muted-foreground"
              >
                {header}
              </code>
            ))}
          </div>
        </div>

        <div>
          <div className="text-tiny font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">
            {t("privacy.sent.params_label")}
          </div>
          <div className="flex flex-wrap gap-1">
            {SENSITIVE_QUERY_PARAMS.map((param) => (
              <code
                key={param}
                className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-tiny font-mono text-muted-foreground"
              >
                {param}
              </code>
            ))}
          </div>
        </div>

        <p className="text-tiny text-muted-foreground/50">
          {t("privacy.sent.truncation", {
            url: URL_TRUNCATE_LIMIT,
            body: BODY_TRUNCATE_LIMIT,
          })}
        </p>
      </div>
    </SettingsSection>
  );
}
