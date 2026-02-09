import { useTranslation } from "react-i18next";

interface HeadersViewProps {
  headers: Record<string, string>;
}

export function HeadersView({ headers }: HeadersViewProps) {
  const { t } = useTranslation();
  const entries = Object.entries(headers);

  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground italic">{t("common.no_content")}</div>;
  }

  return (
    <div className="bg-background rounded border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 uppercase tracking-tight">
          <tr>
            <th className="text-left p-2 font-bold w-1/3 text-xs text-muted-foreground/70">
              {t("common.name")}
            </th>
            <th className="text-left p-2 font-bold text-xs text-muted-foreground/70">
              {t("common.value")}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value], index) => (
            <tr key={index} className="border-t border-border hover:bg-muted/50 transition">
              <td
                className="px-2 font-mono text-xs break-all text-foreground/80"
                style={{
                  paddingTop: "var(--density-p, 8px)",
                  paddingBottom: "var(--density-p, 8px)",
                }}
              >
                {name}
              </td>
              <td
                className="px-2 font-mono text-xs break-all text-foreground/90"
                style={{
                  paddingTop: "var(--density-p, 8px)",
                  paddingBottom: "var(--density-p, 8px)",
                }}
              >
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
