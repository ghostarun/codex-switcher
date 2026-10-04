# Developing the modified Codex Switcher

Read `LOCAL-MODIFICATIONS.md` first for what differs from upstream. This file is how
to set up, build, run, change and ship the code. (`AGENTS.md` / `Agent.md` are upstream's
notes; where they mention macOS `.app` bundles and a "mini mac", ignore that — this build is
used on Linux.)

## Stack

Tauri 2 desktop app. Rust backend in `src-tauri/src/`, React 19 + TypeScript frontend in
`src/` built with Vite 7 (plain CSS, no UI library — keep it that way, per `AGENTS.md`:
"don't introduce dependencies you can do without"). The frontend is compiled to `dist/`
and **embedded into the Rust binary at compile time**, so a frontend change only reaches the
binary after `npm run build` *and* a Rust rebuild.

## Prerequisites

Built and verified on Ubuntu 26.04 (x86_64) with: Rust **1.98.1** (rustup, stable; no
`rust-toolchain` file pins it), Node **22.22.1**, npm **9.2.0**, and these apt packages already
installed there: `build-essential libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libssl-dev
libayatana-appindicator3-dev`. Tauri 2's usual Linux prerequisites also include
`librsvg2-dev patchelf libxdo-dev pkg-config` — those were not individually checked on the original
machine, so if the build asks for them, install them.

```bash
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libsoup-3.0-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev
curl https://sh.rustup.rs -sSf | sh        # if Rust is not installed
```

The first build needs network access (npm + crates.io). It downloads ~640 crates and compiles for a
while; later builds are incremental (a rebuild after touching only the app crate took ~75 s here).

## Set up

```bash
tar -xf codex-switcher-dev-source-*.tar.xz && cd codex-switcher
git status --short            # shows the uncommitted local modifications (expected)
npm ci                        # installs from package-lock.json
```

## Build

| Goal | Command (from repo root unless noted) |
|---|---|
| Type-check frontend | `npx tsc --noEmit` |
| Build frontend → `dist/` | `npm run build` (= `tsc && vite build`) |
| Build release binary | `npm run build && (cd src-tauri && cargo build --release)` → `src-tauri/target/release/codex-switcher` |
| Same via Tauri CLI, no installer bundles | `npx tauri build --no-bundle` |
| Live-reload dev run | `npx tauri dev` (starts Vite on `:1420`, then the app) |

Why `cargo build` alone works: this tree adds `default = ["custom-protocol"]` in
`src-tauri/Cargo.toml` (see `LOCAL-MODIFICATIONS.md` §5). Without it, a plain cargo build opens a
window pointing at `http://localhost:1420`.

**Verified on the original machine (2026-10-04):** `npx tsc --noEmit` passes; `npx vite build`
output is byte-identical to the shipped `dist/`; `cargo build --release --offline` finishes
(`exit 0`, 13 compiler warnings) and produces a binary **byte-identical** to the one that was running
(SHA-256 `20885594896be7a7…`). So this tree is exactly the source of the shipped binary. The
reproducible-binary property may not survive a different Rust version or dependency resolution on
another machine — don't treat a hash difference as corruption.

**Not verified:** `npx tauri dev`, `npx tauri build`, and the test suites below were not run during
packaging.

## Run

- From a build: run `src-tauri/target/release/codex-switcher` directly. If the window is blank or
  broken on your GPU/Wayland setup, use the environment in `local-env/codex-switcher.launcher.sh`
  (forces X11 and WebKit software rendering) — e.g. `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1
  WEBKIT_DISABLE_COMPOSITING_MODE=1 ./codex-switcher`.
- Only one instance can run: the in-process proxy binds `127.0.0.1:18080` (configurable in Settings).
  A second copy fails to bind and looks broken — check `pgrep -af codex-switcher` first.
- **After any change to `src-tauri/src/proxy.rs` you must restart the app** — the proxy runs in-process.
- Use a throwaway `HOME` when testing so you never touch real accounts:
  `HOME=/tmp/cs-home ./codex-switcher` (it creates `~/.codex-switcher/` under that HOME; a clean-HOME
  launch was verified to start).

## Where things live

Backend, `src-tauri/src/` (from `AGENTS.md`, plus the local additions):

- `proxy.rs` — main HTTP + WebSocket proxy. Read `handle_request`, `handle_websocket` and
  `get_upstream` (3 branches: ChatGPT / OpenAI key / Relay) before changing it. Local change:
  Codex Desktop detection, Luna reserve routing.
- `account.rs` — `AccountKind` (Legacy / ChatgptOauth / OpenaiKey / Relay) and `AppSettings`
  (local: `quota_widget_identity`).
- `usage.rs` — quota fetchers per account kind; `LunaReserveWindow`.
- `token_tracker.rs` — token/cost history (`token-history.jsonl`).
- `output_compress.rs` — shell-output compressor hooked into the Codex WS and Claude SSE paths.
- `tray.rs` — tray menu and the quota overlay window (local).
- `lib.rs` — Tauri commands and app wiring (the biggest file; ~7000 lines including tests).
- `oauth*.rs`, `otp_login.rs`, `mailbox.rs`, `remote_*.rs`, `skills.rs`, `session_*.rs`, … — see file names.

Frontend: `src/App.tsx`, `src/components/*` (Settings UI in `Settings.tsx`; mirror its existing toggle
pattern rather than inventing layouts), `src/hooks/*`, `src/data/*`, `src/utils/*`.

Tests: Rust unit tests live inline (`#[cfg(test)]` in `lib.rs`, `account.rs`, `bulk_import.rs`,
`remote_*.rs`, …) and in `src-tauri/tests/` (`anchor_e2e.rs`, `integration_glm_translate.rs`). Run with
`cd src-tauri && cargo test`. Helper scripts for relay/GLM/Google probes are in `scripts/`
(`*.mjs`, `smoke-glm.sh`).

## Recipes

**Add a Tauri command:** write `#[tauri::command] fn …` in `lib.rs` (or a module), register it in the
`.invoke_handler(tauri::generate_handler![…])` list in `lib.rs` (near line 6520), call it from TS with `invoke('name', { args })`.
Forgetting the handler registration gives a runtime "command not found".

**Add a window:** besides creating it (see `tray.rs::show_quota_overlay`), add its label to `windows`
in `src-tauri/capabilities/default.json`, plus any `core:window:*` permission it needs (that is how the
overlay got drag/hide). Without this its `invoke` calls fail.

**Add a setting:** field + serde default in `AppSettings` (`account.rs`) so old `accounts.json` files
still load; add a getter/setter command; add a toggle in `Settings.tsx`.

**Persisted formats must stay backward compatible:** `accounts.json`, `token-history.jsonl`,
`session_routes.json` are read from existing user installs. New fields need `#[serde(default)]`
(as `codex_desktop` did).

**Translating more text:** check first whether the Chinese literal is *matched against* (quota labels,
upstream error text) — see `src/utils/englishQuotaText.ts` and `LOCAL-MODIFICATIONS.md` §1.

## Runtime state and side effects (what the app touches on a machine)

- `~/.codex-switcher/` — `accounts.json` (live credentials, mode 600), `proxy.log` (grows large: 89 MB on
  the original machine), `quota-snapshots.jsonl`, `switch-history.jsonl`, `token-history.jsonl`,
  `session_routes.json`, `proxy-usage.json`, `skills/`, `skills.json`, `gui-launch.log`.
- `~/.local/share/com.codex.switcher/` — webview storage.
- `~/.codex/auth.json` — rewritten when switching accounts.
- `~/.codex/config.toml` — the proxy mode sets a top-level `openai_base_url = "http://127.0.0.1:<port>/v1"`.
  Back up before experimenting (the original machine has `config.toml.bak-*` copies). The in-app
  "disable routing" action (`disable_switcher_routing`) turns the proxy and refreshers off and
  restores direct Codex auth.
- Skill syncing mirrors skill folders into other tools' config dirs (e.g. `~/.gemini/config/skills/`).
- Registers URL schemes `codexswitch://` and `ccswitch://` (deep links).

## Shipping a rebuilt binary on a machine that already has the app

Convention used on the original machine: keep a dated backup, then swap the binary and restart.

```bash
APP=~/Applications/Codex-Switcher.AppDir/usr/bin
cp $APP/codex-switcher $APP/codex-switcher.bak-$(date +%Y%m%d)
install -m755 src-tauri/target/release/codex-switcher $APP/codex-switcher
pkill -f 'Codex-Switcher.AppDir/usr/bin/codex-switcher$'; codex-switcher &
```

(That layout is specific to the original machine — see `README-TRANSFER.md` for what the new machine
has instead.)

## Housekeeping suggestions

- Commit the work: `git switch -c local-mods && git add -A && git commit -m "Local modifications on 0.7.15"`
  (exclude `graphify-out/` if present). `LOCAL-MODIFICATIONS.md` describes the changes at the file level
  but git history is the better long-term record.
- Upstream `docs/` is gitignored and was left as it was in the working tree.
- `proxy.rs` and `lib.rs` are very large; prefer small, targeted edits and keep `cargo test` green.
