# Codex Switcher — modified source, transfer package

Development snapshot of the locally modified Codex Switcher (Tauri 2 / Rust + React),
taken 2026-10-04 on the original PC (user `light-tarun`, Ubuntu 26.04 x86_64).
This is a **source archive for further development, not an installer.**

## Read in this order

1. `LOCAL-MODIFICATIONS.md` — what was changed relative to upstream, file by file, and why.
2. `DEVELOPMENT.md` — prerequisites, build / run / test, where code lives, recipes, gotchas.
3. `local-env/` — the original launcher script and desktop entry, for reference.
4. `patches/local-modifications.patch` — the same changes as one `git diff`
   against upstream commit `f64a44a`.

## Extract and start

```bash
tar -xf codex-switcher-dev-source-0.7.15-local.tar.xz
cd codex-switcher
git status --short          # local modifications show as uncommitted: expected
npm ci
npm run build && (cd src-tauri && cargo build --release)
```

Prerequisites and the full command table are in `DEVELOPMENT.md`. Needs network on the first build.

## What the archive contains

- The complete working tree **including `.git`** (upstream history up to `f64a44a`, remote
  `origin = github.com/VallierDev/codex-switcher`), so `git diff` shows every local change.
- New, uncommitted source files: `src/components/QuotaOverlay.{tsx,css}`, `src/utils/englishQuotaText.ts`.
- The three docs above, `local-env/`, and `patches/`.

## What it deliberately does NOT contain

| Left out | Why / what to do |
|---|---|
| `~/.codex-switcher/` (accounts, tokens, history, logs) | Live credentials. The new machine starts clean; log in to your accounts there. |
| `~/.codex/auth.json`, `config.toml` | Per-machine Codex state, edited by the app. |
| `src-tauri/target/` (14 GB), `node_modules/` (195 MB), `dist/` | Rebuildable: `npm ci`, `npm run build`, `cargo build --release`. |
| `graphify-out/` | Unrelated knowledge-graph cache (16 MB); regenerate if you use graphify. |
| Compiled binaries | Build from source; the original machine's binary SHA-256 was `20885594896be7a7…`. |

Secret scan of the shipped tree: only obvious test fixtures (`"refresh_token":"rt"`, `test-st`, etc.) —
no real tokens or keys.

## Verified before packaging (original machine)

- `npx tsc --noEmit` passes.
- `vite build` output is byte-identical to the shipped `dist/`.
- `cargo build --release --offline` succeeds and yields a binary byte-identical to the one installed.
- `patches/local-modifications.patch` applies cleanly to a pristine export of upstream `f64a44a`.
- Not run: `cargo test`, `npx tauri dev`, `npx tauri build`.

## Pitfalls to know up front

- `~/.codex/config.toml`: when the proxy is on, the app sets a top-level `openai_base_url` pointing at
  `127.0.0.1:18080`. Don't run this against your real Codex setup until you've backed that file up.
- Test with a throwaway `HOME` (see `DEVELOPMENT.md`) to avoid touching real accounts.
- Prefer committing everything to a local branch before changing anything (`DEVELOPMENT.md`, "Housekeeping").
