# Local modifications to Codex Switcher

This tree is a locally modified build of upstream
[`VallierDev/codex-switcher`](https://github.com/VallierDev/codex-switcher).

| | |
|---|---|
| Upstream base | commit `f64a44a` — "fix: show the actual app version in the title bar" (2026-09-11), version **0.7.15** |
| Local branch | `english-ui-0.7.15` (no commits of its own — every change below is an *uncommitted working-tree change* on top of `f64a44a`) |
| Size of change | 58 modified tracked files (+2768 / −2029 lines) and 3 new files |
| Shipped binary | `src-tauri/target/release/codex-switcher`, installed on the original PC at `~/Applications/Codex-Switcher.AppDir/usr/bin/codex-switcher` (byte-identical, SHA-256 `20885594…`) |

To see the exact delta against upstream at any time:

```bash
git diff                      # tracked files vs f64a44a
git status --short            # includes the new untracked files
git diff --stat
```

A frozen copy of the delta is in `patches/local-modifications.patch` (tracked
files) — the three new files are in the tree itself (listed below).

> **Commit this first.** Nothing here is committed. On a new machine, the first
> thing to do is `git checkout -b local-mods && git add -A && git commit` so the
> work has history. (`.gitignore` already excludes `target/`, `node_modules/`,
> `dist/` and `docs/`.)

---

## 1. English UI and messages (largest part of the diff)

Upstream's UI, error strings, log lines and many comments are Chinese. Almost
every file in `src/` and `src-tauri/src/` was touched to translate user-facing
text to English: all of `src/components/*.tsx`, `src/hooks/*`, `src/data/*`, and
the Rust modules (`proxy.rs`, `account.rs`, `usage.rs`, `skills.rs`,
`remote_client.rs`, `remote_server.rs`, `oauth*.rs`, `otp_login.rs`, `mailbox.rs`,
`referrals.rs`, `bulk_import.rs`, `deep_link.rs`, `ide_control.rs`,
`session_*.rs`, `switch_log.rs`, `sentinel.rs`, `relay_catalog.rs`,
`antigravity/*`, …).

Chinese characters in the modified tracked files went from ~48,500 to ~35,200 (the
measurement covers the 58 modified files; the new `englishQuotaText.ts` adds 35 deliberately).
Of what remains, ~35,170 are in **code comments** (not translated) and ~4,780 are in
non-comment lines — mostly `proxy.rs`, `lib.rs`, `account.rs`. Those non-comment
leftovers are a mix of untranslated strings and literals the code **matches against**
(e.g. upstream quota/reset text). Find them with:

```bash
grep -rnP '[\x{4e00}-\x{9fff}]' src src-tauri/src --include='*.ts' --include='*.tsx' --include='*.rs' | grep -v '^\S*:\s*[0-9]*:\s*//'
```

**Do not blindly translate a Chinese literal** without checking whether it is a
parse target. Example: `src/utils/englishQuotaText.ts` (new) exists precisely
because quota labels and reset strings arrive in Chinese (`5小时`, `…分钟后重置`)
and are converted for display with regexes (`displayQuotaLabel`,
`displayResetText`).

## 2. Quota overlay widget (new feature)

A small always-on-top, frameless, transparent window (174×60) showing the
current account's 5h / weekly quota, shown while a Codex window is focused.

New files:
- `src/components/QuotaOverlay.tsx`, `src/components/QuotaOverlay.css` — the widget
  UI. Also rendered `embedded` inside the tray popup. Decides which account to
  display: when the proxy is running and the Codex config points at it, it shows
  the account the proxy last used for a *Codex Desktop* request within 10 minutes
  (label `DESKTOP VERIFIED`), otherwise the selected account (`PROXY SELECTED`);
  with no proxy routing it shows the account whose login is on disk (`DIRECT · DISK ID`).
- `src/utils/englishQuotaText.ts` — see §1.

Modified files:
- `src-tauri/src/tray.rs` (+235) — creates the `quota-overlay` window
  (`show_quota_overlay` / `toggle_quota_overlay`), a focus monitor thread
  (`monitor_quota_overlay_focus`, `codex_window_focused`, per-OS), tray menu items
  `tray-show-main`, `tray-quota-summary`, `tray-quota-overlay`, `tray-force-quit`,
  and `compact_account_name`.
- `src-tauri/capabilities/default.json` — the capability now covers the
  `quota-overlay` window and adds `core:window:allow-start-dragging` and
  `core:window:allow-hide`. **A new Tauri window needs a capability entry or its
  `invoke` calls fail silently.**
- `src-tauri/src/lib.rs` — commands `toggle_quota_overlay`,
  `set_quota_widget_identity`.
- `src-tauri/src/account.rs` — new setting `quota_widget_identity`
  (`"number"` | `"emoji"`, default via `default_quota_widget_identity`) and per-account
  `widget_number` / `widget_emoji`.
- `src/App.tsx`, `src/components/TrayPopup.tsx` (−126 lines; trimmed in favour of the
  embedded overlay), `TrayPopup.css`, `Settings.tsx`, `AccountList.tsx/.css`,
  `UsageCard.tsx`, `src/hooks/useUsage.ts`.

## 3. Codex Desktop awareness

The proxy now recognises requests from the Codex Desktop app via the HTTP header
`originator: Codex Desktop` (case-insensitive).

- `src-tauri/src/proxy.rs` — computes `codex_desktop` per request and carries it in
  `AffinityCtx` → `RequestUsage`. Session-affinity bookkeeping now also runs when a
  request has an account but no session key; *updates* to the affinity map are skipped
  when `session_key` is empty.
- `src-tauri/src/token_tracker.rs` — new `codex_desktop: bool` (`#[serde(default)]`, so
  old `token-history.jsonl` lines still load) on `TokenHistoryEntry` and `RequestUsage`.
- `src-tauri/src/lib.rs` — `codex_desktop_proxy_configured(port)` /
  `codex_config_has_proxy_url`: true only if `~/.codex/config.toml` has a **top-level**
  `openai_base_url = "http://127.0.0.1:<port>/v1"` (or `localhost`). A key inside a
  `[table]` does not count (unit test
  `desktop_proxy_config_must_be_top_level_and_match_port`). Exposed to the UI as
  `desktop_proxy_configured` in `get_proxy_status`.
- **Luna reserve routing** (`proxy.rs` + `usage.rs`): Codex Desktop may request a model
  such as `gpt-6-luna` while the usage endpoint still reports
  `normal_model_slug: gpt-5.6-luna`. `LunaReserveWindow` gained
  `is_luna_family_model()` (matches `gpt-reserve` or any slug containing `luna`) and
  `has_reserve_capacity()`; the reserve is used when capacity exists and the reported
  slug is in the luna family, instead of the exact-string match on `gpt-5.6-luna`.
  Tests were updated (`is_available_for("gpt-6-luna")`).

## 4. Switching, reload and routing control

In `src-tauri/src/lib.rs` and `src/App.tsx`:

- `open_codex_terminal(id)` — rewritten: checks whether the proxy is running, whether
  the account is an OpenAI account with an `access_token`, then launches a Codex
  terminal bound to that account. Linux and macOS only (other OSes return an error).
- `restart_chatgpt_desktop()` — quits and relaunches the ChatGPT/Codex desktop app so it
  re-reads `~/.codex/auth.json` (macOS: `osascript` + `open -a`; Linux: launches the
  official package's `/usr/bin/chatgpt` → `…/chatgpt/codex-launcher`). The UI shows a
  **"Reload Codex Desktop?"** confirmation after a switch because reloading interrupts
  active work.
- `disable_switcher_routing()` — one-shot "get out of the way" command. It clears every
  account's `is_session_anchor`; sets `proxy_enabled = false`, `background_refresh = false`,
  `quota_refresh_enabled = false`, `remote_mode = "off"`, `client_owns_current = false`,
  `solo_auto_sync_current = false`; saves settings; disconnects websockets
  (`ws_disconnect.notify_waiters()`); stops the proxy handles; and rewrites the Codex auth
  from the current OpenAI account so Codex works directly again. Added 2026-09-30
  (backup binary `codex-switcher.pre-disable-routing-20260930` on the original PC).

## 5. Build / config changes

- `src-tauri/Cargo.toml` — added
  ```toml
  [features]
  default = ["custom-protocol"]
  custom-protocol = ["tauri/custom-protocol"]
  ```
  so a bare `cargo build --release` embeds `../dist` instead of loading
  `http://localhost:1420` (symptom without it: "Could not connect to localhost:
  Connection refused"). `tauri build` injects this itself; plain `cargo` does not.

## 6. Reference files from the original machine (`local-env/`)

Not part of the app; kept so the original run environment can be recreated.

- `local-env/codex-switcher.launcher.sh` — the original `~/.local/bin/codex-switcher`
  launcher, unmodified. It runs `$HOME/Applications/Codex-Switcher.AppDir/usr/bin/codex-switcher`
  (override with `CODEX_SWITCHER_APPDIR`). It logs to `~/.codex-switcher/gui-launch.log`; refuses to
  start a second copy (a second instance cannot bind `:18080` and looks "broken") and raises the
  existing window via `xdotool`; forces X11 (`GDK_BACKEND=x11`, unsets `WAYLAND_DISPLAY`) and
  WebKit software rendering (`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`,
  `WEBKIT_FORCE_SOFTWARE_RENDERING`, `LIBGL_ALWAYS_SOFTWARE`) and clears proxy env vars. These were
  needed on the original machine to get the WebKit window to render; if the app renders fine with
  defaults on the new machine (e.g. via `npx tauri dev`) you do not need it.
- `local-env/codex-switcher.desktop` — the original menu entry (paths are for user `light-tarun`).

---

## History of the original install (for context)

`~/Applications/Codex-Switcher.AppDir/usr/bin/` on the original PC holds dated backups
of earlier builds that show the order of the work (none are transferred):
`.zh-bak` (stock Chinese build, 2026-09-11) → `bak-quota-ui-20260922` → `bak-overlay-20260923`
→ `bak-reload-20260923` → `bak-quota-compact-20260923` / `bak-compact-v1` / `bak-compact-half`
→ `bak-before-reset-visible-20260923` → `bak-pre-identity-battery-20260923` →
`pre-disable-routing-20260930` → current (2026-09-30). The pre-change stock AppImage is
`Codex-Switcher-0.7.15-amd64.AppImage.chinese-stock.bak` (90 MB).

## Things that are NOT in this package, on purpose

- `~/.codex-switcher/` — accounts and tokens (`accounts.json`), token/quota history,
  proxy logs, switch history, skills. Contains live credentials.
- `~/.codex/auth.json` and `config.toml` — the app edits these (adds `openai_base_url`).
- `src-tauri/target/` (14 GB build cache), `node_modules/` (195 MB), `dist/` (rebuilt by
  `npm run build`), `graphify-out/` (an unrelated knowledge-graph cache, 16 MB).
