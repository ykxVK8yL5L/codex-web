use serde::Deserialize;
use serde::Serialize;

#[derive(Clone, Debug)]
pub struct AuthConfig {
    pub access_token_hash: String,
    pub otp_secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateResponse {
    pub authenticated: bool,
    pub setup_required: bool,
    pub needs_otp: bool,
    pub user: Option<AuthUser>,
}

#[derive(Serialize)]
pub struct AuthUser {
    pub id: &'static str,
    pub email: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub access_token: String,
    pub otp: String,
}

pub type SetupCompleteRequest = LoginRequest;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccessTokenRequest {
    pub current_access_token: String,
    pub access_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmOtpResetRequest {
    pub current_access_token: String,
    pub otp: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetOtpResponse {
    pub otp_secret: String,
    pub otpauth_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub ok: bool,
    pub session_token: Option<String>,
    pub auth: AuthStateResponse,
    pub error: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStartResponse {
    pub setup_required: bool,
    pub otp_secret: Option<String>,
    pub otpauth_url: Option<String>,
}

impl AuthStateResponse {
    pub fn anonymous(setup_required: bool) -> Self {
        Self {
            authenticated: false,
            setup_required,
            needs_otp: true,
            user: None,
        }
    }

    pub fn authenticated() -> Self {
        Self {
            authenticated: true,
            setup_required: false,
            needs_otp: false,
            user: Some(AuthUser {
                id: "local-admin",
                email: "admin@local",
            }),
        }
    }
}
