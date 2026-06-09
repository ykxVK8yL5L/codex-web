use regex::Regex;

use super::models::ProviderRecord;
use crate::api::settings::models::PayloadRewriteRule;

pub fn apply_payload_rewrite_rules(
    provider: &ProviderRecord,
    payload: serde_json::Value,
    rules: &[PayloadRewriteRule],
) -> serde_json::Value {
    let model = payload
        .get("model")
        .and_then(|value| value.as_str())
        .unwrap_or(provider.summary.default_model.as_str())
        .to_string();
    let mut object = match payload {
        serde_json::Value::Object(object) => object,
        value => return value,
    };
    for rule in sanitize_payload_rewrite_rules(rules.to_vec()) {
        if !rule.enabled {
            continue;
        }
        if rule.provider_kind.as_deref().unwrap_or("all") != "all"
            && rule.provider_kind.as_deref() != Some(provider.summary.kind.as_str())
        {
            continue;
        }
        let Ok(regex) = Regex::new(&rule.model_pattern) else {
            continue;
        };
        if !regex.is_match(&model) {
            continue;
        }
        for key in &rule.remove_params {
            object.remove(key);
        }
        if !rule.set_params_json.trim().is_empty() {
            let Ok(serde_json::Value::Object(rewrite)) =
                serde_json::from_str::<serde_json::Value>(&rule.set_params_json)
            else {
                continue;
            };
            for (key, value) in rewrite {
                object.insert(key, value);
            }
        }
    }
    serde_json::Value::Object(object)
}

pub fn sanitize_payload_rewrite_rules(rules: Vec<PayloadRewriteRule>) -> Vec<PayloadRewriteRule> {
    rules
        .into_iter()
        .enumerate()
        .filter_map(|(index, mut rule)| {
            rule.id = rule.id.trim().to_string();
            if rule.id.is_empty() {
                rule.id = format!("payload-rule-{}", index + 1);
            }
            let kind = rule.provider_kind.as_deref().unwrap_or("all");
            rule.provider_kind = Some(match kind {
                "openai-compatible-chat" | "openai-responses" | "local" | "all" => {
                    kind.to_string()
                }
                _ => "all".to_string(),
            });
            rule.model_pattern = rule.model_pattern.trim().to_string();
            if rule.model_pattern.is_empty() {
                return None;
            }
            rule.remove_params = rule
                .remove_params
                .into_iter()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect();
            rule.set_params_json = rule.set_params_json.trim().to_string();
            Some(rule)
        })
        .collect()
}
