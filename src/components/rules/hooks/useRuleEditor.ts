import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRuleStore } from "../../../stores/ruleStore";
import type {
  HeaderOperation,
  HttpMethod,
  JsonModification,
  Rule,
  RuleAction,
  RuleType,
  UrlMatchType,
} from "../../../types/rules";

interface UseRuleEditorProps {
  rule: Partial<Rule> | null;
  onClose: (force?: boolean) => void;
}

export function useRuleEditor({ rule, onClose }: UseRuleEditorProps) {
  const { t } = useTranslation();
  const { addRule, updateRule, setIsEditorDirty, ruleGroups } = useRuleStore();

  // --- 0. Initial Reference for Dirty Check ---
  const [initialRule, setInitialRule] = useState<Partial<Rule> | null>(rule);

  // --- 1. Basic Info State ---
  const [name, setName] = useState(rule?.name || "");
  const [ruleType, setRuleType] = useState<RuleType>(rule?.type || "rewrite_body");
  const [groupId, setGroupId] = useState(() => {
    if (rule?.id) {
      return ruleGroups[rule.id] || "";
    }
    return (rule as any)?.groupId || "";
  });

  // --- 2. Match Config State ---
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
    Array<{
      key: string;
      value?: string;
      matchType: "contains" | "exact" | "regex";
    }>
  >(
    rule?.match?.request
      ?.filter((a) => a.type === "header")
      ?.map((a) => ({
        key: a.key!,
        matchType: (a.matchType as any) || "exact",
        value: a.value as string,
      })) || [],
  );

  // --- 3. Action State ---

  // Rewrite Body
  const [rewriteTarget, setRewriteTarget] = useState<"request" | "response">("response");
  const [rewriteType, setRewriteType] = useState<"replace" | "regex_replace" | "set" | "json">(
    "set",
  );
  const [rewriteContent, setRewriteContent] = useState("");
  const [rewritePattern, setRewritePattern] = useState("");
  const [rewriteReplacement, setRewriteReplacement] = useState("");
  const [jsonModifications, setJsonModifications] = useState<JsonModification[]>([]);
  const [rewriteStatusCode, setRewriteStatusCode] = useState<number | undefined>();
  const [rewriteContentType, setRewriteContentType] = useState<string | undefined>();

  // Headers (Shared)
  const [headersRequest, setHeadersRequest] = useState<HeaderOperation[]>([]);
  const [headersResponse, setHeadersResponse] = useState<HeaderOperation[]>([]);

  // Map Local
  const [mapLocalSource, setMapLocalSource] = useState<"file" | "manual">("file");
  const [localPath, setLocalPath] = useState("");
  const [mapLocalContent, setMapLocalContent] = useState("");
  const [contentType, setContentType] = useState("");
  const [mapLocalStatusCode, setMapLocalStatusCode] = useState(200);

  // Map Remote
  const [targetUrl, setTargetUrl] = useState("");
  const [preservePath, setPreservePath] = useState(false);

  // Throttle
  const [delayMs, setDelayMs] = useState(0);
  const [packetLoss, setPacketLoss] = useState(0);
  const [bandwidthKbps, setBandwidthKbps] = useState(0);

  // Helper to get current rule object (for AI & Save)
  const getCurrentRuleObject = useCallback((): Partial<Rule> => {
    const currentRule: Partial<Rule> = {
      id: rule?.id,
      name,
      type: ruleType,
      execution: {
        enabled: rule?.execution?.enabled ?? true,
        priority: rule?.execution?.priority || 1,
        stopOnMatch: ["map_local", "block_request"].includes(ruleType),
      },
      match: {
        request: [
          { type: "url", matchType: urlMatchType, value: urlPattern },
          ...(methods.length > 0
            ? [{ type: "method", matchType: "exact", value: methods } as any]
            : []),
          ...(requiredHeaders.map((h) => ({
            type: "header",
            key: h.key,
            matchType: h.matchType,
            value: h.value,
          })) as any[]),
        ],
        response: [],
      },
      actions: [] as RuleAction[],
    };

    if (ruleType === "rewrite_body") {
      const validModifications = jsonModifications.filter((m) => m.path.trim() !== "");
      const action: any = {
        type: "rewrite_body",
        target: rewriteTarget,
        statusCode: rewriteStatusCode,
        contentType: rewriteContentType,
      };
      if (rewriteType === "set") {
        action.set = { content: rewriteContent };
      } else if (rewriteType === "replace") {
        action.replace = {
          pattern: rewritePattern,
          replacement: rewriteReplacement,
        };
      } else if (rewriteType === "regex_replace") {
        action.regex_replace = {
          pattern: rewritePattern,
          replacement: rewriteReplacement,
        };
      } else if (rewriteType === "json") {
        action.json = { modifications: validModifications };
      }
      currentRule.actions?.push(action);
    } else if (ruleType === "map_local") {
      // Logic for splitting actions happens at save time usually, but here we just represent the UI state
      // For preview/AI, we return a single logical action if possible, or standard structure
      currentRule.actions?.push({
        type: "map_local",
        source: mapLocalSource,
        localPath: mapLocalSource === "file" ? localPath : undefined,
        content: mapLocalSource === "manual" ? mapLocalContent : undefined,
        contentType: contentType || undefined,
        statusCode: mapLocalStatusCode,
        headers:
          headersRequest.length > 0 || headersResponse.length > 0
            ? {
                request: headersRequest,
                response: headersResponse,
              }
            : undefined,
      });
    } else if (ruleType === "map_remote") {
      currentRule.actions?.push({
        type: "map_remote",
        targetUrl,
        preservePath,
        headers:
          headersRequest.length > 0 || headersResponse.length > 0
            ? {
                request: headersRequest,
                response: headersResponse,
              }
            : undefined,
      });
    } else if (ruleType === "throttle") {
      currentRule.actions?.push({
        type: "throttle",
        delayMs: delayMs > 0 ? delayMs : undefined,
        packetLoss: packetLoss > 0 ? packetLoss : undefined,
        bandwidthKbps: bandwidthKbps > 0 ? bandwidthKbps : undefined,
      });
    } else if (ruleType === "rewrite_header") {
      currentRule.actions?.push({
        type: "rewrite_header",
        headers: {
          request: headersRequest,
          response: headersResponse,
        },
      });
    } else if (ruleType === "block_request") {
      currentRule.actions?.push({
        type: "block_request",
      });
    }

    return currentRule;
  }, [
    rule,
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

  // --- Initialization & Sync ---
  useEffect(() => {
    if (!rule) return;

    setName(rule.name || "");
    setRuleType(rule.type || "rewrite_body");
    const gid = rule.id ? ruleGroups[rule.id] : (rule as any).groupId;
    setGroupId(gid || "Default");

    // Always reset match fields before repopulating
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
          matchType: (a.matchType as any) || "exact",
          value: a.value as string,
        })),
      );
    }

    const actions = rule.actions || [];

    // Reset all action states
    setRewriteTarget("response");
    setRewriteType("set");
    setRewriteContent("");
    setRewritePattern("");
    setRewriteReplacement("");
    setJsonModifications([]);
    setRewriteStatusCode(undefined);
    setRewriteContentType("");
    setMapLocalSource("file");
    setLocalPath("");
    setMapLocalContent("");
    setContentType("");
    setMapLocalStatusCode(200);
    setHeadersRequest([]);
    setHeadersResponse([]);
    setTargetUrl("");
    setPreservePath(false);
    setDelayMs(0);
    setPacketLoss(0);
    setBandwidthKbps(0);

    // Populate from actions
    actions.forEach((a) => {
      if (a.type === "rewrite_body") {
        setRewriteTarget(a.target || "response");

        // Normalize null to undefined for dirty check consistency
        if (a.statusCode !== undefined)
          setRewriteStatusCode(a.statusCode === null ? undefined : a.statusCode);
        if (a.contentType !== undefined)
          setRewriteContentType(a.contentType === null ? undefined : a.contentType);

        if (a.set) {
          setRewriteType("set");
          setRewriteContent(a.set.content);
          if (a.statusCode === undefined && a.set.statusCode) {
            setRewriteStatusCode(a.set.statusCode === null ? undefined : a.set.statusCode);
          }
          if (a.contentType === undefined && a.set.contentType) {
            setRewriteContentType(a.set.contentType === null ? undefined : a.set.contentType);
          }
        } else if (a.replace) {
          setRewriteType("replace");
          setRewritePattern(a.replace.pattern);
          setRewriteReplacement(a.replace.replacement);
        } else if (a.regex_replace) {
          setRewriteType("regex_replace");
          setRewritePattern(a.regex_replace.pattern);
          setRewriteReplacement(a.regex_replace.replacement);
        } else if (a.json) {
          setRewriteType("json");
          setJsonModifications(a.json.modifications);
        }
      } else if (a.type === "map_local") {
        setMapLocalSource(a.source || "file");
        setLocalPath(a.localPath || "");
        setMapLocalContent(a.content || "");
        setContentType(a.contentType || "");
        setMapLocalStatusCode(a.statusCode || 200);
        if (a.headers) {
          if (a.headers.request && a.headers.request.length > 0)
            setHeadersRequest(a.headers.request);
          if (a.headers.response && a.headers.response.length > 0)
            setHeadersResponse(a.headers.response);
        }
      } else if (a.type === "rewrite_header") {
        if (a.headers) {
          if (a.headers.request && a.headers.request.length > 0)
            setHeadersRequest(a.headers.request);
          if (a.headers.response && a.headers.response.length > 0)
            setHeadersResponse(a.headers.response);
        }
      } else if (a.type === "map_remote") {
        setTargetUrl(a.targetUrl || "");
        setPreservePath(a.preservePath ?? false);
        if (a.headers) {
          if (a.headers.request && a.headers.request.length > 0)
            setHeadersRequest(a.headers.request);
          if (a.headers.response && a.headers.response.length > 0)
            setHeadersResponse(a.headers.response);
        }
      } else if (a.type === "throttle") {
        setDelayMs(a.delayMs || 0);
        setPacketLoss(a.packetLoss || 0);
        setBandwidthKbps(a.bandwidthKbps || 0);
      }
    });
  }, [rule, ruleGroups]); // Added ruleGroups to dep array, technically correct

  // --- AI Assistant Handler ---
  const handleApplyAIRule = useCallback((partialRule: Partial<Rule>) => {
    if (!partialRule) return;

    // Update initial rule reference to the new AI rule so that
    // subsequent manual changes are tracked relative to this state,
    // but the current state remains "dirty" until saved.
    setInitialRule(partialRule);

    if (partialRule.name) setName(partialRule.name);
    if (partialRule.type) setRuleType(partialRule.type);

    if (partialRule.match) {
      const atoms = partialRule.match.request || [];
      if (atoms.length > 0) {
        // Try to find URL, Path or Host as they all map to our main URL pattern field
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
              matchType: (a.matchType as any) || "exact",
              value: a.value as string,
            })),
          );
        }
      }
    }

    const actions = partialRule.actions || [];
    actions.forEach((a) => {
      if (a.type === "rewrite_body") {
        setRuleType("rewrite_body"); // Force switch type if action found
        if (a.target) setRewriteTarget(a.target);
        if (a.statusCode !== undefined) setRewriteStatusCode(a.statusCode);
        if (a.contentType !== undefined) setRewriteContentType(a.contentType);

        if (a.set) {
          setRewriteType("set");
          setRewriteContent(a.set.content);
        } else if (a.replace) {
          setRewriteType("replace");
          setRewritePattern(a.replace.pattern);
          setRewriteReplacement(a.replace.replacement);
        } else if (a.regex_replace) {
          setRewriteType("regex_replace");
          setRewritePattern(a.regex_replace.pattern);
          setRewriteReplacement(a.regex_replace.replacement);
        } else if (a.json) {
          setRewriteType("json");
          setJsonModifications(a.json.modifications);
        }
      } else if (a.type === "map_local") {
        setRuleType("map_local");
        if (a.source) setMapLocalSource(a.source);
        if (a.localPath) setLocalPath(a.localPath);
        if (a.content) setMapLocalContent(a.content);
        if (a.contentType) setContentType(a.contentType);
        if (a.statusCode) setMapLocalStatusCode(a.statusCode);
        if (a.headers) {
          setHeadersRequest(a.headers.request || []);
          setHeadersResponse(a.headers.response || []);
        }
      } else if (a.type === "map_remote") {
        setRuleType("map_remote");
        if (a.targetUrl) setTargetUrl(a.targetUrl);
        if (a.preservePath !== undefined) setPreservePath(!!a.preservePath);
        if (a.headers) {
          setHeadersRequest(a.headers.request || []);
          setHeadersResponse(a.headers.response || []);
        }
      } else if (a.type === "throttle") {
        setRuleType("throttle");
        if (a.delayMs) setDelayMs(a.delayMs);
        if (a.packetLoss) setPacketLoss(a.packetLoss);
        if (a.bandwidthKbps) setBandwidthKbps(a.bandwidthKbps);
      } else if (a.type === "rewrite_header") {
        setRuleType("rewrite_header");
        if (a.headers) {
          setHeadersRequest(a.headers.request || []);
          setHeadersResponse(a.headers.response || []);
        }
      } else if (a.type === "block_request") {
        setRuleType("block_request");
      }
    });
  }, []);

  // --- Save Logic ---
  const handleSave = useCallback(() => {
    const actions: any[] = [];

    if (ruleType === "rewrite_body") {
      const validModifications = jsonModifications.filter((m) => m.path.trim() !== "");
      const action: any = {
        type: "rewrite_body",
        target: rewriteTarget,
        statusCode: rewriteStatusCode,
        contentType: rewriteContentType,
      };
      if (rewriteType === "set") {
        action.set = { content: rewriteContent };
      } else if (rewriteType === "replace") {
        action.replace = {
          pattern: rewritePattern,
          replacement: rewriteReplacement,
        };
      } else if (rewriteType === "regex_replace") {
        action.regex_replace = {
          pattern: rewritePattern,
          replacement: rewriteReplacement,
        };
      } else if (rewriteType === "json") {
        action.json = { modifications: validModifications };
      }
      actions.push(action);
    } else if (ruleType === "map_local") {
      // Fix: Split Map Local into two actions if Request Headers are present
      if (headersRequest.length > 0) {
        actions.push({
          type: "rewrite_header",
          headers: {
            request: headersRequest,
            response: [],
          },
        });
      }

      actions.push({
        type: "map_local",
        source: mapLocalSource,
        localPath: mapLocalSource === "file" ? localPath : undefined,
        content: mapLocalSource === "manual" ? mapLocalContent : undefined,
        contentType: contentType || undefined,
        statusCode: mapLocalStatusCode,
        headers:
          headersResponse.length > 0
            ? {
                request: [],
                response: headersResponse,
              }
            : undefined,
      });
    } else if (ruleType === "map_remote") {
      actions.push({
        type: "map_remote",
        targetUrl,
        preservePath,
        headers:
          headersRequest.length > 0 || headersResponse.length > 0
            ? {
                request: headersRequest,
                response: headersResponse,
              }
            : undefined,
      });
    } else if (ruleType === "throttle") {
      actions.push({
        type: "throttle",
        delayMs: delayMs > 0 ? delayMs : undefined,
        packetLoss: packetLoss > 0 ? packetLoss : undefined,
        bandwidthKbps: bandwidthKbps > 0 ? bandwidthKbps : undefined,
      });
    } else if (ruleType === "rewrite_header") {
      actions.push({
        type: "rewrite_header",
        headers: {
          request: headersRequest,
          response: headersResponse,
        },
      });
    } else if (ruleType === "block_request") {
      actions.push({
        type: "block_request",
      });
    }

    let finalName = name.trim();
    if (!finalName) {
      let labelKey = ruleType as string;
      if (ruleType === "rewrite_header") labelKey = "rewrite";
      if (ruleType === "block_request") labelKey = "block";
      if (
        ruleType === "map_local" ||
        ruleType === "map_remote" ||
        ruleType === "throttle" ||
        ruleType === "rewrite_body"
      )
        labelKey = ruleType;

      const rawLabel = t(`rule_editor.core.types.${labelKey}.label`);
      const prettyUrl = urlPattern
        ? urlPattern.length > 30
          ? `${urlPattern.substring(0, 28)}...`
          : urlPattern
        : "Global";
      finalName = `${rawLabel}: ${prettyUrl}`;
    }

    const newRule: Rule = {
      id: rule?.id || `rule-${Date.now()}`,
      name: finalName,
      execution: {
        enabled: rule?.execution?.enabled ?? true,
        priority: rule?.execution?.priority || 1,
        stopOnMatch: ["map_local", "block_request"].includes(ruleType),
      },
      type: ruleType,
      match: {
        request: [
          { type: "url", matchType: urlMatchType, value: urlPattern },
          ...(methods.length > 0
            ? [{ type: "method", matchType: "exact", value: methods } as any]
            : []),
          ...(requiredHeaders.map((h) => ({
            type: "header",
            key: h.key,
            matchType: h.matchType,
            value: h.value,
          })) as any[]),
        ],
        response: [],
      },
      actions,
      tags: rule?.tags,
    };

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
    rewriteTarget,
    rewriteStatusCode,
    rewriteContentType,
    rewriteType,
    rewriteContent,
    rewritePattern,
    rewriteReplacement,
    jsonModifications,
    headersRequest,
    mapLocalSource,
    localPath,
    mapLocalContent,
    contentType,
    mapLocalStatusCode,
    headersResponse,
    targetUrl,
    preservePath,
    delayMs,
    packetLoss,
    bandwidthKbps,
    name,
    urlPattern,
    urlMatchType,
    methods,
    requiredHeaders,
    t,
    groupId,
    updateRule,
    addRule,
    setIsEditorDirty,
    onClose,
  ]);

  // --- Dirty Check ---
  const checkDirty = useCallback(() => {
    // If this is a new rule (no ID), it's dirty if it has any meaningful content
    if (!rule?.id) {
      // Check if any of the fields have been filled with something non-default
      if (name.trim() !== "") return true;
      if (urlPattern.trim() !== "") return true;
      if (methods.length > 0) return true;
      if (requiredHeaders.length > 0) return true;

      // Check actions based on type
      if (ruleType === "map_remote" && targetUrl.trim() !== "") return true;
      if (ruleType === "map_local" && (localPath.trim() !== "" || mapLocalContent.trim() !== ""))
        return true;
      if (
        ruleType === "rewrite_body" &&
        (rewriteContent.trim() !== "" || rewritePattern.trim() !== "")
      )
        return true;
      if (ruleType === "throttle" && (delayMs > 0 || packetLoss > 0 || bandwidthKbps > 0))
        return true;
      if (
        ruleType === "rewrite_header" &&
        (headersRequest.length > 0 || headersResponse.length > 0)
      )
        return true;
    }

    if (name.trim() !== (initialRule?.name || "").trim()) return true;
    if (ruleType !== (initialRule?.type || "rewrite_body")) return true;

    const initialGid = initialRule?.id ? ruleGroups[initialRule.id] : (initialRule as any)?.groupId;
    if ((groupId || "Default") !== (initialGid || "Default")) return true;

    const currentUrlPattern =
      initialRule?.match?.request?.find((a) => a.type === "url")?.value || "";
    const currentUrlMatchType =
      initialRule?.match?.request?.find((a) => a.type === "url")?.matchType || "contains";
    if (urlPattern !== currentUrlPattern) return true;
    if (urlMatchType !== currentUrlMatchType) return true;

    const initialMethods =
      initialRule?.match?.request?.find((a) => a.type === "method")?.value || [];
    if (
      JSON.stringify([...methods].sort()) !==
      JSON.stringify([...(initialMethods as string[])].sort())
    )
      return true;

    const initialRequiredHeaders =
      initialRule?.match?.request
        ?.filter((a) => a.type === "header")
        ?.map((a) => ({
          key: a.key!,
          matchType: (a.matchType as any) || "exact",
          value: a.value as string,
        })) || [];
    if (JSON.stringify(requiredHeaders) !== JSON.stringify(initialRequiredHeaders)) return true;

    const actions = initialRule?.actions || [];
    const initialHeadersReq: HeaderOperation[] = [];
    const initialHeadersRes: HeaderOperation[] = [];
    actions.forEach((a) => {
      const action = a as any;
      if (action.headers) {
        if (action.headers.request) initialHeadersReq.push(...action.headers.request);
        if (action.headers.response) initialHeadersRes.push(...action.headers.response);
      }
    });

    if (ruleType === "rewrite_body") {
      const initialAction = actions.find((a) => a.type === "rewrite_body") as any;
      if (rewriteTarget !== (initialAction?.target || "response")) return true;

      const initialStatusCode = initialAction?.statusCode ?? initialAction?.set?.statusCode;
      const initialContentType = initialAction?.contentType ?? initialAction?.set?.contentType;

      // Normalize null/undefined for comparison
      const currentStatusCode = rewriteStatusCode === null ? undefined : rewriteStatusCode;
      const normalizedInitialStatusCode =
        initialStatusCode === null ? undefined : initialStatusCode;
      if (currentStatusCode !== normalizedInitialStatusCode) return true;

      const currentContentType = rewriteContentType === null ? undefined : rewriteContentType;
      const normalizedInitialContentType =
        initialContentType === null ? undefined : initialContentType;
      if (currentContentType !== normalizedInitialContentType) return true;

      if (rewriteType === "set") {
        if (!initialAction?.set) return true;
        if (rewriteContent !== (initialAction.set.content || "")) return true;
      } else if (rewriteType === "replace") {
        if (!initialAction?.replace) return true;
        if (rewritePattern !== (initialAction.replace.pattern || "")) return true;
        if (rewriteReplacement !== (initialAction.replace.replacement || "")) return true;
      } else if (rewriteType === "regex_replace") {
        if (!initialAction?.regex_replace) return true;
        if (rewritePattern !== (initialAction.regex_replace.pattern || "")) return true;
        if (rewriteReplacement !== (initialAction.regex_replace.replacement || "")) return true;
      } else if (rewriteType === "json") {
        if (!initialAction?.json) return true;
        if (
          JSON.stringify(jsonModifications) !==
          JSON.stringify(initialAction.json.modifications || [])
        )
          return true;
      }
    } else if (ruleType === "map_local") {
      const initialAction = actions.find((a) => a.type === "map_local") as any;
      if (mapLocalSource !== (initialAction?.source || "file")) return true;
      if (localPath !== (initialAction?.localPath || "")) return true;
      if (mapLocalContent !== (initialAction?.content || "")) return true;
      if (contentType !== (initialAction?.contentType || "")) return true;
      if (mapLocalStatusCode !== (initialAction?.statusCode || 200)) return true;
      if (JSON.stringify(headersRequest) !== JSON.stringify(initialHeadersReq)) return true;
      if (JSON.stringify(headersResponse) !== JSON.stringify(initialHeadersRes)) return true;
    } else if (ruleType === "map_remote") {
      const initialAction = actions.find((a) => a.type === "map_remote") as any;
      if (targetUrl !== (initialAction?.targetUrl || "")) return true;
      if (preservePath !== initialAction?.preservePath) return true;
      if (JSON.stringify(headersRequest) !== JSON.stringify(initialHeadersReq)) return true;
      if (JSON.stringify(headersResponse) !== JSON.stringify(initialHeadersRes)) return true;
    } else if (ruleType === "throttle") {
      const initialAction = actions.find((a) => a.type === "throttle") as any;
      if (delayMs !== (initialAction?.delayMs || 0)) return true;
      if (packetLoss !== (initialAction?.packetLoss || 0)) return true;
      if (bandwidthKbps !== (initialAction?.bandwidthKbps || 0)) return true;
    } else if (ruleType === "rewrite_header") {
      if (JSON.stringify(headersRequest) !== JSON.stringify(initialHeadersReq)) return true;
      if (JSON.stringify(headersResponse) !== JSON.stringify(initialHeadersRes)) return true;
    }

    return false;
  }, [
    name,
    ruleType,
    groupId,
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
    rule,
    initialRule,
    ruleGroups,
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
