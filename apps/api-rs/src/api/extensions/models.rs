use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub extension_type: String,
    pub name: String,
    pub description: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
    pub enabled: Option<bool>,
    pub source_type: Option<String>,
    pub managed_by: Option<String>,
    pub sync_status: Option<String>,
    pub scanned_at: Option<String>,
    pub capability_kinds: Option<Vec<String>>,
    pub permissions: Option<Vec<String>>,
    pub assignable_to: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkillRequest {
    pub name: String,
    pub description: String,
    pub instructions: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSkillRequest {
    pub path: String,
    pub name: String,
    pub description: String,
    pub instructions: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSkillRequest {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillRequest {
    pub url: Option<String>,
    pub content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillResponse {
    pub imported: ExtensionSummary,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePluginRequest {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMcpServerRequest {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMcpServerRequest {
    pub url: Option<String>,
    pub content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMcpServerResponse {
    pub imported: Vec<ExtensionSummary>,
    pub candidates: Vec<CreateMcpServerRequest>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceCatalogSource {
    pub id: String,
    pub name: String,
    pub homepage: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceCatalogItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub homepage: Option<String>,
    pub author: Option<String>,
    pub version: Option<String>,
    pub source: Option<String>,
    pub requires: Option<serde_json::Value>,
    pub install: serde_json::Value,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceCatalog {
    pub schema_version: i64,
    pub source: MarketplaceCatalogSource,
    pub items: Vec<MarketplaceCatalogItem>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceCatalogResponse {
    pub source: MarketplaceCatalogSource,
    pub items: Vec<MarketplaceCatalogItem>,
    pub error: Option<String>,
    pub fetched_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMarketplaceCatalogRequest {
    pub url: Option<String>,
    pub content: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteMarketplaceItemsRequest {
    pub ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallMarketplaceItemRequest {
    pub item: MarketplaceCatalogItem,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallMarketplaceItemResponse {
    pub installed: Vec<ExtensionSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDetail {
    pub item: ExtensionSummary,
    pub format: String,
    pub content: String,
}
