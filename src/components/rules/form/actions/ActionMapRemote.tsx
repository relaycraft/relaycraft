import { useTranslation } from 'react-i18next';
import { Input } from '../../../common/Input';
import { Switch } from '../../../common/Switch';
import { ActionHeader } from './ActionHeader';
import { HeaderOperation } from '../../../../types/rules';

interface ActionMapRemoteProps {
    targetUrl: string;
    onChangeTargetUrl: (val: string) => void;
    preservePath: boolean;
    onChangePreservePath: (val: boolean) => void;

    // Headers
    headersRequest: HeaderOperation[];
    onChangeHeadersRequest: (val: HeaderOperation[]) => void;
    headersResponse: HeaderOperation[];
    onChangeHeadersResponse: (val: HeaderOperation[]) => void;
}

const LABEL_STYLE = "text-[11px] font-bold text-foreground/50 uppercase tracking-widest mb-1.5 block";

export function ActionMapRemote({
    targetUrl, onChangeTargetUrl,
    preservePath, onChangePreservePath,
    headersRequest, onChangeHeadersRequest,
    headersResponse, onChangeHeadersResponse
}: ActionMapRemoteProps) {
    const { t } = useTranslation();

    return (
        <div className="space-y-4 p-3.5 bg-muted/20 rounded-xl border border-border/40">
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <label className={LABEL_STYLE}>{t('rule_editor.action.map_remote.url')}</label>
                    <Input
                        type="text"
                        value={targetUrl}
                        onChange={(e) => onChangeTargetUrl(e.target.value)}
                        placeholder="https://example.com"
                        className="font-mono text-xs"
                    />
                </div>

                <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg border border-border/50">
                    <div className="space-y-0.5">
                        <label className="text-xs font-medium text-foreground block">
                            {t('rule_editor.action.map_remote.preserve_path')}
                        </label>
                        <p className="text-[10px] text-muted-foreground">
                            {t('rule_editor.action.map_remote.preserve_path_desc')}
                        </p>
                    </div>
                    <Switch
                        size="sm"
                        checked={preservePath}
                        onCheckedChange={onChangePreservePath}
                    />
                </div>

                <div className="pt-2">
                    <ActionHeader
                        headersRequest={headersRequest} onChangeHeadersRequest={onChangeHeadersRequest}
                        headersResponse={headersResponse} onChangeHeadersResponse={onChangeHeadersResponse}
                    />
                </div>
            </div>
        </div>
    );
}