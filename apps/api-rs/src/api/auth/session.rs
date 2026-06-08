use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};

use super::models::AuthConfig;

type HmacSha256 = Hmac<Sha256>;
type HmacSha1 = Hmac<Sha1>;

#[derive(Deserialize)]
struct SessionPayload {
    sub: Option<String>,
    exp: Option<u64>,
}

pub fn bearer_token(value: Option<&str>) -> Option<&str> {
    value?.strip_prefix("Bearer ")
}

pub fn hash_access_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn sign_session_token(config: &AuthConfig) -> String {
    let header = base64_url_json(&serde_json::json!({ "alg": "HS256", "typ": "JWT" }));
    let now = now_ms();
    let payload = base64_url_json(&SessionTokenPayload {
        sub: "local-admin",
        iat: now,
        exp: now + 7 * 24 * 60 * 60 * 1000,
        nonce: random_nonce(),
    });
    let signing_input = format!("{header}.{payload}");
    let signature = sign_sha256(&session_secret(config), &signing_input);
    format!("{signing_input}.{signature}")
}

pub fn verify_session_token(config: &AuthConfig, token: Option<&str>) -> bool {
    let Some(token) = token else {
        return false;
    };
    let mut parts = token.split('.');
    let (Some(header), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let secret = session_secret(config);
    let expected = sign_sha256(&secret, &format!("{header}.{payload}"));
    if !constant_time_eq(signature.as_bytes(), expected.as_bytes()) {
        return false;
    }
    parse_payload(payload)
        .map(|payload| {
            payload.sub.as_deref() == Some("local-admin") && payload.exp.unwrap_or(0) > now_ms()
        })
        .unwrap_or(false)
}

fn session_secret(config: &AuthConfig) -> Vec<u8> {
    Sha256::digest(format!(
        "{}:{}",
        config.access_token_hash, config.otp_secret
    ))
    .to_vec()
}

pub fn verify_totp(secret: &str, token: &str) -> bool {
    let token = token.trim();
    if token.len() != 6 || !token.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let Some(secret) = decode_base32(secret) else {
        return false;
    };
    let time_step = (now_ms() / 1000) / 30;
    (time_step.saturating_sub(1)..=time_step + 1)
        .any(|step| totp_code(&secret, step).as_deref() == Some(token))
}

pub fn generate_otp_secret() -> String {
    let mut bytes = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut bytes);
    encode_base32(&bytes)
}

pub fn otpauth_url(secret: &str) -> String {
    format!("otpauth://totp/Codex%20Web:local-admin?secret={secret}&issuer=Codex%20Web&algorithm=SHA1&digits=6&period=30")
}

fn sign_sha256(secret: &[u8], value: &str) -> String {
    let mut mac =
        <HmacSha256 as KeyInit>::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(value.as_bytes());
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn sign_sha1(secret: &[u8], value: &[u8]) -> Vec<u8> {
    let mut mac =
        <HmacSha1 as KeyInit>::new_from_slice(secret).expect("hmac accepts any key length");
    mac.update(value);
    mac.finalize().into_bytes().to_vec()
}

fn parse_payload(payload: &str) -> Option<SessionPayload> {
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn constant_time_eq(actual: &[u8], expected: &[u8]) -> bool {
    if actual.len() != expected.len() {
        return false;
    }
    actual
        .iter()
        .zip(expected.iter())
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

#[derive(Serialize)]
struct SessionTokenPayload {
    sub: &'static str,
    iat: u64,
    exp: u64,
    nonce: String,
}

fn base64_url_json(value: &impl Serialize) -> String {
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(value).unwrap_or_default())
}

fn random_nonce() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn totp_code(secret: &[u8], time_step: u64) -> Option<String> {
    let digest = sign_sha1(secret, &time_step.to_be_bytes());
    let offset = usize::from(*digest.last()? & 0x0f);
    let slice = digest.get(offset..offset + 4)?;
    let value = ((u32::from(slice[0]) & 0x7f) << 24)
        | (u32::from(slice[1]) << 16)
        | (u32::from(slice[2]) << 8)
        | u32::from(slice[3]);
    Some(format!("{:06}", value % 1_000_000))
}

fn decode_base32(value: &str) -> Option<Vec<u8>> {
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut output = Vec::new();
    for byte in value
        .bytes()
        .filter(|byte| *byte != b'=' && !byte.is_ascii_whitespace())
    {
        let val = match byte.to_ascii_uppercase() {
            b'A'..=b'Z' => byte.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | u32::from(val);
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(output)
}

fn encode_base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut output = String::new();
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    output
}
