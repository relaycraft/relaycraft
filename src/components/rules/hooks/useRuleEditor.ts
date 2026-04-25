import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuleStore } from "../../../stores/ruleStore";
import type {
  HeaderOperation,
  HttpMethod,
  JsonModification,
  Rule,
  RuleType,
  UrlMatchType,
} from "../../../types/rules";
import {
  isMapLocalAction,
  isMapRemoteAction,
  isRewriteBodyAction,
  isThrottleAction,
} from "../../../types/rules";
import { checkIsDirty } from "./ruleEditorDirtyCheck";
import {
  type ActionState,
  buildActionsForPreview,
  buildActionsForSave,
  buildMatchRequest,
  buildRuleForPreview,
  buildRuleForSave,
  parseActionsToState,
} from "./ruleEditorSerialization";

interface UseRuleEditorProps {
  rule: Partial<Rule> | null;
  onClose: (force?: boolean) => void;
}

export function useRuleEditor({ rule, onClose }: UseRuleEditorProps) {
  const { t } = useTranslation();
  const { addRule, updateRule, setIsEditorDirty, ruleGroups } = useRuleStore();

  // --- Initial Reference for Dirty Check ---
  const [initialRule, setInitialRule] = useState<Partial<Rule> | null>(rule);

  // --- Basic Info ---
  const [name, setName] = useState(rule?.name || "");
  const [ruleType, setRuleType] = useState<RuleType>(rule?.type || "rewrite_body");
  const [groupId, setGroupId] = useState(() => {
    if (rule?.id) {
      return ruleGroups[rule.id] || "";
    }
    return "";
  });

  // --- Match Config ---
  const [urlPattern, setUrlPattern] = useState(
    (rule?.match?.request?.find((a) => a.type === "url")?.value as string) || "",
  );
  const [urlMatchType, setUrlMatchType] = useState<UrlMatchType>(
    (rule?.match?.request?.find((a) => a.type === "url")?.matchType as UrlMatchType) || "contains",
  );
  const [methods, setMethods] = useState<HttpMethod[]>(
    (rule?.match?.request?.find((a) => a.type === "method")?.value as HttpMethod[]) || [],
  );
  const [requiredHeaders, setRequiredHeaders] = useState<
    Array<{ key: string; value?: string; matchType: "contains" | "exact" | "regex" }>
  >(
    rule?.match?.request
      ?.filter((a) => a.type === "header")
      ?.map((a) => ({
        key: a.key!,
        matchType: (a.matchType as "contains" | "exact" | "regex") || "exact",
        value: a.value as string,
      })) || [],
  );

  // --- Action States (initialized from prop) ---
  const parsed = parseActionsToState(rule?.actions || []);
  const [rewriteTarget, setRewriteTarget] = useState<"request" | "response">(parsed.rewriteTarget);
  const [rewriteType, setRewriteType] = useState<"set" | "replace" | "regex_replace" | "json">(
    parsed.rewriteType,
  );
  const [rewriteContent, setRewriteContent] = useState(parsed.rewriteContent);
  const [rewritePattern, setRewritePattern] = useState(parsed.rewritePattern);
  const [rewriteReplacement, setRewriteReplacement] = useState(parsed.rewriteReplacement);
  const [jsonModifications, setJsonModifications] = useState<JsonModification[]>(
    parsed.jsonModifications,
  );
  const [rewriteStatusCode, setRewriteStatusCode] = useState<number | undefined>(
    parsed.rewriteStatusCode,
  );
  const [rewriteContentType, setRewriteContentType] = useState<string | undefined>(
    parsed.rewriteContentType,
  );
  const [headersRequest, setHeadersRequest] = useState<HeaderOperation[]>(parsed.headersRequest);
  const [headersResponse, setHeadersResponse] = useState<HeaderOperation[]>(parsed.headersResponse);
  const [mapLocalSource, setMapLocalSource] = useState<"file" | "manual">(parsed.mapLocalSource);
  const [localPath, setLocalPath] = useState(parsed.localPath);
  const [mapLocalContent, setMapLocalContent] = useState(parsed.mapLocalContent);
  const [contentType, setContentType] = useState(parsed.contentType);
  const [mapLocalStatusCode, setMapLocalStatusCode] = useState(parsed.mapLocalStatusCode);
  const [targetUrl, setTargetUrl] = useState(parsed.targetUrl);
  const [preservePath, setPreservePath] = useState(parsed.preservePath);
  const [delayMs, setDelayMs] = useState(parsed.delayMs);
  const [packetLoss, setPacketLoss] = useState(parsed.packetLoss);
  const [bandwidthKbps, setBandwidthKbps] = useState(parsed.bandwidthKbps);

  // --- Helper: get action state bundle ---
  const getActionState = useCallback(
    (): ActionState => ({
      rewriteBody: {
        target: rewriteTarget,
        type: rewriteType,
        content: rewriteContent,
        pattern: rewritePattern,
        replacement: rewriteReplacement,
        modifications: jsonModifications,
        statusCode: rewriteStatusCode,
        contentType: rewriteContentType,
      },
      mapLocal: {
        source: mapLocalSource,
        localPath,
        content: mapLocalContent,
        contentType,
        statusCode: mapLocalStatusCode,
      },
      mapRemote: { targetUrl, preservePath },
      throttle: { delayMs, packetLoss, bandwidthKbps },
      headersRequest,
      headersResponse,
    }),
    [
      rewriteTarget,
      rewriteType,
      rewriteContent,
      rewritePattern,
      rewriteReplacement,
      jsonModifications,
      rewriteStatusCode,
      rewriteContentType,
      mapLocalSource,
      localPath,
      mapLocalContent,
      contentType,
      mapLocalStatusCode,
      targetUrl,
      preservePath,
      delayMs,
      packetLoss,
      bandwidthKbps,
      headersRequest,
      headersResponse,
    ],
  );

  // --- Build Current Rule Object (for AI & preview) ---
  const getCurrentRuleObject = useCallback((): Partial<Rule> => {
    const matchRequest = buildMatchRequest(urlPattern, urlMatchType, methods, requiredHeaders);
    const actions = buildActionsForPreview(ruleType, getActionState());
    return buildRuleForPreview(rule, name, ruleType, matchRequest, actions);
  }, [rule, name, ruleType, urlPattern, urlMatchType, methods, requiredHeaders, getActionState]);

  // --- Sync State from Rule Prop ---
  useEffect(() => {
    if (!rule) return;

    setName(rule.name || "");
    setRuleType(rule.type || "rewrite_body");
    const gid = rule.id ? ruleGroups[rule.id] : undefined;
    setGroupId(gid || "Default");

    setUrlPattern("");
    setUrlMatchType("contains");
    setMethods([]);
    setRequiredHeaders([]);

    if (rule.match) {
      const atoms = rule.match.request || [];
      const urlAtom = atoms.find((a) => a.type === "url");
      setUrlPattern((urlAtom?.value as string) || "");
      setUrlMatchType((urlAtom?.matchType as UrlMatchType) || "contains");

      const methodAtom = atoms.find((a) => a.type === "method");
      setMethods((methodAtom?.value as HttpMethod[]) || []);

      const headerAtoms = atoms.filter((a) => a.type === "header");
      setRequiredHeaders(
        headerAtoms.map((a) => ({
          key: a.key!,
          matchType: (a.matchType as "contains" | "exact" | "regex") || "exact",
          value: a.value as string,
        })),
      );
    }

    // Reset + populate action states
    const s = parseActionsToState(rule.actions || []);
    setRewriteTarget(s.rewriteTarget);
    setRewriteType(s.rewriteType);
    setRewriteContent(s.rewriteContent);
    setRewritePattern(s.rewritePattern);
    setRewriteReplacement(s.rewriteReplacement);
    setJsonModifications(s.jsonModifications);
    setRewriteStatusCode(s.rewriteStatusCode);
    setRewriteContentType(s.rewriteContentType);
    setMapLocalSource(s.mapLocalSource);
    setLocalPath(s.localPath);
    setMapLocalContent(s.mapLocalContent);
    setContentType(s.contentType);
    setMapLocalStatusCode(s.mapLocalStatusCode);
    setHeadersRequest(s.headersRequest);
    setHeadersResponse(s.headersResponse);
    setTargetUrl(s.targetUrl);
    setPreservePath(s.preservePath);
    setDelayMs(s.delayMs);
    setPacketLoss(s.packetLoss);
    setBandwidthKbps(s.bandwidthKbps);
  }, [rule, ruleGroups]);

  // --- AI Assistant Handler ---
  const handleApplyAIRule = useCallback((partialRule: Partial<Rule>) => {
    if (!partialRule) return;
    setInitialRule(partialRule);

    if (partialRule.name) setName(partialRule.name);
    if (partialRule.type) setRuleType(partialRule.type);

    if (partialRule.match) {
      const atoms = partialRule.match.request || [];
      if (atoms.length > 0) {
        const urlAtom = atoms.find(
          (a) => a.type === "url" || a.type === "path" || a.type === "host",
        );
        if (urlAtom) {
          setUrlPattern((urlAtom.value as string) || "");
          setUrlMatchType((urlAtom.matchType as UrlMatchType) || "contains");
        }
        const methodAtom = atoms.find((a) => a.type === "method");
        if (methodAtom) setMethods((methodAtom.value as HttpMethod[]) || []);

        const headerAtoms = atoms.filter((a) => a.type === "header");
        if (headerAtoms.length > 0) {
          setRequiredHeaders(
            headerAtoms.map((a) => ({
              key: a.key!,
              matchType: (a.matchType as "contains" | "exact" | "regex") || "exact",
              value: a.value as string,
            })),
          );
        }
      }
    }

    // Parse and apply actions
    const s = parseActionsToState(partialRule.actions || []);
    if (partialRule.actions?.length) {
      // Force rule type to match the first recognized action
      const firstAction = partialRule.actions[0];
      if (isRewriteBodyAction(firstAction)) setRuleType("rewrite_body");
      else if (isMapLocalAction(firstAction)) setRuleType("map_local");
      else if (isMapRemoteAction(firstAction)) setRuleType("map_remote");
      else if (isThrottleAction(firstAction)) setRuleType("throttle");
      else if (firstAction.type === "rewrite_header") setRuleType("rewrite_header");
      else if (firstAction.type === "block_request") setRuleType("block_request");
    }

    setRewriteTarget(s.rewriteTarget);
    setRewriteType(s.rewriteType);
    setRewriteContent(s.rewriteContent);
    setRewritePattern(s.rewritePattern);
    setRewriteReplacement(s.rewriteReplacement);
    setJsonModifications(s.jsonModifications);
    setRewriteStatusCode(s.rewriteStatusCode);
    setRewriteContentType(s.rewriteContentType);
    setMapLocalSource(s.mapLocalSource);
    setLocalPath(s.localPath);
    setMapLocalContent(s.mapLocalContent);
    setContentType(s.contentType);
    setMapLocalStatusCode(s.mapLocalStatusCode);
    setHeadersRequest(s.headersRequest);
    setHeadersResponse(s.headersResponse);
    setTargetUrl(s.targetUrl);
    setPreservePath(s.preservePath);
    setDelayMs(s.delayMs);
    setPacketLoss(s.packetLoss);
    setBandwidthKbps(s.bandwidthKbps);
  }, []);

  // --- Save Logic ---
  const handleSave = useCallback(() => {
    const matchRequest = buildMatchRequest(urlPattern, urlMatchType, methods, requiredHeaders);
    const actions = buildActionsForSave(ruleType, getActionState());

    let finalName = name.trim();
    if (!finalName) {
      let labelKey = ruleType as string;
      if (ruleType === "rewrite_header") labelKey = "rewrite";
      if (ruleType === "block_request") labelKey = "block";
      const rawLabel = t(`rules.editor.core.types.${labelKey}_label`);
      const prettyUrl = urlPattern
        ? urlPattern.length > 30
          ? `${urlPattern.substring(0, 28)}...`
          : urlPattern
        : "Global";
      finalName = `${rawLabel}: ${prettyUrl}`;
    }

    const newRule = buildRuleForSave(rule, finalName, ruleType, matchRequest, actions);

    if (rule?.id) {
      updateRule(rule.id, newRule, groupId);
    } else {
      addRule(newRule, groupId);
    }

    setIsEditorDirty(false);
    onClose(true);
  }, [
    rule,
    ruleType,
    name,
    urlPattern,
    urlMatchType,
    methods,
    requiredHeaders,
    groupId,
    t,
    getActionState,
    updateRule,
    addRule,
    setIsEditorDirty,
    onClose,
  ]);

  // --- Dirty Check ---
  const checkDirty = useCallback(() => {
    return checkIsDirty({
      initialRule,
      rule,
      ruleGroups,
      groupId,
      name,
      ruleType,
      urlPattern,
      urlMatchType,
      methods,
      requiredHeaders,
      rewriteTarget,
      rewriteType,
      rewriteContent,
      rewritePattern,
      rewriteReplacement,
      jsonModifications,
      rewriteStatusCode,
      rewriteContentType,
      mapLocalSource,
      localPath,
      mapLocalContent,
      contentType,
      mapLocalStatusCode,
      headersRequest,
      headersResponse,
      targetUrl,
      preservePath,
      delayMs,
      packetLoss,
      bandwidthKbps,
    });
  }, [
    initialRule,
    rule,
    ruleGroups,
    groupId,
    name,
    ruleType,
    urlPattern,
    urlMatchType,
    methods,
    requiredHeaders,
    rewriteTarget,
    rewriteType,
    rewriteContent,
    rewritePattern,
    rewriteReplacement,
    jsonModifications,
    rewriteStatusCode,
    rewriteContentType,
    mapLocalSource,
    localPath,
    mapLocalContent,
    contentType,
    mapLocalStatusCode,
    headersRequest,
    headersResponse,
    targetUrl,
    preservePath,
    delayMs,
    packetLoss,
    bandwidthKbps,
  ]);

  useEffect(() => {
    setIsEditorDirty(checkDirty());
    return () => setIsEditorDirty(false);
  }, [checkDirty, setIsEditorDirty]);

  return {
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
  };
}
