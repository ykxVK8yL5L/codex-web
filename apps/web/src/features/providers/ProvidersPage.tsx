import React, { useEffect, useState } from "react";
import { Activity, History, MoreHorizontal, Pencil, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSearchInput, FilterToolbar } from "@/components/FilterControls";
import { IconText } from "@/components/IconText";
import { PageHeader } from "@/components/PageHeader";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAppDialog } from "@/components/AppDialog";
import { formatShortDate, formatTokens } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import type { CreateProviderRequest, PageResponse, PayloadRewriteRule, PayloadRewriteSettings, ProviderCapabilities, ProviderDetectionResponse, ProviderHealthCheck, ProviderModelsResponse, ProviderSummary, ProviderTestResponse, TokenUsageResponse, UpdateProviderRequest } from "@codex-web/protocol";

type TFunction = (key: TranslationKey) => string;
type ToastTone = "info" | "success" | "error";
type PayloadRuleDraft = PayloadRewriteRule & { removeParamsText: string };

export function ProvidersPage({
  sessionToken,
  providers,
  onChange,
  t,
  notify,
  onOpenMainNav,
}: {
  sessionToken: string;
  providers: ProviderSummary[];
  onChange: () => Promise<void>;
  t: TFunction;
  notify: (message: string, tone?: ToastTone) => void;
  onOpenMainNav?: () => void;
}) {
  const dialog = useAppDialog(t);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderSummary["kind"]>("openai-compatible-chat");
  const [defaultModel, setDefaultModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [rpmLimit, setRpmLimit] = useState("");
  const [rpmLimitEnabled, setRpmLimitEnabled] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [capabilities, setCapabilities] = useState<ProviderCapabilities>({
    responsesApi: false,
    chatCompletions: true,
    tools: true,
    jsonMode: true,
    vision: false,
    streaming: true,
  });
  const [message, setMessage] = useState("");
  const [testingProviderId, setTestingProviderId] = useState("");
  const [detectingProviderInterfaceId, setDetectingProviderInterfaceId] = useState("");
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResponse>>({});
  const [discoveringProviderId, setDiscoveringProviderId] = useState("");
  const [modelResults, setModelResults] = useState<Record<string, ProviderModelsResponse>>({});
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});
  const [modelVisible, setModelVisible] = useState<Record<string, number>>({});
  const [discoveringDraftModels, setDiscoveringDraftModels] = useState(false);
  const [detectingDraftInterface, setDetectingDraftInterface] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [draftModels, setDraftModels] = useState<ProviderModelsResponse | null>(null);
  const [discoveringEditModels, setDiscoveringEditModels] = useState(false);
  const [clearingHealthProviderId, setClearingHealthProviderId] = useState("");
  const [editModels, setEditModels] = useState<ProviderModelsResponse | null>(null);
  const [providerModelPicker, setProviderModelPicker] = useState<{
    target: "draft" | "edit";
    title: string;
    result: ProviderModelsResponse;
  } | null>(null);
  const [healthPanel, setHealthPanel] = useState<{ provider: ProviderSummary; checks: ProviderHealthCheck[] | null; cursor?: string | null; hasMore?: boolean } | null>(null);
  const [editPanel, setEditPanel] = useState<{
    provider: ProviderSummary;
    name: string;
    kind: ProviderSummary["kind"];
    defaultModel: string;
    baseUrl: string;
    apiKey: string;
    rpmLimit: string;
    rpmLimitEnabled: boolean;
    useProxy: boolean;
    capabilities: ProviderCapabilities;
  } | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [providerKindFilter, setProviderKindFilter] = useState<ProviderSummary["kind"] | "all">("all");
  const [providerUsage, setProviderUsage] = useState<Record<string, TokenUsageResponse>>({});
  const [payloadRulesOpen, setPayloadRulesOpen] = useState(false);
  const [payloadRewriteSettings, setPayloadRewriteSettings] = useState<PayloadRewriteSettings | null>(null);
  const [payloadRuleDrafts, setPayloadRuleDrafts] = useState<PayloadRuleDraft[]>([]);
  const [savingPayloadRules, setSavingPayloadRules] = useState(false);
  const capabilityItems: Array<{ key: keyof ProviderCapabilities; label: string }> = [
    { key: "responsesApi", label: t("provider.capabilityResponses") },
    { key: "chatCompletions", label: t("provider.capabilityChat") },
    { key: "tools", label: t("provider.capabilityTools") },
    { key: "jsonMode", label: t("provider.capabilityJson") },
    { key: "vision", label: t("provider.capabilityVision") },
    { key: "streaming", label: t("provider.capabilityStreaming") },
  ];
  const providerSearchText = providerSearch.trim().toLowerCase();
  const visibleProviders = providers.filter((provider) => {
    if (providerKindFilter !== "all" && provider.kind !== providerKindFilter) return false;
    if (!providerSearchText) return true;
    return [
      provider.name,
      provider.kind,
      provider.defaultModel,
      provider.baseUrl ?? "",
      provider.rpmLimitEnabled && provider.rpmLimit ? `${t("provider.rpmLimit")} ${provider.rpmLimit}` : t("provider.rpmDisabled"),
      provider.useProxy ? t("provider.proxyLocal") : t("provider.proxyDirect"),
      provider.apiKeyConfigured ? t("provider.keyConfigured") : t("provider.keyMissing"),
    ].some((value) => value.toLowerCase().includes(providerSearchText));
  });
  useEffect(() => {
    let cancelled = false;
    const headers = { authorization: `Bearer ${sessionToken}` };
    Promise.all(providers.map(async (provider) => {
      const response = await fetch(`/api/usage?providerId=${encodeURIComponent(provider.id)}&limit=3`, { headers });
      if (!response.ok) return null;
      return [provider.id, await response.json()] as const;
    })).then((items) => {
      if (cancelled) return;
      setProviderUsage(Object.fromEntries(items.filter(Boolean) as Array<readonly [string, TokenUsageResponse]>));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [providers, sessionToken]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/payload-rewrite", { headers: { authorization: `Bearer ${sessionToken}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((settings: PayloadRewriteSettings | null) => {
        if (cancelled || !settings) return;
        setPayloadRewriteSettings(settings);
        setPayloadRuleDrafts(payloadRulesToDraft(settings.rules));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  function showError(value: string) {
    setMessage(value);
    notify(value, "error");
  }

  function payloadRulesToDraft(rules?: PayloadRewriteRule[]): PayloadRuleDraft[] {
    return (rules ?? []).map((rule, index) => ({
      id: rule.id || `payload-rule-${index + 1}`,
      enabled: rule.enabled !== false,
      providerKind: rule.providerKind ?? "all",
      modelPattern: rule.modelPattern,
      removeParams: rule.removeParams ?? [],
      removeParamsText: (rule.removeParams ?? []).join(", "),
      setParamsJson: rule.setParamsJson ?? "",
    }));
  }

  function payloadRulesFromDraft(rules: PayloadRuleDraft[]) {
    return rules.map((rule, index): PayloadRewriteRule => ({
      id: rule.id || `payload-rule-${index + 1}`,
      enabled: rule.enabled !== false,
      providerKind: rule.providerKind ?? "all",
      modelPattern: rule.modelPattern.trim(),
      removeParams: rule.removeParamsText.split(",").map((item) => item.trim()).filter(Boolean),
      setParamsJson: rule.setParamsJson?.trim() ?? "",
    })).filter((rule) => rule.modelPattern);
  }

  function addPayloadRule() {
    setPayloadRuleDrafts((current) => [
      ...current,
      {
        id: `payload-rule-${Date.now()}`,
        enabled: true,
        providerKind: "all",
        modelPattern: "",
        removeParams: [],
        removeParamsText: "",
        setParamsJson: "",
      },
    ]);
  }

  function updatePayloadRule(index: number, patch: Partial<PayloadRuleDraft>) {
    setPayloadRuleDrafts((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  function removePayloadRule(index: number) {
    setPayloadRuleDrafts((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
  }

  async function savePayloadRewriteSettings(event: React.FormEvent) {
    event.preventDefault();
    const rules = payloadRulesFromDraft(payloadRuleDrafts);
    for (const rule of rules) {
      try {
        new RegExp(rule.modelPattern);
      } catch {
        notify(t("settings.payloadRuleInvalidRegex"), "error");
        return;
      }
      if (rule.setParamsJson?.trim()) {
        try {
          const parsed = JSON.parse(rule.setParamsJson) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_payload_rule");
        } catch {
          notify(t("settings.payloadRuleInvalidJson"), "error");
          return;
        }
      }
    }
    setSavingPayloadRules(true);
    try {
      const response = await fetch("/api/settings/payload-rewrite", {
        method: "PATCH",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      if (!response.ok) throw new Error("payload_rewrite_save_failed");
      const settings = (await response.json()) as PayloadRewriteSettings;
      setPayloadRewriteSettings(settings);
      setPayloadRuleDrafts(payloadRulesToDraft(settings.rules));
      notify(t("settings.payloadRewriteSaved"), "success");
      setPayloadRulesOpen(false);
    } catch {
      notify(t("settings.payloadRewriteSaveFailed"), "error");
    } finally {
      setSavingPayloadRules(false);
    }
  }

  async function providerError(response: Response, fallback: string) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return payload?.error ?? `${fallback}: http_${response.status}`;
  }

  function openProviderModelPicker(target: "draft" | "edit", result: ProviderModelsResponse) {
    setProviderModelPicker({
      target,
      title: target === "draft" ? t("provider.createTitle") : editPanel?.provider.name ?? t("provider.editTitle"),
      result,
    });
  }

  function selectProviderModelFromDialog(model: string) {
    if (!providerModelPicker) return;
    if (providerModelPicker.target === "draft") {
      setDefaultModel(model);
    } else {
      setEditPanel((current) => current ? { ...current, defaultModel: model } : current);
    }
    setProviderModelPicker(null);
  }

  async function createProvider(event: React.FormEvent) {
    event.preventDefault();
    if (savingProvider || detectingDraftInterface) return;
    setSavingProvider(true);
    setMessage("");
    if (kind !== "local" && !apiKey.trim()) {
      showError(t("provider.apiKeyRequired"));
      setSavingProvider(false);
      return;
    }
    if (rpmLimitEnabled && !rpmLimit.trim()) {
      showError(t("provider.rpmRequired"));
      setSavingProvider(false);
      return;
    }
    let detectedKind = kind;
    let detectedCapabilities = capabilities;
    if (kind !== "local") {
      setDetectingDraftInterface(true);
      const detected = await requestDraftInterfaceDetection();
      setDetectingDraftInterface(false);
      if (detected?.ok) {
        detectedKind = detected.kind;
        detectedCapabilities = detected.capabilities;
        setKind(detectedKind);
        setCapabilities(detectedCapabilities);
      } else {
        notify(detected?.error ?? t("provider.detectFailed"), "info");
      }
    }
    if (detectedKind === "openai-compatible-chat" && !baseUrl.trim()) {
      showError(t("provider.baseUrlRequired"));
      setSavingProvider(false);
      return;
    }
    const body: CreateProviderRequest = {
      name,
      kind: detectedKind,
      defaultModel,
      baseUrl,
      apiKey,
      capabilities: detectedCapabilities,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: detectedKind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("provider.createFailed"));
      setSavingProvider(false);
      return;
    }
    setName("");
    setDefaultModel("");
    setBaseUrl("");
    setApiKey("");
    setRpmLimit("");
    setRpmLimitEnabled(false);
    setUseProxy(false);
    setCapabilities(defaultProviderCapabilitiesForKind(detectedKind));
    setDraftModels(null);
    setCreatePanelOpen(false);
    await onChange();
    setSavingProvider(false);
    notify(t("provider.created"), "success");
  }

  async function testProvider(providerId: string) {
    setTestingProviderId(providerId);
    const response = await fetch(`/api/providers/${providerId}/test`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as ProviderTestResponse)
      : {
          ok: false,
          providerId,
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_test_failed"),
        };
    setTestResults((items) => ({ ...items, [providerId]: result }));
    setTestingProviderId("");
  }

  async function detectProviderInterface(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    setDetectingProviderInterfaceId(providerId);
    const response = await fetch(`/api/providers/${providerId}/detect`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as { provider: ProviderSummary; detection: ProviderDetectionResponse })
      : null;
    if (!result?.detection.ok) {
      showError(result?.detection.error ?? await providerError(response, "provider_detection_failed"));
      setDetectingProviderInterfaceId("");
      return;
    }
    const currentCapabilities = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) };
    const detectedCapabilities = result.detection.capabilities;
    const capabilitiesChanged = capabilityItems.some((item) => currentCapabilities[item.key] !== detectedCapabilities[item.key]);
    const kindChanged = provider.kind !== result.detection.kind;
    if (kindChanged || capabilitiesChanged) {
      const kindLabel = (value: ProviderSummary["kind"]) => value === "openai-responses" ? t("provider.kindResponses") : value === "openai-compatible-chat" ? t("provider.kindCompatible") : t("provider.kindLocal");
      const confirmed = await dialog.confirm({
        title: t("provider.applyDetectionTitle"),
        message: t("provider.applyDetectionMessage")
          .replace("{current}", kindLabel(provider.kind))
          .replace("{detected}", kindLabel(result.detection.kind)),
        confirmLabel: t("provider.applyDetection"),
      });
      if (!confirmed) {
        const messageKey = result.detection.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
        notify(t(messageKey), "info");
        setDetectingProviderInterfaceId("");
        return;
      }
      const applyResponse = await fetch(`/api/providers/${providerId}/detect?apply=1`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
        },
      });
      if (!applyResponse.ok) {
        showError(await providerError(applyResponse, "provider_detection_apply_failed"));
        setDetectingProviderInterfaceId("");
        return;
      }
    }
    await onChange();
    const messageKey = result.detection.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
    notify(t(messageKey), "success");
    setDetectingProviderInterfaceId("");
  }

  async function discoverModels(providerId: string) {
    setDiscoveringProviderId(providerId);
    const response = await fetch(`/api/providers/${providerId}/models?refresh=1`, {
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    const result = response.ok
      ? ((await response.json()) as ProviderModelsResponse)
      : {
          ok: false,
          providerId,
          models: [],
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_models_failed"),
        };
    setModelResults((items) => ({ ...items, [providerId]: result }));
    if (result.ok) await onChange();
    setDiscoveringProviderId("");
  }

  async function discoverDraftModels() {
    setDiscoveringDraftModels(true);
    setMessage("");
    const body: CreateProviderRequest = {
      name: name || t("provider.draftName"),
      kind,
      defaultModel,
      baseUrl,
      apiKey,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: kind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers/models", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = response.ok
      ? ((await response.json()) as ProviderModelsResponse)
      : {
          ok: false,
          providerId: "draft",
          models: [],
          status: response.status,
          durationMs: 0,
          error: await providerError(response, "provider_models_failed"),
    };
    setDraftModels(result);
    openProviderModelPicker("draft", result);
    if (result.models[0] && !defaultModel) setDefaultModel(result.models[0]);
    setDiscoveringDraftModels(false);
  }

  async function discoverEditProviderModels() {
    if (!editPanel) return;
    setDiscoveringEditModels(true);
    setMessage("");
    const useDraftConfig = Boolean(editPanel.apiKey.trim()) || !editPanel.provider.apiKeyConfigured;
    let result: ProviderModelsResponse;
    if (useDraftConfig) {
      const body: CreateProviderRequest = {
        name: editPanel.name || editPanel.provider.name || t("provider.draftName"),
        kind: editPanel.kind,
        defaultModel: editPanel.defaultModel,
        baseUrl: editPanel.baseUrl,
        apiKey: editPanel.apiKey,
        rpmLimit: editPanel.rpmLimit.trim() ? Number(editPanel.rpmLimit) : null,
        rpmLimitEnabled: editPanel.rpmLimitEnabled,
        useProxy: editPanel.kind === "openai-responses" && editPanel.useProxy,
        capabilities: editPanel.capabilities,
      };
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      result = response.ok
        ? ((await response.json()) as ProviderModelsResponse)
        : {
            ok: false,
            providerId: editPanel.provider.id,
            models: [],
            status: response.status,
            durationMs: 0,
            error: await providerError(response, "provider_models_failed"),
          };
    } else {
      const response = await fetch(`/api/providers/${editPanel.provider.id}/models?refresh=1`, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      result = response.ok
        ? ((await response.json()) as ProviderModelsResponse)
        : {
            ok: false,
            providerId: editPanel.provider.id,
            models: [],
            status: response.status,
            durationMs: 0,
            error: await providerError(response, "provider_models_failed"),
          };
    }
    setEditModels(result);
    openProviderModelPicker("edit", result);
    if (result.models[0] && !editPanel.defaultModel) {
      setEditPanel((current) => current ? { ...current, defaultModel: result.models[0] } : current);
    }
    if (result.ok) await onChange();
    setDiscoveringEditModels(false);
  }

  async function requestDraftInterfaceDetection() {
    const body: CreateProviderRequest = {
      name: name || t("provider.draftName"),
      kind,
      defaultModel,
      baseUrl,
      apiKey,
      capabilities,
      rpmLimit: rpmLimit.trim() ? Number(rpmLimit) : null,
      rpmLimitEnabled,
      useProxy: kind === "openai-responses" && useProxy,
    };
    const response = await fetch("/api/providers/detect", {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return response.ok
      ? ((await response.json()) as ProviderDetectionResponse)
      : {
          ok: false,
          providerId: "draft",
          kind,
          capabilities,
          durationMs: 0,
          checks: {
            responses: { ok: false, status: response.status },
            chatCompletions: { ok: false, status: response.status },
          },
          error: await providerError(response, "provider_detection_failed"),
        };
  }

  async function detectDraftInterface() {
    setDetectingDraftInterface(true);
    setMessage("");
    const result = await requestDraftInterfaceDetection();
    if (!result.ok) {
      showError(result.error ?? t("provider.detectFailed"));
      setDetectingDraftInterface(false);
      return;
    }
    setKind(result.kind);
    setCapabilities(result.capabilities);
    const messageKey = result.kind === "openai-responses" ? "provider.detectedResponses" : "provider.detectedChat";
    setMessage(t(messageKey));
    notify(t(messageKey), "success");
    setDetectingDraftInterface(false);
  }

  async function applyDefaultModel(providerId: string, model: string) {
    const body: UpdateProviderRequest = { defaultModel: model };
    const response = await fetch(`/api/providers/${providerId}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) await onChange();
    if (response.ok) notify(t("provider.updated"), "success");
  }

  function defaultProviderCapabilitiesForKind(nextKind: ProviderSummary["kind"]): ProviderCapabilities {
    return {
      responsesApi: nextKind === "openai-responses",
      chatCompletions: nextKind === "openai-compatible-chat" || nextKind === "local",
      tools: nextKind !== "local",
      jsonMode: nextKind !== "local",
      vision: false,
      streaming: true,
    };
  }

  async function toggleProviderCapability(provider: ProviderSummary, key: keyof ProviderCapabilities) {
    const nextCapabilities = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}), [key]: !(provider.capabilities ?? defaultProviderCapabilitiesForKind(provider.kind))[key] };
    const body: UpdateProviderRequest = { capabilities: nextCapabilities };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  async function toggleProviderProxy(provider: ProviderSummary) {
    const body: UpdateProviderRequest = { useProxy: !provider.useProxy };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  async function toggleProviderRpmLimit(provider: ProviderSummary) {
    const body: UpdateProviderRequest = { rpmLimitEnabled: !provider.rpmLimitEnabled };
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      await onChange();
      notify(t("provider.updated"), "success");
    }
  }

  function openEditProvider(provider: ProviderSummary) {
    setEditModels(provider.models?.length ? {
      ok: true,
      providerId: provider.id,
      models: provider.models,
      status: null,
      durationMs: 0,
    } : null);
    setEditPanel({
      provider,
      name: provider.name,
      kind: provider.kind,
      defaultModel: provider.defaultModel,
      baseUrl: provider.baseUrl ?? "",
      apiKey: "",
      rpmLimit: provider.rpmLimit ? String(provider.rpmLimit) : "",
      rpmLimitEnabled: provider.rpmLimitEnabled ?? false,
      useProxy: provider.useProxy ?? false,
      capabilities: { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) },
    });
  }

  async function saveEditedProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!editPanel) return;
    if (!editPanel.name.trim() || !editPanel.defaultModel.trim()) {
      showError(t("provider.createFailed"));
      return;
    }
    if (editPanel.kind === "openai-compatible-chat" && !editPanel.baseUrl.trim()) {
      showError(t("provider.baseUrlRequired"));
      return;
    }
    if (editPanel.kind !== "local" && !editPanel.provider.apiKeyConfigured && !editPanel.apiKey.trim()) {
      showError(t("provider.apiKeyRequired"));
      return;
    }
    if (editPanel.rpmLimitEnabled && !editPanel.rpmLimit.trim()) {
      showError(t("provider.rpmRequired"));
      return;
    }
    const body: UpdateProviderRequest = {
      name: editPanel.name.trim(),
      kind: editPanel.kind,
      defaultModel: editPanel.defaultModel.trim(),
      baseUrl: editPanel.baseUrl,
      rpmLimit: editPanel.rpmLimit.trim() ? Number(editPanel.rpmLimit) : null,
      rpmLimitEnabled: editPanel.rpmLimitEnabled,
      useProxy: editPanel.kind === "openai-responses" && editPanel.useProxy,
      capabilities: editPanel.capabilities,
    };
    if (editPanel.apiKey.trim()) body.apiKey = editPanel.apiKey;
    const response = await fetch(`/api/providers/${editPanel.provider.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      showError(t("provider.updateFailed"));
      return;
    }
    setEditPanel(null);
    setEditModels(null);
    await onChange();
    notify(t("provider.updated"), "success");
  }

  function renderModelPicker(key: string, result: ProviderModelsResponse, selectedModel: string, onSelect: (model: string) => void, onClose?: () => void) {
    const query = modelSearch[key]?.trim().toLowerCase() ?? "";
    const visible = modelVisible[key] ?? 20;
    const models = result.models.filter((model) => !query || model.toLowerCase().includes(query));
    return (
      <div className="model-list">
        <div className="model-list-head">
          <span>{result.models.length ? String(result.models.length) : t("provider.noModels")}</span>
          {onClose && <button className="ghost-button icon-only" type="button" title={t("action.close")} aria-label={t("action.close")} onClick={onClose}><X size={14} /></button>}
        </div>
        {result.models.length > 8 && (
          <input name="modelsearch-key"
            className="model-search"
            value={modelSearch[key] ?? ""}
            onChange={(event) => {
              setModelSearch((items) => ({ ...items, [key]: event.target.value }));
              setModelVisible((items) => ({ ...items, [key]: 20 }));
            }}
            placeholder={t("provider.searchModels")}
          />
        )}
        {models.length === 0 && <span className="result-error">{result.error ?? t("provider.noModels")} · {result.status ?? t("provider.noStatus")} · {result.durationMs}ms</span>}
        {models.slice(0, visible).map((model) => (
          <button className="model-chip" type="button" key={model} onClick={() => onSelect(model)}>
            {model === selectedModel ? "✓ " : ""}{model}
          </button>
        ))}
        {models.length > visible && (
          <button className="ghost-button load-more" type="button" onClick={() => setModelVisible((items) => ({ ...items, [key]: visible + 20 }))}>{t("session.loadMore")}</button>
        )}
      </div>
    );
  }

  async function deleteProvider(providerId: string, providerName: string) {
    const confirmed = await dialog.confirm({
      title: t("provider.deleteProvider"),
      message: providerName,
      confirmLabel: t("action.delete"),
      danger: true,
    });
    if (!confirmed) return;
    const response = await fetch(`/api/providers/${providerId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
    });
    if (!response.ok) return;
    setTestResults((items) => {
      const next = { ...items };
      delete next[providerId];
      return next;
    });
    setModelResults((items) => {
      const next = { ...items };
      delete next[providerId];
      return next;
    });
    await onChange();
    notify(t("provider.deleted"), "success");
  }

  async function openProviderHealth(provider: ProviderSummary, older = false) {
    if (!older) setHealthPanel({ provider, checks: null });
    const cursor = older && healthPanel?.provider.id === provider.id ? healthPanel.cursor : null;
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/providers/${provider.id}/health?${params}`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    if (!response.ok) return;
    const page = (await response.json()) as PageResponse<ProviderHealthCheck>;
    setHealthPanel((current) => ({
      provider,
      checks: older && current?.provider.id === provider.id ? [...(current.checks ?? []), ...page.items] : page.items,
      cursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }

  async function clearProviderHealth(provider: ProviderSummary) {
    const confirmed = await dialog.confirm({
      title: t("provider.clearHealthHistory"),
      message: provider.name,
      confirmLabel: t("provider.clearHealthHistory"),
      danger: true,
    });
    if (!confirmed) return;
    setClearingHealthProviderId(provider.id);
    try {
      const response = await fetch(`/api/providers/${provider.id}/health`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) throw new Error(await providerError(response, "provider_clear_health_failed"));
      setHealthPanel((current) => current?.provider.id === provider.id
        ? { provider, checks: [], cursor: null, hasMore: false }
        : current);
      notify(t("provider.healthCleared"), "success");
    } catch (error) {
      showError(error instanceof Error ? error.message : t("provider.healthClearFailed"));
    } finally {
      setClearingHealthProviderId("");
    }
  }

  return (
    <main className="management-page provider-page">
      {dialog.node}
      <PageHeader crumb={`${t("page.global")} / ${t("nav.providers")}`} title={t("page.providers")} action={t("action.refresh")} onAction={() => void onChange()} onOpenMainNav={onOpenMainNav} menuLabel={t("nav.providers")} />
      <section className="management-layout">
        <form className="management-form" onSubmit={createProvider}>
          <strong>{t("provider.createTitle")}</strong>
          <input name="name-2" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.providerName")} required />
          <select name="kind" value={kind} onChange={(event) => {
            const nextKind = event.target.value as ProviderSummary["kind"];
            setKind(nextKind);
            setCapabilities(defaultProviderCapabilitiesForKind(nextKind));
          }}>
            <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
            <option value="openai-responses">{t("provider.kindResponses")}</option>
            <option value="local">{t("provider.kindLocal")}</option>
          </select>
          <input name="baseurl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("form.baseUrl")} />
          <input name="apikey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("form.apiKey")} type="password" />
          <input name="defaultmodel" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder={t("form.defaultModel")} required />
          <input name="rpmlimit" value={rpmLimit} onChange={(event) => setRpmLimit(event.target.value)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
          <label className="checkbox-row">
            <input name="rpmlimitenabled" type="checkbox" checked={rpmLimitEnabled} onChange={(event) => setRpmLimitEnabled(event.target.checked)} />
            <span>{t("provider.rpmEnabled")}</span>
          </label>
          {kind === "openai-responses" && (
            <label className="checkbox-row">
              <input name="useproxy" type="checkbox" checked={useProxy} onChange={(event) => setUseProxy(event.target.checked)} />
              <span>{t("provider.useProxy")}</span>
            </label>
          )}
          <button className="ghost-button" type="button" onClick={detectDraftInterface} disabled={detectingDraftInterface || !defaultModel.trim()}>
            <IconText icon={Activity}>{detectingDraftInterface ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
          </button>
          <button className="ghost-button" type="button" onClick={discoverDraftModels} disabled={discoveringDraftModels}>
            <IconText icon={RefreshCw}>{discoveringDraftModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
          </button>
          {draftModels && (
            <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("draft", draftModels)}>
              {t("provider.detectModels")} · {draftModels.models.length || t("provider.noModels")}
            </button>
          )}
          {message && <span className="form-error">{message}</span>}
          <button className="dark-button" disabled={savingProvider || detectingDraftInterface}><IconText icon={Save}>{savingProvider || detectingDraftInterface ? t("provider.detecting") : t("provider.saveProvider")}</IconText></button>
        </form>
        <section className="management-grid provider-management-grid">
          <div className="project-list-head">
            <strong>{t("page.providers")}</strong>
            <div className="project-list-head-actions">
              <span>{visibleProviders.length}/{providers.length}</span>
              <Button className="provider-mobile-create icon-only" variant="outline" size="sm" type="button" title={t("provider.createTitle")} aria-label={t("provider.createTitle")} onClick={() => setCreatePanelOpen(true)}><Plus size={16} /></Button>
            </div>
          </div>
          <FilterToolbar className="provider-filter-toolbar">
            <FilterSearchInput value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder={t("provider.searchProviders")} />
            <select name="providerkindfilter" className="filter-select" value={providerKindFilter} onChange={(event) => setProviderKindFilter(event.target.value as ProviderSummary["kind"] | "all")}>
              <option value="all">{t("provider.allKinds")}</option>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.refresh")} aria-label={t("action.refresh")} onClick={() => void onChange()}><IconText icon={RefreshCw}>{t("action.refresh")}</IconText></Button>
            <Button className="icon-only" variant="outline" size="sm" type="button" title={t("settings.payloadRewriteTitle")} aria-label={t("settings.payloadRewriteTitle")} onClick={() => setPayloadRulesOpen(true)}><IconText icon={SlidersHorizontal}>{t("settings.payloadRewriteTitle")}</IconText></Button>
          </FilterToolbar>
          {visibleProviders.map((provider) => (
            <div className="provider-card" key={provider.id}>
              <strong>{provider.name}</strong>
              <span>{provider.kind} · {provider.defaultModel}</span>
              <span>{provider.baseUrl ?? t("provider.defaultEndpoint")} · {t("provider.keyLabel")} {provider.apiKeyConfigured ? t("provider.keyConfigured") : t("provider.keyMissing")} · {provider.rpmLimitEnabled && provider.rpmLimit ? `${t("provider.rpmLimit")} ${provider.rpmLimit}` : t("provider.rpmDisabled")} · {provider.useProxy ? t("provider.proxyLocal") : t("provider.proxyDirect")}</span>
              {providerUsage[provider.id]?.summary.records ? (
                <span>{t("usage.title")} · {formatTokens(providerUsage[provider.id].summary.totalTokens)} {t("usage.totalTokens")} · {t("usage.inputTokens")} {formatTokens(providerUsage[provider.id].summary.inputTokens)} · {t("usage.outputTokens")} {formatTokens(providerUsage[provider.id].summary.outputTokens)}</span>
              ) : (
                <span>{t("usage.title")} · {t("usage.empty")}</span>
              )}
              {provider.rpmLimit && (
                <label className="checkbox-row">
                  <input name="provider-rpmlimitenabled" type="checkbox" checked={provider.rpmLimitEnabled ?? false} onChange={() => void toggleProviderRpmLimit(provider)} />
                  <span>{t("provider.rpmEnabled")}</span>
                </label>
              )}
              {provider.kind === "openai-responses" && (
                <label className="checkbox-row">
                  <input name="provider-useproxy" type="checkbox" checked={provider.useProxy ?? false} onChange={() => void toggleProviderProxy(provider)} />
                  <span>{t("provider.useProxy")}</span>
                </label>
              )}
              <div className="checkbox-grid compact-capabilities">
                {capabilityItems.map((item) => {
                  const current = { ...defaultProviderCapabilitiesForKind(provider.kind), ...(provider.capabilities ?? {}) };
                  return (
                    <label key={item.key}>
                      <input name="current-item-key" type="checkbox" checked={current[item.key]} onChange={() => void toggleProviderCapability(provider, item.key)} />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
              {testResults[provider.id] && (
                <span className={testResults[provider.id].ok ? "result-ok" : "result-error"}>
                  {testResults[provider.id].ok ? t("provider.testOk") : t("provider.testFailed")} · {testResults[provider.id].status ?? t("provider.noStatus")} · {testResults[provider.id].durationMs}ms
                  {testResults[provider.id].error ? ` · ${testResults[provider.id].error}` : ""}
                </span>
              )}
              <div className="provider-card-actions">
                <button className="ghost-button" type="button" onClick={() => openEditProvider(provider)}>
                  <IconText icon={Pencil}>{t("provider.editTitle")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => testProvider(provider.id)} disabled={testingProviderId === provider.id}>
                  <IconText icon={Activity}>{testingProviderId === provider.id ? t("provider.testing") : t("provider.testConnection")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => detectProviderInterface(provider.id)} disabled={detectingProviderInterfaceId === provider.id}>
                  <IconText icon={Activity}>{detectingProviderInterfaceId === provider.id ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => discoverModels(provider.id)} disabled={discoveringProviderId === provider.id}>
                  <IconText icon={RefreshCw}>{discoveringProviderId === provider.id ? t("provider.detecting") : t("provider.detectModels")}</IconText>
                </button>
                <button className="ghost-button" type="button" onClick={() => void openProviderHealth(provider)}>
                  <IconText icon={History}>{t("provider.healthHistory")}</IconText>
                </button>
                <button className="ghost-button danger-button" type="button" onClick={() => deleteProvider(provider.id, provider.name)}>
                  <IconText icon={Trash2}>{t("action.delete")}</IconText>
                </button>
              </div>
              <div className="provider-card-action-menu">
                <Button className="icon-only" variant="outline" size="sm" type="button" title={t("provider.editTitle")} aria-label={t("provider.editTitle")} onClick={() => openEditProvider(provider)}><IconText icon={Pencil}>{t("provider.editTitle")}</IconText></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="icon-only" variant="outline" size="sm" type="button" title={t("action.more")} aria-label={t("action.more")}><IconText icon={MoreHorizontal}>{t("action.more")}</IconText></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={testingProviderId === provider.id} onSelect={() => void testProvider(provider.id)}><IconText icon={Activity}>{testingProviderId === provider.id ? t("provider.testing") : t("provider.testConnection")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem disabled={detectingProviderInterfaceId === provider.id} onSelect={() => void detectProviderInterface(provider.id)}><IconText icon={Activity}>{detectingProviderInterfaceId === provider.id ? t("provider.detecting") : t("provider.detectInterface")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem disabled={discoveringProviderId === provider.id} onSelect={() => void discoverModels(provider.id)}><IconText icon={RefreshCw}>{discoveringProviderId === provider.id ? t("provider.detecting") : t("provider.detectModels")}</IconText></DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void openProviderHealth(provider)}><IconText icon={History}>{t("provider.healthHistory")}</IconText></DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="danger-menu-item" onSelect={() => deleteProvider(provider.id, provider.name)}><IconText icon={Trash2}>{t("action.delete")}</IconText></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {modelResults[provider.id] && (
                renderModelPicker(provider.id, modelResults[provider.id], provider.defaultModel, (model) => void applyDefaultModel(provider.id, model), () => setModelResults((items) => {
                  const next = { ...items };
                  delete next[provider.id];
                  return next;
                }))
              )}
            </div>
          ))}
          {!visibleProviders.length && <div className="empty-state">{t("provider.noProviders")}</div>}
        </section>
      </section>
      {healthPanel && (
        <div className="workspace-modal compact-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.healthTitle")}</strong>
              <span>{healthPanel.provider.name}</span>
            </div>
            <div className="project-list-head-actions">
              <button className="ghost-button danger-button" type="button" disabled={!healthPanel.checks?.length || clearingHealthProviderId === healthPanel.provider.id} onClick={() => void clearProviderHealth(healthPanel.provider)}>
                <IconText icon={Trash2}>{t("provider.clearHealthHistory")}</IconText>
              </button>
              <button className="ghost-button" type="button" onClick={() => setHealthPanel(null)}>{t("action.close")}</button>
            </div>
          </div>
          <div className="extension-detail">
            {!healthPanel.checks && <div className="subtle">{t("provider.healthLoading")}</div>}
            {healthPanel.checks?.map((check) => (
              <div className="provider-health-row" key={check.id}>
                <strong>{check.kind} · {check.ok ? t("provider.testOk") : t("provider.testFailed")}</strong>
                <span>{check.status ?? t("provider.noStatus")} · {check.durationMs}ms · {formatShortDate(check.checkedAt)}</span>
                {check.error && <code>{check.error}</code>}
              </div>
            ))}
            {healthPanel.hasMore && <button className="ghost-button load-more" type="button" onClick={() => void openProviderHealth(healthPanel.provider, true)}>{t("session.loadMore")}</button>}
            {healthPanel.checks && !healthPanel.checks.length && <div className="empty-state">{t("provider.noHealthChecks")}</div>}
          </div>
        </div>
      )}
      {providerModelPicker && (
        <div className="workspace-modal compact-modal provider-model-picker-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.detectModels")}</strong>
              <span>{providerModelPicker.title}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setProviderModelPicker(null)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <div className="provider-model-picker-body">
            {renderModelPicker(
              `provider-picker-${providerModelPicker.target}`,
              providerModelPicker.result,
              providerModelPicker.target === "draft" ? defaultModel : editPanel?.defaultModel ?? "",
              selectProviderModelFromDialog,
            )}
          </div>
        </div>
      )}
      {payloadRulesOpen && (
        <div className="workspace-modal compact-modal provider-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("settings.payloadRewriteTitle")}</strong>
              <span>{t("settings.payloadRewriteHelp")}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setPayloadRulesOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={savePayloadRewriteSettings}>
            <div className="payload-rule-editor">
              <div className="payload-rule-editor-head">
                <strong>{t("settings.payloadRules")}</strong>
                <button className="ghost-button" type="button" onClick={addPayloadRule}><IconText icon={Plus}>{t("settings.payloadRuleAdd")}</IconText></button>
              </div>
              {payloadRuleDrafts.map((rule, index) => (
                <div className="payload-rule-row" key={rule.id}>
                  <label className="checkbox-row">
                    <input name={`payload-rule-enabled-${rule.id}`} type="checkbox" checked={rule.enabled !== false} onChange={(event) => updatePayloadRule(index, { enabled: event.target.checked })} />
                    <span>{t("settings.payloadRuleEnabled")}</span>
                  </label>
                  <select name={`payload-rule-kind-${rule.id}`} value={rule.providerKind ?? "all"} onChange={(event) => updatePayloadRule(index, { providerKind: event.target.value as PayloadRewriteRule["providerKind"] })}>
                    <option value="all">{t("settings.payloadRuleKindAll")}</option>
                    <option value="openai-compatible-chat">{t("settings.payloadRuleKindChat")}</option>
                    <option value="openai-responses">{t("settings.payloadRuleKindResponses")}</option>
                    <option value="local">{t("settings.payloadRuleKindLocal")}</option>
                  </select>
                  <input name={`payload-rule-model-${rule.id}`} value={rule.modelPattern} onChange={(event) => updatePayloadRule(index, { modelPattern: event.target.value })} placeholder={t("settings.payloadRuleModelPattern")} />
                  <input name={`payload-rule-remove-${rule.id}`} value={rule.removeParamsText} onChange={(event) => updatePayloadRule(index, { removeParamsText: event.target.value })} placeholder={t("settings.payloadRuleRemoveParams")} />
                  <textarea name={`payload-rule-set-${rule.id}`} value={rule.setParamsJson ?? ""} onChange={(event) => updatePayloadRule(index, { setParamsJson: event.target.value })} placeholder={t("settings.payloadRuleSetParams")} rows={3} />
                  <button className="ghost-button danger-button" type="button" onClick={() => removePayloadRule(index)}><IconText icon={Trash2}>{t("action.delete")}</IconText></button>
                </div>
              ))}
              {!payloadRuleDrafts.length && <span className="subtle">{t("settings.payloadRulesEmpty")}</span>}
            </div>
            {payloadRewriteSettings && <code>{payloadRewriteSettings.rules.length} rules · {formatShortDate(payloadRewriteSettings.updatedAt)}</code>}
            <button className="dark-button" disabled={savingPayloadRules}><IconText icon={Save}>{savingPayloadRules ? t("provider.detecting") : t("action.save")}</IconText></button>
          </form>
        </div>
      )}
      {editPanel && (
        <div className="workspace-modal compact-modal provider-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.editTitle")}</strong>
              <span>{editPanel.provider.name}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => { setEditPanel(null); setEditModels(null); }} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={saveEditedProvider}>
            <input name="edit-provider-name" value={editPanel.name} onChange={(event) => setEditPanel((current) => current ? { ...current, name: event.target.value } : current)} placeholder={t("form.providerName")} required />
            <select name="edit-provider-kind" value={editPanel.kind} onChange={(event) => {
              const nextKind = event.target.value as ProviderSummary["kind"];
              setEditModels(null);
              setEditPanel((current) => current ? {
                ...current,
                kind: nextKind,
                useProxy: nextKind === "openai-responses" ? current.useProxy : false,
                capabilities: defaultProviderCapabilitiesForKind(nextKind),
              } : current);
            }}>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <input name="edit-provider-baseurl" value={editPanel.baseUrl} onChange={(event) => {
              setEditModels(null);
              setEditPanel((current) => current ? { ...current, baseUrl: event.target.value } : current);
            }} placeholder={t("form.baseUrl")} />
            <input name="edit-provider-apikey" value={editPanel.apiKey} onChange={(event) => {
              setEditModels(null);
              setEditPanel((current) => current ? { ...current, apiKey: event.target.value } : current);
            }} placeholder={t("provider.apiKeyEditPlaceholder")} type="password" />
            <input name="edit-provider-defaultmodel" value={editPanel.defaultModel} onChange={(event) => setEditPanel((current) => current ? { ...current, defaultModel: event.target.value } : current)} placeholder={t("form.defaultModel")} required />
            <button className="ghost-button" type="button" onClick={() => void discoverEditProviderModels()} disabled={discoveringEditModels}>
              <IconText icon={RefreshCw}>{discoveringEditModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
            </button>
            {editModels && (
              <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("edit", editModels)}>
                {t("provider.detectModels")} · {editModels.models.length || t("provider.noModels")}
              </button>
            )}
            <input name="edit-provider-rpmlimit" value={editPanel.rpmLimit} onChange={(event) => setEditPanel((current) => current ? { ...current, rpmLimit: event.target.value } : current)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
            <label className="checkbox-row">
              <input name="edit-provider-rpmlimitenabled" type="checkbox" checked={editPanel.rpmLimitEnabled} onChange={(event) => setEditPanel((current) => current ? { ...current, rpmLimitEnabled: event.target.checked } : current)} />
              <span>{t("provider.rpmEnabled")}</span>
            </label>
            {editPanel.kind === "openai-responses" && (
              <label className="checkbox-row">
                <input name="edit-provider-useproxy" type="checkbox" checked={editPanel.useProxy} onChange={(event) => setEditPanel((current) => current ? { ...current, useProxy: event.target.checked } : current)} />
                <span>{t("provider.useProxy")}</span>
              </label>
            )}
            <div className="checkbox-grid">
              {capabilityItems.map((item) => (
                <label key={item.key}>
                  <input name={`edit-provider-capability-${item.key}`} type="checkbox" checked={editPanel.capabilities[item.key]} onChange={(event) => setEditPanel((current) => current ? { ...current, capabilities: { ...current.capabilities, [item.key]: event.target.checked } } : current)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
            {message && <span className="form-error">{message}</span>}
            <button className="dark-button"><IconText icon={Save}>{t("provider.saveChanges")}</IconText></button>
          </form>
        </div>
      )}
      {createPanelOpen && (
        <div className="workspace-modal compact-modal provider-create-modal" role="dialog" aria-modal="true">
          <div className="workspace-modal-head">
            <div>
              <strong>{t("provider.createTitle")}</strong>
              <span>{t("page.providers")}</span>
            </div>
            <button className="ghost-button icon-only" type="button" onClick={() => setCreatePanelOpen(false)} title={t("action.close")} aria-label={t("action.close")}><X size={16} /></button>
          </div>
          <form className="management-form" onSubmit={createProvider}>
            <input name="mobile-name-2" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("form.providerName")} required />
            <select name="mobile-kind" value={kind} onChange={(event) => {
              const nextKind = event.target.value as ProviderSummary["kind"];
              setKind(nextKind);
              setCapabilities(defaultProviderCapabilitiesForKind(nextKind));
            }}>
              <option value="openai-compatible-chat">{t("provider.kindCompatible")}</option>
              <option value="openai-responses">{t("provider.kindResponses")}</option>
              <option value="local">{t("provider.kindLocal")}</option>
            </select>
            <input name="mobile-baseurl" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("form.baseUrl")} />
            <input name="mobile-apikey" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t("form.apiKey")} type="password" />
            <input name="mobile-defaultmodel" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} placeholder={t("form.defaultModel")} required />
            <input name="mobile-rpmlimit" value={rpmLimit} onChange={(event) => setRpmLimit(event.target.value)} placeholder={t("form.rpmLimit")} type="number" min="1" inputMode="numeric" />
            <label className="checkbox-row">
              <input name="mobile-rpmlimitenabled" type="checkbox" checked={rpmLimitEnabled} onChange={(event) => setRpmLimitEnabled(event.target.checked)} />
              <span>{t("provider.rpmEnabled")}</span>
            </label>
            {kind === "openai-responses" && (
              <label className="checkbox-row">
                <input name="mobile-useproxy" type="checkbox" checked={useProxy} onChange={(event) => setUseProxy(event.target.checked)} />
                <span>{t("provider.useProxy")}</span>
              </label>
            )}
            <button className="ghost-button" type="button" onClick={detectDraftInterface} disabled={detectingDraftInterface || !defaultModel.trim()}>
              <IconText icon={Activity}>{detectingDraftInterface ? t("provider.detecting") : t("provider.detectInterface")}</IconText>
            </button>
            <button className="ghost-button" type="button" onClick={discoverDraftModels} disabled={discoveringDraftModels}>
              <IconText icon={RefreshCw}>{discoveringDraftModels ? t("provider.detecting") : t("provider.detectModels")}</IconText>
            </button>
            {draftModels && (
              <button className="ghost-button" type="button" onClick={() => openProviderModelPicker("draft", draftModels)}>
                {t("provider.detectModels")} · {draftModels.models.length || t("provider.noModels")}
              </button>
            )}
            {message && <span className="form-error">{message}</span>}
            <button className="dark-button" disabled={savingProvider || detectingDraftInterface}><IconText icon={Save}>{savingProvider || detectingDraftInterface ? t("provider.detecting") : t("provider.saveProvider")}</IconText></button>
          </form>
        </div>
      )}
    </main>
  );
}
