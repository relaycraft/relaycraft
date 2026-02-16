import { AnimatePresence, motion } from "framer-motion";
import { Bot, Plus, Save, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useScriptStore } from "../../stores/scriptStore";
import { useUIStore } from "../../stores/uiStore";
import type { Rule } from "../../types/rules";
import { AIRuleAssistant } from "../ai/AIRuleAssistant";
import { Button } from "../common/Button";
import { ActionBlock } from "./form/actions/ActionBlock";
import { ActionHeader } from "./form/actions/ActionHeader";
import { ActionMapLocal } from "./form/actions/ActionMapLocal";
import { ActionMapRemote } from "./form/actions/ActionMapRemote";
import { ActionRewrite } from "./form/actions/ActionRewrite";
import { ActionThrottle } from "./form/actions/ActionThrottle";
// Form Components
import { BasicInfo } from "./form/BasicInfo";
import { MatchConfig } from "./form/MatchConfig";
import { useRuleEditor } from "./hooks/useRuleEditor";

interface RuleEditorProps {
  rule: Partial<Rule> | null;
  onClose: (force?: boolean) => void;
}

export function RuleEditor({ rule, onClose }: RuleEditorProps) {
  const { t } = useTranslation();
  const { setActiveTab } = useUIStore();
  const { selectScript } = useScriptStore();

  const { draftScriptPrompt } = useUIStore();

  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [, setAssistantDirty] = useState(false);

  useEffect(() => {
    if (draftScriptPrompt) {
      setShowAIAssistant(true);
    }
  }, [draftScriptPrompt]);

  const {
    // State
    name,
    setName,
    ruleType,
    setRuleType,
    groupId,
    setGroupId,
    urlPattern,
    setUrlPattern,
    urlMatchType,
    setUrlMatchType,
    methods,
    setMethods,
    requiredHeaders,
    setRequiredHeaders,
    rewriteTarget,
    setRewriteTarget,
    rewriteType,
    setRewriteType,
    rewriteContent,
    setRewriteContent,
    rewritePattern,
    setRewritePattern,
    rewriteReplacement,
    setRewriteReplacement,
    jsonModifications,
    setJsonModifications,
    rewriteStatusCode,
    setRewriteStatusCode,
    rewriteContentType,
    setRewriteContentType,
    headersRequest,
    setHeadersRequest,
    headersResponse,
    setHeadersResponse,
    mapLocalSource,
    setMapLocalSource,
    localPath,
    setLocalPath,
    mapLocalContent,
    setMapLocalContent,
    contentType,
    setContentType,
    mapLocalStatusCode,
    setMapLocalStatusCode,
    targetUrl,
    setTargetUrl,
    preservePath,
    setPreservePath,
    delayMs,
    setDelayMs,
    packetLoss,
    setPacketLoss,
    bandwidthKbps,
    setBandwidthKbps,

    // Actions
    handleSave,
    handleApplyAIRule,
    getCurrentRuleObject,
  } = useRuleEditor({ rule, onClose });

  const handleClose = () => {
    onClose();
  };

  const handleScriptCreated = (name: string) => {
    onClose(true);
    setActiveTab("scripts");
    setTimeout(() => {
      selectScript(name);
    }, 120);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            {rule?.id ? (
              <Settings2 className="w-4 h-4 text-primary" />
            ) : (
              <Plus className="w-4 h-4 text-primary" />
            )}
          </div>
          <h3 className="text-ui font-semibold text-foreground">
            {rule?.id ? t("rule_editor.title_edit") : t("rule_editor.title_create")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => setShowAIAssistant(!showAIAssistant)}
            className={`gap-1.5 ${showAIAssistant ? "bg-primary/10 text-primary border-primary/20" : ""}`}
          >
            <Bot className="w-3.5 h-3.5" />
            {t("rule_editor.advanced_assistant")}
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {t("common.save")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* AI Assistant Panel */}
      <AnimatePresence>
        {showAIAssistant && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-b border-border/50"
          >
            <AIRuleAssistant
              initialRule={getCurrentRuleObject()}
              onApply={(partialRule) => {
                handleApplyAIRule(partialRule);
                setShowAIAssistant(false);
              }}
              onClose={() => setShowAIAssistant(false)}
              onScriptCreated={handleScriptCreated}
              setIsDirty={setAssistantDirty}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 no-scrollbar bg-card/5 backdrop-blur-3xl relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.02] to-transparent pointer-events-none" />

        {/* 1. Basic Info */}
        <BasicInfo
          name={name}
          onChangeName={setName}
          groupId={groupId}
          onChangeGroup={setGroupId}
          ruleType={ruleType}
          onChangeType={setRuleType}
          context={{ urlPattern, urlMatchType, methods: methods as string[] }}
        />

        {/* 2. Match Conditions */}
        <MatchConfig
          urlPattern={urlPattern}
          onChangeUrlPattern={setUrlPattern}
          urlMatchType={urlMatchType}
          onChangeUrlMatchType={setUrlMatchType}
          methods={methods}
          onChangeMethods={setMethods}
          requiredHeaders={requiredHeaders}
          onChangeHeaders={setRequiredHeaders}
        />

        {/* 3. Action Config */}
        {ruleType !== "block_request" && (
          <section className="space-y-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-1 h-3.5 bg-primary rounded-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.4)]" />
              <span className="text-xs font-bold text-foreground/90 uppercase tracking-widest">
                {t("rule_editor.sections.action")}
              </span>
            </div>

            {ruleType === "rewrite_body" && (
              <ActionRewrite
                target={rewriteTarget}
                onChangeTarget={setRewriteTarget}
                type={rewriteType}
                onChangeType={setRewriteType}
                content={rewriteContent}
                onChangeContent={setRewriteContent}
                statusCode={rewriteStatusCode}
                onChangeStatusCode={setRewriteStatusCode}
                contentType={rewriteContentType}
                onChangeContentType={setRewriteContentType}
                pattern={rewritePattern}
                onChangePattern={setRewritePattern}
                replacement={rewriteReplacement}
                onChangeReplacement={setRewriteReplacement}
                jsonModifications={jsonModifications}
                onChangeJsonModifications={setJsonModifications}
              />
            )}

            {ruleType === "map_local" && (
              <>
                <ActionMapLocal
                  source={mapLocalSource}
                  onChangeSource={setMapLocalSource}
                  localPath={localPath}
                  onChangeLocalPath={setLocalPath}
                  content={mapLocalContent}
                  onChangeContent={setMapLocalContent}
                  statusCode={mapLocalStatusCode}
                  onChangeStatusCode={setMapLocalStatusCode}
                  contentType={contentType}
                  onChangeContentType={setContentType}
                />
                <div className="mt-4">
                  <ActionHeader
                    headersRequest={headersRequest}
                    onChangeHeadersRequest={setHeadersRequest}
                    headersResponse={headersResponse}
                    onChangeHeadersResponse={setHeadersResponse}
                  />
                </div>
              </>
            )}

            {ruleType === "map_remote" && (
              <ActionMapRemote
                targetUrl={targetUrl}
                onChangeTargetUrl={setTargetUrl}
                preservePath={preservePath}
                onChangePreservePath={setPreservePath}
                headersRequest={headersRequest}
                onChangeHeadersRequest={setHeadersRequest}
                headersResponse={headersResponse}
                onChangeHeadersResponse={setHeadersResponse}
              />
            )}

            {ruleType === "throttle" && (
              <ActionThrottle
                delayMs={delayMs}
                onChangeDelayMs={setDelayMs}
                packetLoss={packetLoss}
                onChangePacketLoss={setPacketLoss}
                bandwidthKbps={bandwidthKbps}
                onChangeBandwidthKbps={setBandwidthKbps}
              />
            )}

            {ruleType === "rewrite_header" && (
              <ActionHeader
                headersRequest={headersRequest}
                onChangeHeadersRequest={setHeadersRequest}
                headersResponse={headersResponse}
                onChangeHeadersResponse={setHeadersResponse}
              />
            )}
          </section>
        )}

        {ruleType === "block_request" && (
          <section className="space-y-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-0.5 h-3 bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary-rgb),0.5)]" />
              <span className="text-small font-semibold text-foreground/80 uppercase tracking-widest py-1">
                {t("rule_editor.sections.action")}
              </span>
            </div>
            <ActionBlock />
          </section>
        )}
      </div>
    </div>
  );
}
