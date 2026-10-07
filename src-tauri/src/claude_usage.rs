//! Read-only Claude Code subscription usage. Credentials never reach the WebView.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
pub struct Window {
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Usage {
    pub account: String,
    pub plan: String,
    pub windows: Vec<Window>,
    pub updated_at: String,
}
type Cache = Option<(Vec<u8>, Instant, Result<Usage, String>)>;

fn windows(body: &Value) -> Vec<Window> {
    [
        ("five_hour", "Session (5 hours)"),
        ("seven_day", "Weekly"),
        ("seven_day_opus", "Weekly Opus"),
        ("seven_day_sonnet", "Weekly Sonnet"),
        ("seven_day_oauth_apps", "Weekly OAuth apps"),
        ("extra_usage", "Extra usage"),
    ]
    .into_iter()
    .filter_map(|(key, label)| {
        let w = body.get(key)?;
        if key == "extra_usage" && w.get("is_enabled") != Some(&Value::Bool(true)) {
            return None;
        }
        let used_percent = w.get("utilization")?.as_f64()?;
        if !used_percent.is_finite() || used_percent < 0.0 {
            return None;
        }
        Some(Window {
            label: label.into(),
            used_percent,
            resets_at: w.get("resets_at").and_then(Value::as_str).map(String::from),
        })
    })
    .collect()
}

#[tauri::command]
pub async fn get_claude_usage(force: bool) -> Result<Usage, String> {
    let home = dirs::home_dir().ok_or("Home directory unavailable")?;
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    let raw = tokio::fs::read(root.join(".credentials.json"))
        .await
        .map_err(|_| "No local Claude Code login. Sign in with Claude Code, then refresh.")?;
    let auth: Value =
        serde_json::from_slice(&raw).map_err(|_| "Cannot read Claude Code login data")?;
    let oauth = &auth["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("No Claude subscription login. Sign in with Claude Code, then refresh.")?;
    if oauth["expiresAt"]
        .as_i64()
        .is_some_and(|ms| ms <= chrono::Utc::now().timestamp_millis())
    {
        return Err("Claude login expired. Open Claude Code to refresh it, then retry.".into());
    }
    // Cache successes and failures; serialize requests to avoid duplicate mounts/polling.
    static CACHE: OnceLock<tokio::sync::Mutex<Cache>> = OnceLock::new();
    let mut cache = CACHE
        .get_or_init(|| tokio::sync::Mutex::new(None))
        .lock()
        .await;
    let fingerprint = Sha256::digest(token.as_bytes()).to_vec();
    if let Some((key, fetched, result)) = cache.as_ref() {
        if key == &fingerprint
            && fetched.elapsed() < Duration::from_secs(if force { 30 } else { 300 })
        {
            return result.clone();
        }
    }
    let result = async {
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "Cannot create usage client")?
            .get("https://api.anthropic.com/api/oauth/usage")
            .bearer_auth(token)
            .header("anthropic-beta", "oauth-2025-04-20")
            .header("User-Agent", "claude-code/2.0")
            .send()
            .await
            .map_err(|_| "Claude usage is temporarily unreachable")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "Claude login needs renewal. Open Claude Code, then refresh.".into(),
                429 => "Claude usage is rate limited. Wait a few minutes before refreshing.".into(),
                code => format!("Claude usage unavailable (HTTP {code})"),
            });
        }
        let body: Value = response
            .json()
            .await
            .map_err(|_| "Claude returned invalid usage data")?;
        let windows = windows(&body);
        if windows.is_empty() {
            return Err("Claude has not supplied quota data for this login".into());
        }
        let metadata = tokio::fs::read(root.join(".claude.json"))
            .await
            .ok()
            .or(tokio::fs::read(home.join(".claude.json")).await.ok());
        let account = metadata
            .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
            .and_then(|v| {
                v.pointer("/oauthAccount/emailAddress")
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .unwrap_or_else(|| "Local Claude Code account".into());
        Ok(Usage {
            account,
            plan: oauth["subscriptionType"]
                .as_str()
                .unwrap_or("subscription")
                .into(),
            windows,
            updated_at: chrono::Utc::now().to_rfc3339(),
        })
    }
    .await;
    *cache = Some((fingerprint, Instant::now(), result.clone()));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotas_preserve_zero_and_overage_without_inventing_missing_windows() {
        let w = windows(
            &serde_json::json!({"five_hour":{"utilization":0,"resets_at":"2026-10-08T12:00:00Z"},"seven_day":{"utilization":112},"seven_day_opus":null,"seven_day_sonnet":{"utilization":null},"extra_usage":{"is_enabled":false,"utilization":20}}),
        );
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].used_percent, 0.0);
        assert!(w[0].resets_at.is_some());
        assert_eq!(w[1].used_percent, 112.0);
        assert!(windows(&serde_json::json!({"five_hour":{"utilization":-1}})).is_empty());
    }
}
