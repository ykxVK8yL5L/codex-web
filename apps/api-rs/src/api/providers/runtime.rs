use std::time::Instant;

use reqwest::Client;

use super::models::{
    ProviderDetectionCheck, ProviderDetectionChecks, ProviderDetectionResponse, ProviderInput,
    ProviderModelsResponse, ProviderRecord, ProviderTestResponse,
};
use super::payload_rules::apply_payload_rewrite_rules;
use crate::api::settings::models::PayloadRewriteRule;

const PROVIDER_TIMEOUT_MS: u64 = 30_000;

pub async fn test_provider(provider: &ProviderRecord, rules: &[PayloadRewriteRule]) -> ProviderTestResponse {
    let started = Instant::now();
    let client = client();
    let result = async {
        if provider.summary.kind != "local" && provider.api_key.as_deref().unwrap_or("").is_empty()
        {
            anyhow::bail!("api_key_missing");
        }
        let response = match provider.summary.kind.as_str() {
            "openai-responses" => {
                let base_url = provider
                    .summary
                    .base_url
                    .as_deref()
                    .unwrap_or("https://api.openai.com/v1");
                let payload = apply_payload_rewrite_rules(
                    provider,
                    serde_json::json!({
                        "model": provider.summary.default_model,
                        "input": "ping",
                        "max_output_tokens": 16,
                    }),
                    rules,
                );
                client
                    .post(join_url(base_url, "/responses"))
                    .bearer_auth(provider.api_key.as_deref().unwrap_or(""))
                    .json(&payload)
                    .send()
                    .await?
            }
            "openai-compatible-chat" => {
                let base_url = provider
                    .summary
                    .base_url
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("base_url_required"))?;
                let payload = apply_payload_rewrite_rules(
                    provider,
                    serde_json::json!({
                        "model": provider.summary.default_model,
                        "messages": [{ "role": "user", "content": "ping" }],
                        "max_tokens": 16,
                    }),
                    rules,
                );
                client
                    .post(join_url(base_url, "/chat/completions"))
                    .bearer_auth(provider.api_key.as_deref().unwrap_or(""))
                    .json(&payload)
                    .send()
                    .await?
            }
            _ => {
                let base_url = provider
                    .summary
                    .base_url
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("base_url_required"))?;
                client.get(join_url(base_url, "/health")).send().await?
            }
        };
        let status = response.status().as_u16() as i64;
        if response.status().is_success() {
            Ok((Some(status), None))
        } else {
            let text = response.text().await.unwrap_or_default();
            Ok((Some(status), Some(trim_error(&text))))
        }
    }
    .await;
    match result {
        Ok((status, error)) => ProviderTestResponse {
            ok: error.is_none(),
            provider_id: provider.summary.id.clone(),
            status,
            duration_ms: started.elapsed().as_millis() as i64,
            error,
        },
        Err(error) => ProviderTestResponse {
            ok: false,
            provider_id: provider.summary.id.clone(),
            status: None,
            duration_ms: started.elapsed().as_millis() as i64,
            error: Some(error.to_string()),
        },
    }
}

pub async fn discover_models(provider: &ProviderRecord) -> ProviderModelsResponse {
    let started = Instant::now();
    let result = async {
        if provider.summary.kind != "local" && provider.api_key.as_deref().unwrap_or("").is_empty()
        {
            anyhow::bail!("api_key_missing");
        }
        let base_url = provider
            .summary
            .base_url
            .as_deref()
            .or(if provider.summary.kind == "openai-responses" {
                Some("https://api.openai.com/v1")
            } else {
                None
            })
            .ok_or_else(|| anyhow::anyhow!("base_url_required"))?;
        let mut request = client().get(join_url(base_url, "/models"));
        if let Some(api_key) = provider
            .api_key
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(api_key);
        }
        let response = request.send().await?;
        let status = response.status().as_u16() as i64;
        let ok = response.status().is_success();
        let payload = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let models = parse_models(&payload);
        Ok((
            ok,
            Some(status),
            models,
            if ok {
                None
            } else {
                Some(format!("http_{status}"))
            },
        ))
    }
    .await;
    match result {
        Ok((ok, status, models, error)) => ProviderModelsResponse {
            ok,
            provider_id: provider.summary.id.clone(),
            models,
            status,
            duration_ms: started.elapsed().as_millis() as i64,
            error,
        },
        Err(error) => ProviderModelsResponse {
            ok: false,
            provider_id: provider.summary.id.clone(),
            models: Vec::new(),
            status: None,
            duration_ms: started.elapsed().as_millis() as i64,
            error: Some(error.to_string()),
        },
    }
}

pub async fn detect_provider(provider: &ProviderRecord, rules: &[PayloadRewriteRule]) -> ProviderDetectionResponse {
    let started = Instant::now();
    if provider.summary.default_model.trim().is_empty() {
        let check = ProviderDetectionCheck {
            ok: false,
            status: None,
            error: Some("default_model_required".to_string()),
        };
        return ProviderDetectionResponse {
            ok: false,
            provider_id: provider.summary.id.clone(),
            kind: provider.summary.kind.clone(),
            capabilities: provider.summary.capabilities.clone(),
            duration_ms: 0,
            checks: ProviderDetectionChecks {
                responses: ProviderDetectionCheck {
                    ok: check.ok,
                    status: check.status,
                    error: check.error.clone(),
                },
                chat_completions: check,
            },
            error: Some("default_model_required".to_string()),
        };
    }
    let (responses, chat_completions) = tokio::join!(
        probe_interface(provider, "responses", rules),
        probe_interface(provider, "chatCompletions", rules)
    );
    let detected_kind = if responses.ok {
        "openai-responses"
    } else if chat_completions.ok {
        "openai-compatible-chat"
    } else {
        provider.summary.kind.as_str()
    }
    .to_string();
    let mut capabilities = super::store::default_capabilities(&detected_kind);
    capabilities.responses_api = responses.ok;
    capabilities.chat_completions = chat_completions.ok;
    capabilities.tools = detected_kind != "local";
    capabilities.json_mode = detected_kind != "local";
    capabilities.streaming = true;
    let ok = responses.ok || chat_completions.ok;
    let error = if ok {
        None
    } else {
        responses
            .error
            .clone()
            .or_else(|| chat_completions.error.clone())
            .or_else(|| Some("provider_detection_failed".to_string()))
    };
    ProviderDetectionResponse {
        ok,
        provider_id: provider.summary.id.clone(),
        kind: detected_kind,
        capabilities,
        duration_ms: started.elapsed().as_millis() as i64,
        checks: ProviderDetectionChecks {
            responses,
            chat_completions,
        },
        error,
    }
}

pub fn draft_provider(input: ProviderInput) -> ProviderRecord {
    let kind = input
        .kind
        .unwrap_or_else(|| "openai-compatible-chat".to_string());
    let defaults = super::store::default_capabilities(&kind);
    let capabilities = if let Some(input) = input.capabilities {
        super::models::ProviderCapabilities {
            responses_api: input.responses_api.unwrap_or(defaults.responses_api),
            chat_completions: input.chat_completions.unwrap_or(defaults.chat_completions),
            tools: input.tools.unwrap_or(defaults.tools),
            json_mode: input.json_mode.unwrap_or(defaults.json_mode),
            vision: input.vision.unwrap_or(defaults.vision),
            streaming: input.streaming.unwrap_or(defaults.streaming),
        }
    } else {
        defaults
    };
    let api_key = input.api_key.filter(|value| !value.trim().is_empty());
    ProviderRecord {
        summary: super::models::ProviderSummary {
            id: "draft".to_string(),
            name: input.name.unwrap_or_else(|| "Draft Provider".to_string()),
            kind: kind.clone(),
            default_model: input.default_model.unwrap_or_default(),
            base_url: input.base_url.filter(|value| !value.trim().is_empty()),
            api_key_configured: api_key.is_some(),
            capabilities,
            models: None,
            models_cached_at: None,
            rpm_limit: input.rpm_limit,
            rpm_limit_enabled: input.rpm_limit_enabled.unwrap_or(false),
            use_proxy: kind == "openai-responses" && input.use_proxy.unwrap_or(false),
        },
        api_key,
    }
}

fn client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_millis(PROVIDER_TIMEOUT_MS))
        .build()
        .unwrap_or_else(|_| Client::new())
}

async fn probe_interface(provider: &ProviderRecord, interface: &str, rules: &[PayloadRewriteRule]) -> ProviderDetectionCheck {
    let result = async {
        if provider.summary.kind != "local" && provider.api_key.as_deref().unwrap_or("").is_empty()
        {
            anyhow::bail!("api_key_missing");
        }
        let base_url = provider
            .summary
            .base_url
            .as_deref()
            .or(if provider.summary.kind == "openai-responses" {
                Some("https://api.openai.com/v1")
            } else {
                None
            })
            .ok_or_else(|| anyhow::anyhow!("base_url_required"))?;
        let mut request = match interface {
            "responses" => {
                let payload = apply_payload_rewrite_rules(
                    provider,
                    serde_json::json!({
                        "model": provider.summary.default_model,
                        "input": "ping",
                        "max_output_tokens": 16,
                    }),
                    rules,
                );
                client()
                    .post(join_url(base_url, "/responses"))
                    .json(&payload)
            }
            _ => {
                let payload = apply_payload_rewrite_rules(
                    provider,
                    serde_json::json!({
                    "model": provider.summary.default_model,
                    "messages": [{ "role": "user", "content": "ping" }],
                    "max_tokens": 16,
                    }),
                    rules,
                );
                client()
                    .post(join_url(base_url, "/chat/completions"))
                    .json(&payload)
            }
        };
        if let Some(api_key) = provider
            .api_key
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(api_key);
        }
        let response = request.send().await?;
        let status = response.status().as_u16() as i64;
        if response.status().is_success() {
            Ok(ProviderDetectionCheck {
                ok: true,
                status: Some(status),
                error: None,
            })
        } else {
            let error = response.text().await.unwrap_or_default();
            let error = if error.trim().is_empty() {
                format!("http_{status}")
            } else {
                trim_error(&error)
            };
            Ok(ProviderDetectionCheck {
                ok: false,
                status: Some(status),
                error: Some(error),
            })
        }
    }
    .await;
    result.unwrap_or_else(|error: anyhow::Error| ProviderDetectionCheck {
        ok: false,
        status: None,
        error: Some(error.to_string()),
    })
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn parse_models(payload: &serde_json::Value) -> Vec<String> {
    let mut models = if let Some(data) = payload.get("data").and_then(|value| value.as_array()) {
        data.iter()
            .filter_map(|item| {
                item.get("id")
                    .and_then(|id| id.as_str())
                    .map(ToString::to_string)
            })
            .collect::<Vec<_>>()
    } else if let Some(data) = payload.get("models").and_then(|value| value.as_array()) {
        data.iter()
            .filter_map(|item| item.as_str().map(ToString::to_string))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    models.sort();
    models.dedup();
    models
}

fn trim_error(value: &str) -> String {
    value.chars().take(240).collect()
}
