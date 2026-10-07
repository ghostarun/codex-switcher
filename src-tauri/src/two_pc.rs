//! One authenticated Tailscale peer. Activity never contains credentials or prompts.
use crate::account::{Account, AccountStore, AppSettings};
use bytes::Bytes;
use http_body_util::Full;
use hyper::{
    body::Incoming, server::conn::http1, service::service_fn, Method, Request, Response, StatusCode,
};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    convert::Infallible,
    net::Ipv4Addr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const PORT: u16 = 18082;
const FRESH: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountIdentity {
    pub key: String,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveAccount {
    pub account: AccountIdentity,
    pub connections: u32,
    pub since: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeActivity {
    #[serde(default)]
    pub protocol_version: u32,
    #[serde(default)]
    pub switcher_version: String,
    #[serde(default)]
    pub t3_version: Option<String>,
    pub node_id: String,
    pub name: String,
    pub ip: String,
    pub primary: bool,
    pub proxy_running: bool,
    #[serde(default)]
    pub live_accounts: Vec<LiveAccount>,
    pub selected: Option<AccountIdentity>,
    pub last_served: Option<AccountIdentity>,
    pub last_request_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Default)]
pub struct Status {
    pub enabled: bool,
    pub prefer_separate: bool,
    pub local: NodeActivity,
    pub peer: Option<NodeActivity>,
    pub peer_ip: String,
    pub peer_online: bool,
    pub peer_seen_at: Option<i64>,
    pub error: Option<String>,
    pub sharing: bool,
}
#[derive(Default)]
struct ActivityState {
    status: Status,
    received: Option<Instant>,
    last_id: Option<String>,
    last_at: Option<i64>,
    live: HashMap<String, (u32, i64)>,
}
fn state() -> &'static Mutex<ActivityState> {
    static STATE: OnceLock<Mutex<ActivityState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(ActivityState::default()))
}

// Store UUIDs differ on independently imported PCs. Match the upstream account identity.
pub fn identity(a: &Account) -> Option<AccountIdentity> {
    let key = a
        .auth_json
        .pointer("/tokens/account_id")
        .and_then(|v| v.as_str())?;
    if key.is_empty() || !a.is_openai_account() {
        return None;
    }
    Some(AccountIdentity {
        key: key.to_string(),
        name: a.name.clone(),
    })
}
pub struct ActivityGuard(String);
pub fn begin(id: &str) -> ActivityGuard {
    if !id.is_empty() {
        let mut s = state().lock().unwrap();
        let entry = s
            .live
            .entry(id.into())
            .or_insert((0, chrono::Utc::now().timestamp()));
        entry.0 = entry.0.saturating_add(1);
    }
    ActivityGuard(id.into())
}
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        if let Ok(mut s) = state().lock() {
            if let Some(e) = s.live.get_mut(&self.0) {
                e.0 = e.0.saturating_sub(1);
                if e.0 == 0 {
                    s.live.remove(&self.0);
                }
            }
        }
    }
}
pub fn record(account_id: &str) {
    if let Ok(mut s) = state().lock() {
        s.last_id = Some(account_id.to_string());
        s.last_at = Some(chrono::Utc::now().timestamp());
    }
}
pub fn validate(settings: &AppSettings) -> Result<(), String> {
    if !settings.two_pc_enabled {
        return Ok(());
    }
    tailscale_ip(&settings.two_pc_peer_ip)?;
    if settings.two_pc_secret.len() < 32 {
        return Err("Two-PC shared secret must be at least 32 characters".into());
    }
    if settings.remote_mode == "solo" {
        return Err("Two-PC pairing requires standalone, server, or client mode".into());
    }
    Ok(())
}
fn tailscale_ip(raw: &str) -> Result<Ipv4Addr, String> {
    let ip: Ipv4Addr = raw
        .parse()
        .map_err(|_| "Enter the other PC's Tailscale IPv4 address")?;
    let b = ip.octets();
    if b[0] != 100 || !(64..=127).contains(&b[1]) {
        return Err("Peer must use a Tailscale IPv4 address (100.64.0.0/10)".into());
    }
    Ok(ip)
}
fn peer_fresh(s: &ActivityState) -> bool {
    s.received.is_some_and(|t| t.elapsed() < FRESH)
}
pub fn status() -> Status {
    let Ok(s) = state().lock() else {
        return Status::default();
    };
    let mut out = s.status.clone();
    if !peer_fresh(&s) {
        out.peer = None;
    }
    out.sharing = out
        .peer
        .as_ref()
        .is_some_and(|p| p.proxy_running && same_account(&out.local, p));
    out
}
fn same_account(a: &NodeActivity, b: &NodeActivity) -> bool {
    a.selected
        .as_ref()
        .zip(b.selected.as_ref())
        .is_some_and(|(a, b)| a.key == b.key)
}
fn must_yield(local: &NodeActivity, peer: &NodeActivity) -> bool {
    // Existing connections outrank a fixed PC preference. Changing the default
    // never disconnects either machine's in-flight stream or established session.
    let key = local.selected.as_ref().map(|a| a.key.as_str());
    let busy = |n: &NodeActivity| {
        n.live_accounts
            .iter()
            .any(|a| Some(a.account.key.as_str()) == key)
    };
    if busy(local) != busy(peer) {
        return !busy(local);
    }
    if local.primary != peer.primary {
        return !local.primary;
    }
    local.node_id > peer.node_id
}
fn reserved_by(peer: &NodeActivity, a: &AccountIdentity) -> bool {
    peer.proxy_running
        && (peer
            .live_accounts
            .iter()
            .any(|live| live.account.key == a.key)
            || peer.selected.as_ref().is_some_and(|p| p.key == a.key))
}
pub fn reserved(store: &AccountStore, account_id: &str) -> bool {
    if !store.settings.two_pc_enabled || !store.settings.two_pc_prefer_separate {
        return false;
    }
    let Some(a) = store.accounts.get(account_id).and_then(identity) else {
        return false;
    };
    let Ok(s) = state().lock() else {
        return false;
    };
    peer_fresh(&s) && s.status.peer.as_ref().is_some_and(|p| reserved_by(p, &a))
}
pub fn prefer_separate(store: &AccountStore, scored: &mut [(String, String, f64)]) {
    // Stable partition preserves the existing quota/reset ordering within each group.
    if !store.settings.two_pc_enabled || !store.settings.two_pc_prefer_separate {
        return;
    }
    let peer = {
        let s = state().lock().unwrap();
        if peer_fresh(&s) {
            s.status.peer.clone()
        } else {
            None
        }
    };
    if let Some(peer) = peer {
        order_for_peer(store, scored, &peer);
    }
}
fn order_for_peer(store: &AccountStore, scored: &mut [(String, String, f64)], peer: &NodeActivity) {
    scored.sort_by_cached_key(|(id, _, _)| {
        store
            .accounts
            .get(id)
            .and_then(identity)
            .is_some_and(|a| reserved_by(peer, &a))
    });
}
pub async fn prepare_default(store: &Arc<Mutex<AccountStore>>, app: &tauri::AppHandle) {
    let settings = store.lock().unwrap().settings.clone();
    if !settings.two_pc_enabled || !settings.two_pc_prefer_separate || validate(&settings).is_err()
    {
        return;
    }
    // A new thread must see activity that began since the last five-second poll.
    let peer = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(format!(
            "http://{}:{PORT}/activity",
            settings.two_pc_peer_ip
        ))
        .header("x-pair-secret", &settings.two_pc_secret)
        .send()
        .await;
    if let Ok(r) = peer {
        if r.status().is_success() {
            if let Ok(p) = r.json::<NodeActivity>().await {
                if p.protocol_version == 1
                    && p.ip == settings.two_pc_peer_ip
                    && !p.node_id.is_empty()
                {
                    let mut s = state().lock().unwrap();
                    s.status.peer = Some(p);
                    s.received = Some(Instant::now());
                    s.status.peer_seen_at = Some(chrono::Utc::now().timestamp());
                }
            }
        }
    }
    let switched = {
        let mut st = store.lock().unwrap();
        let shared = st.current.as_ref().is_some_and(|id| reserved(&st, id));
        let should_yield = {
            let s = state().lock().unwrap();
            let local = local_snapshot(
                &st,
                s.status.local.clone(),
                s.last_id.as_deref(),
                s.last_at,
                &s.live,
            );
            s.status
                .peer
                .as_ref()
                .is_some_and(|peer| must_yield(&local, peer))
        };
        if !shared || !should_yield {
            false
        } else {
            let next = crate::score_candidate_accounts(&st)
                .into_iter()
                .find(|(id, _, _)| {
                    !reserved(&st, id)
                        && st.accounts.get(id).is_some_and(|a| {
                            AccountStore::extract_access_token(&a.auth_json).is_some()
                        })
                });
            if let Some((id, _, _)) = next {
                // Hot update protects existing sessions and never writes anchor auth.
                st.switch_to(&id, true).and_then(|_| st.save()).is_ok()
            } else {
                false
            }
        }
    };
    if switched {
        crate::proxy::invalidate_remote_token_cache();
        let _ = app.emit("accounts-updated", ());
    }
}
fn local_snapshot(
    store: &AccountStore,
    mut local: NodeActivity,
    last_id: Option<&str>,
    last_at: Option<i64>,
    live: &HashMap<String, (u32, i64)>,
) -> NodeActivity {
    local.protocol_version = 1;
    local.switcher_version = env!("CARGO_PKG_VERSION").into();
    local.t3_version = dirs::home_dir()
        .and_then(|h| std::fs::canonicalize(h.join(".local/opt/t3code-personal/current")).ok())
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
    local.primary = store.settings.two_pc_primary;
    local.selected = store
        .current
        .as_ref()
        .and_then(|id| store.accounts.get(id))
        .and_then(identity);
    local.last_served = last_id
        .and_then(|id| store.accounts.get(id))
        .and_then(identity);
    local.last_request_at = last_at;
    local.live_accounts = live
        .iter()
        .filter_map(|(id, (connections, since))| {
            store
                .accounts
                .get(id)
                .and_then(identity)
                .map(|account| LiveAccount {
                    account,
                    connections: *connections,
                    since: *since,
                })
        })
        .collect();
    local
}
fn response(status: StatusCode, data: impl Serialize) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(
            serde_json::to_vec(&data).unwrap_or_default(),
        )))
        .unwrap()
}
fn authorized(settings: &AppSettings, remote: &str, secret: Option<&str>) -> bool {
    settings.two_pc_enabled
        && settings.two_pc_secret.len() >= 32
        && remote == settings.two_pc_peer_ip
        && secret == Some(settings.two_pc_secret.as_str())
}
async fn serve(store: Arc<Mutex<AccountStore>>, bind: Ipv4Addr) {
    let listener = match tokio::net::TcpListener::bind((bind, PORT)).await {
        Ok(v) => v,
        Err(e) => {
            if let Ok(mut s) = state().lock() {
                s.status.error = Some(format!("Activity listener: {e}"));
            }
            return;
        }
    };
    loop {
        let Ok((stream, remote)) = listener.accept().await else {
            continue;
        };
        let store = store.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req: Request<Incoming>| {
                let store = store.clone();
                async move {
                    let settings = store.lock().unwrap().settings.clone();
                    let authorized = authorized(
                        &settings,
                        &remote.ip().to_string(),
                        req.headers()
                            .get("x-pair-secret")
                            .and_then(|s| s.to_str().ok()),
                    );
                    let res = if !authorized {
                        response(StatusCode::UNAUTHORIZED, "unauthorized")
                    } else if req.method() != Method::GET || req.uri().path() != "/activity" {
                        response(StatusCode::NOT_FOUND, "not found")
                    } else {
                        let s = state().lock().unwrap();
                        let local = s.status.local.clone();
                        let last_id = s.last_id.clone();
                        let last_at = s.last_at;
                        let live = s.live.clone();
                        drop(s);
                        response(
                            StatusCode::OK,
                            local_snapshot(
                                &store.lock().unwrap(),
                                local,
                                last_id.as_deref(),
                                last_at,
                                &live,
                            ),
                        )
                    };
                    Ok::<_, Infallible>(res)
                }
            });
            let _ = tokio::time::timeout(
                Duration::from_secs(5),
                http1::Builder::new()
                    .keep_alive(false)
                    .serve_connection(TokioIo::new(stream), service),
            )
            .await;
        });
    }
}
async fn tailscale() -> Result<serde_json::Value, String> {
    let out = tokio::time::timeout(
        Duration::from_secs(3),
        tokio::process::Command::new("tailscale")
            .args(["status", "--json"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Tailscale status timed out")?
    .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Tailscale is not available".into());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}
fn persist(status: &Status) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let path = home.join(".codex-switcher/two-pc-activity.json");
    let tmp = path.with_extension("tmp");
    if let Ok(bytes) = serde_json::to_vec_pretty(status) {
        if std::fs::write(&tmp, bytes).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            }
            let _ = std::fs::rename(tmp, path);
        }
    }
}
pub fn start(store: Arc<Mutex<AccountStore>>, app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let mut server: Option<tokio::task::JoinHandle<()>> = None;
        let mut binding = String::new();
        let mut pairing = String::new();
        loop {
            let settings = store.lock().unwrap().settings.clone();
            let mut error = None;
            let mut online = false;
            let mut local = NodeActivity {
                name: std::env::var("HOSTNAME").unwrap_or_else(|_| "This PC".into()),
                ..Default::default()
            };
            let mut bind = None;
            if settings.two_pc_enabled {
                match tailscale().await {
                    Ok(ts) => {
                        if ts["BackendState"] != "Running" {
                            error = Some("Tailscale is not connected".into());
                        }
                        local.name = ts["Self"]["HostName"].as_str().unwrap_or("This PC").into();
                        local.node_id = ts["Self"]["ID"].as_str().unwrap_or("").into();
                        local.ip = ts["Self"]["TailscaleIPs"][0].as_str().unwrap_or("").into();
                        bind = tailscale_ip(&local.ip).ok();
                        online = ts["Peer"].as_object().is_some_and(|peers| {
                            peers.values().any(|p| {
                                p["Online"] == true
                                    && p["TailscaleIPs"].as_array().is_some_and(|ips| {
                                        ips.iter().any(|ip| {
                                            ip.as_str() == Some(settings.two_pc_peer_ip.as_str())
                                        })
                                    })
                            })
                        });
                        if local.ip == settings.two_pc_peer_ip {
                            error = Some("Peer address must belong to the other PC".into());
                            bind = None;
                        }
                    }
                    Err(e) => error = Some(e),
                }
            }
            if let Err(e) = validate(&settings) {
                error = Some(e);
                bind = None;
            }
            let desired = bind.map(|v| v.to_string()).unwrap_or_default();
            if desired != binding || server.as_ref().is_some_and(|h| h.is_finished()) {
                if let Some(h) = server.take() {
                    h.abort();
                }
                binding = desired;
                if let Some(ip) = bind {
                    server = Some(tokio::spawn(serve(store.clone(), ip)));
                }
            }
            let pair = format!(
                "{}:{}:{}",
                settings.two_pc_enabled, settings.two_pc_peer_ip, settings.two_pc_secret
            );
            {
                let mut s = state().lock().unwrap();
                if pair != pairing {
                    s.status.peer = None;
                    s.received = None;
                    pairing = pair;
                }
                s.status.enabled = settings.two_pc_enabled;
                s.status.prefer_separate = settings.two_pc_prefer_separate;
                s.status.peer_ip = settings.two_pc_peer_ip.clone();
                s.status.peer_online = online;
                s.status.error = error.clone();
            }
            // Never send a secret off-tailnet or to a third PC.
            if settings.two_pc_enabled && online && error.is_none() {
                let result = client
                    .get(format!(
                        "http://{}:{PORT}/activity",
                        settings.two_pc_peer_ip
                    ))
                    .header("x-pair-secret", &settings.two_pc_secret)
                    .send()
                    .await;
                let peer = match result {
                    Ok(r) if r.status().is_success() => {
                        r.json::<NodeActivity>().await.map_err(|e| e.to_string())
                    }
                    Ok(r) => Err(format!("Peer activity returned {}", r.status())),
                    Err(_) => Err(
                        "Peer activity unavailable; install/enable pairing on the other PC".into(),
                    ),
                };
                let mut s = state().lock().unwrap();
                match peer {
                    Ok(p)
                        if p.protocol_version == 1
                            && p.ip == settings.two_pc_peer_ip
                            && !p.node_id.is_empty()
                            && p.node_id != local.node_id =>
                    {
                        s.status.peer = Some(p);
                        s.received = Some(Instant::now());
                        s.status.peer_seen_at = Some(chrono::Utc::now().timestamp());
                    }
                    Ok(_) => {
                        s.status.error = Some(
                            "Peer has an incompatible protocol or different machine identity"
                                .into(),
                        )
                    }
                    Err(e) => s.status.error = Some(e),
                }
            } else if !online {
                let mut s = state().lock().unwrap();
                s.received = None;
                s.status.peer = None;
            }
            // Store -> activity lock is the same order used by candidate scoring.
            {
                let st = store.lock().unwrap();
                let mut s = state().lock().unwrap();
                s.status.local =
                    local_snapshot(&st, local, s.last_id.as_deref(), s.last_at, &s.live);
                s.status.local.proxy_running = app
                    .try_state::<crate::AppState>()
                    .is_some_and(|a| a.proxy_handle.lock().map(|h| h.is_some()).unwrap_or(false));
            }
            let view = status();
            if view.enabled && view.prefer_separate && view.local.proxy_running {
                if let Some(peer) = view.peer.as_ref().filter(|p| {
                    p.proxy_running && same_account(&view.local, p) && must_yield(&view.local, p)
                }) {
                    let switched = {
                        let mut st = store.lock().unwrap();
                        let next =
                            crate::score_candidate_accounts(&st)
                                .into_iter()
                                .find(|(id, _, _)| {
                                    !reserved(&st, id)
                                        && st.accounts.get(id).is_some_and(|a| {
                                            AccountStore::extract_access_token(&a.auth_json)
                                                .is_some()
                                        })
                                });
                        if let Some((id, _, _)) = next {
                            let matches = st
                                .current
                                .as_ref()
                                .and_then(|id| st.accounts.get(id))
                                .and_then(identity)
                                .is_some_and(|a| reserved_by(peer, &a));
                            let hot = crate::account::should_hot_switch(&st.settings, true);
                            matches && st.switch_to(&id, hot).and_then(|_| st.save()).is_ok()
                        } else {
                            false
                        }
                    };
                    if switched {
                        crate::proxy::invalidate_remote_token_cache();
                        let _ = app.emit("accounts-updated", ());
                    }
                }
            }
            persist(&status());
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn node(id: &str, primary: bool, key: &str) -> NodeActivity {
        NodeActivity {
            node_id: id.into(),
            primary,
            proxy_running: true,
            selected: Some(AccountIdentity {
                key: key.into(),
                name: key.into(),
            }),
            ..Default::default()
        }
    }
    #[test]
    fn exactly_one_side_yields_even_with_equal_priority() {
        let a = node("a", true, "shared");
        let b = node("b", false, "shared");
        assert!(!must_yield(&a, &b));
        assert!(must_yield(&b, &a));
        let b = node("b", true, "shared");
        assert_ne!(must_yield(&a, &b), must_yield(&b, &a));
    }
    #[test]
    fn active_pc_keeps_account_regardless_of_machine_priority() {
        let mut legion = node("legion", false, "a");
        let think = node("think", true, "a");
        legion.live_accounts.push(LiveAccount {
            account: legion.selected.clone().unwrap(),
            connections: 1,
            since: 1,
        });
        assert!(!must_yield(&legion, &think));
        assert!(must_yield(&think, &legion));
        let mut think = think;
        legion.live_accounts.clear();
        think.live_accounts.push(LiveAccount {
            account: think.selected.clone().unwrap(),
            connections: 1,
            since: 1,
        });
        assert!(!must_yield(&think, &legion));
        assert!(must_yield(&legion, &think));
    }
    #[test]
    fn offline_proxy_does_not_reserve_an_account() {
        let mut p = node("p", false, "x");
        let a = AccountIdentity {
            key: "x".into(),
            name: "different label".into(),
        };
        assert!(reserved_by(&p, &a));
        p.proxy_running = false;
        assert!(!reserved_by(&p, &a));
    }
    fn account(id: &str, key: &str) -> Account {
        serde_json::from_value(serde_json::json!({"id":id,"name":id,"auth_json":{"tokens":{"account_id":key,"access_token":"eyJ-test"}},"refresh_token":null,"created_at":"2026-01-01T00:00:00Z","last_used":null,"notes":null})).unwrap()
    }
    #[test]
    fn distinct_accounts_are_preferred_and_sharing_remains_a_fallback() {
        let mut store = AccountStore::default();
        store
            .accounts
            .insert("local-uuid".into(), account("local-uuid", "a"));
        store.accounts.insert("other".into(), account("other", "b"));
        let peer = node("peer", false, "a");
        let mut scores = vec![
            ("local-uuid".into(), "a".into(), 100.0),
            ("other".into(), "b".into(), 10.0),
        ];
        order_for_peer(&store, &mut scores, &peer);
        assert_eq!(scores[0].0, "other");
        scores.retain(|(id, _, _)| id == "local-uuid");
        order_for_peer(&store, &mut scores, &peer);
        assert_eq!(scores[0].0, "local-uuid");
        let mut peer = peer;
        peer.proxy_running = false;
        scores.push(("other".into(), "b".into(), 10.0));
        order_for_peer(&store, &mut scores, &peer);
        assert_eq!(scores[0].0, "local-uuid");
    }
    #[test]
    fn stale_activity_expires_and_authentication_rejects_a_third_pc() {
        let s = ActivityState {
            received: Some(Instant::now() - FRESH),
            ..Default::default()
        };
        assert!(!peer_fresh(&s));
        let mut cfg = AppSettings::default();
        cfg.two_pc_enabled = true;
        cfg.two_pc_peer_ip = "100.95.7.78".into();
        cfg.two_pc_secret = "x".repeat(32);
        assert!(authorized(&cfg, "100.95.7.78", Some(&cfg.two_pc_secret)));
        assert!(!authorized(&cfg, "100.95.7.79", Some(&cfg.two_pc_secret)));
        assert!(!authorized(&cfg, "100.95.7.78", Some("wrong")));
        cfg.two_pc_enabled = false;
        assert!(!authorized(&cfg, "100.95.7.78", Some(&cfg.two_pc_secret)));
    }
    #[test]
    fn pairing_only_accepts_tailnet_addresses() {
        assert!(tailscale_ip("100.95.7.78").is_ok());
        for ip in [
            "127.0.0.1",
            "192.168.1.2",
            "100.128.0.1",
            "example.com",
            "http://100.95.7.78",
        ] {
            assert!(tailscale_ip(ip).is_err());
        }
    }
}
