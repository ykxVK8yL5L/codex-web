use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResponse<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageCursor {
    pub sort_value: String,
    pub id: String,
}

pub fn parse_limit(value: Option<&str>, default_limit: usize, max_limit: usize) -> usize {
    value
        .and_then(|item| item.parse::<usize>().ok())
        .filter(|item| *item > 0)
        .map(|item| item.min(max_limit))
        .unwrap_or(default_limit)
}

pub fn decode_page_cursor(value: Option<&str>) -> Option<PageCursor> {
    let value = value.filter(|value| !value.trim().is_empty())?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .ok()?;
    let parsed = serde_json::from_slice::<PageCursor>(&bytes).ok()?;
    if parsed.sort_value.is_empty() || parsed.id.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

pub fn encode_page_cursor(sort_value: &str, id: &str) -> Option<String> {
    use base64::Engine;
    let value = serde_json::json!({ "sortValue": sort_value, "id": id });
    serde_json::to_vec(&value)
        .ok()
        .map(|bytes| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

pub fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub fn current_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
