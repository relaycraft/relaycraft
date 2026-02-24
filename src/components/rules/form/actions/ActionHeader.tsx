import { useTranslation } from "react-i18next";
import type { HeaderOperation } from "../../../../types/rules";
import { HeaderEditor } from "../../HeaderEditor";

interface ActionHeaderProps {
  headersRequest: HeaderOperation[];
  onChangeHeadersRequest: (val: HeaderOperation[]) => void;
  headersResponse: HeaderOperation[];
  onChangeHeadersResponse: (val: HeaderOperation[]) => void;
  // For MapLocal case, we might want to hide response headers editing if needed,
  // but usually we allow editing both.
  showRequest?: boolean;
  showResponse?: boolean;
}

// LABEL_STYLE removed

export function ActionHeader({
  headersRequest,
  onChangeHeadersRequest,
  headersResponse,
  onChangeHeadersResponse,
  showRequest = true,
  showResponse = true,
}: ActionHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 p-3.5 bg-muted/20 rounded-xl border border-border/40">
      <div className="space-y-4">
        {showRequest && (
          <HeaderEditor
            label={t("rules.editor.action.rewrite.req_headers")}
            operations={headersRequest}
            onChange={onChangeHeadersRequest}
          />
        )}
        {showResponse && (
          <HeaderEditor
            label={t("rules.editor.action.rewrite.res_headers")}
            operations={headersResponse}
            onChange={onChangeHeadersResponse}
          />
        )}
      </div>
    </div>
  );
}
