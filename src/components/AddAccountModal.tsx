import { useState, useEffect } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useAccounts } from '../hooks/useAccounts';
import { RELAY_PRESETS } from '../data/relay_presets';
import './AddAccountModal.css';

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (name: string, notes?: string) => Promise<void>;
    onSuccess?: () => void;  // Callback after successful add, to refresh parent list
}

type TabType = 'official' | 'openai' | 'google' | 'bulk' | 'relay' | 'session';

interface ImportedSessionInfo {
    email: string | null;
    plan_type: string | null;
    account_id: string | null;
    expires_at: string | null;
    has_refresh_token: boolean;
    id_token_synthetic: boolean;
}
interface ImportedAccountItem {
    account: { id: string; name: string };
    info: ImportedSessionInfo;
}
interface ImportSessionResult {
    ok: ImportedAccountItem[];
    errors: { source_path: string; reason: string }[];
}

interface BulkImportSummary {
    format: string;
    parsed: number;
    errors: string[];
}

interface BulkParsedAccountInfo {
    email: string;
    plan_type: string | null;
    account_id: string | null;
    needs_refresh: boolean;
}

interface BulkImportResult {
    summaries: BulkImportSummary[];
    accounts: BulkParsedAccountInfo[];
    fatal: string[];
}

const BULK_FORMAT_LABEL: Record<string, string> = {
    cpa: 'cpa (codex_credentials)',
    sub2api: 'sub2api',
    cockpit: 'Cockpit',
    'four-segment-rt': 'four-segment RT',
    native: 'codex-switcher',
};

function bytesToBase64(bytes: Uint8Array): string {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, i + CHUNK);
        binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(binary);
}

export function AddAccountModal({ isOpen, onClose, onAdd, onSuccess }: AddAccountModalProps) {
    const { startOAuthLogin, finalizeOAuthLogin } = useAccounts();
    const [activeTab, setActiveTab] = useState<TabType>('openai');
    const [name, setName] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [oauthStatus, setOauthStatus] = useState<string>('');
    const [showPasteInput, setShowPasteInput] = useState(false);
    const [callbackInput, setCallbackInput] = useState('');
    const [submittingCallback, setSubmittingCallback] = useState(false);
    // Bulk import
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    // ChatGPT Web session import (no refresh_token; works until access_token expires)
    const [sessionInput, setSessionInput] = useState('');
    const [sessionBusy, setSessionBusy] = useState(false);
    const [sessionResult, setSessionResult] = useState<ImportSessionResult | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);
    // Relay
    const [relayPresetId, setRelayPresetId] = useState<string>(RELAY_PRESETS[0]?.id ?? 'custom');
    const [relayName, setRelayName] = useState<string>(RELAY_PRESETS[0]?.name ?? '');
    const [relayBaseUrl, setRelayBaseUrl] = useState<string>(RELAY_PRESETS[0]?.base_url ?? '');
    const [relayApiKey, setRelayApiKey] = useState<string>('');
    const [relayUsagePreset, setRelayUsagePreset] = useState<string | null>(
        RELAY_PRESETS[0]?.usage_preset ?? null,
    );
    const [relayUsageCookie, setRelayUsageCookie] = useState<string>('');
    const [relayModelFallback, setRelayModelFallback] = useState<string>(
        RELAY_PRESETS[0]?.model_fallback ?? '',
    );
    // Upstream protocol: 'responses' (default / codex /v1/responses) / 'chat_completions' (GLM etc. only /chat/completions)
    const [relayProtocol, setRelayProtocol] = useState<string>(
        RELAY_PRESETS[0]?.relay_protocol ?? 'responses',
    );
    // Model map shown in textarea ("key=value\n..." format) for editing
    const [relayModelMapText, setRelayModelMapText] = useState<string>(() => {
        const m = RELAY_PRESETS[0]?.model_map;
        return m ? Object.entries(m).map(([k, v]) => `${k}=${v}`).join('\n') : '';
    });
    const [relaySubmitting, setRelaySubmitting] = useState(false);
    const [relayError, setRelayError] = useState<string | null>(null);

    const handlePickRelayPreset = (id: string) => {
        const preset = RELAY_PRESETS.find(p => p.id === id);
        setRelayPresetId(id);
        if (preset) {
            setRelayName(preset.name);
            setRelayBaseUrl(preset.base_url);
            setRelayUsagePreset(preset.usage_preset ?? null);
            setRelayUsageCookie('');
            setRelayModelFallback(preset.model_fallback ?? '');
            setRelayProtocol(preset.relay_protocol ?? 'responses');
            const m = preset.model_map ?? {};
            setRelayModelMapText(Object.entries(m).map(([k, v]) => `${k}=${v}`).join('\n'));
        }
        setRelayError(null);
    };

    /** Parse textarea to { key: value }; skip empty lines / comments / lines without = */
    const parseModelMapText = (text: string): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            const k = trimmed.slice(0, eq).trim();
            const v = trimmed.slice(eq + 1).trim();
            if (k && v) out[k] = v;
        }
        return out;
    };

    const handleSubmitRelay = async () => {
        setRelayError(null);
        if (!relayName.trim()) {
            setRelayError('Account name cannot be empty');
            return;
        }
        if (!/^https?:\/\//.test(relayBaseUrl.trim())) {
            setRelayError('Base URL must start with http:// or https://');
            return;
        }
        if (relayApiKey.trim().length < 8) {
            setRelayError('API Key looks too short');
            return;
        }
        if (relayUsagePreset === 'mimo_token_plan' && !relayUsageCookie.trim()) {
            setRelayError('MiMo quota lookup requires a Cookie from platform.xiaomimimo.com; to skip quota, set balance strategy to "Do not fetch".');
            return;
        }
        setRelaySubmitting(true);
        try {
            const preset = RELAY_PRESETS.find(p => p.id === relayPresetId);
            const modelMap = parseModelMapText(relayModelMapText);
            await invoke('add_relay_account', {
                name: relayName.trim(),
                baseUrl: relayBaseUrl.trim(),
                apiKey: relayApiKey.trim(),
                homepage: preset?.homepage ?? null,
                usagePreset: relayUsagePreset ?? null,
                usageCookie: relayUsageCookie.trim() || null,
                notes: `from preset:${relayPresetId}`,
                modelMap: Object.keys(modelMap).length > 0 ? modelMap : null,
                modelFallback: relayModelFallback.trim() || null,
                relayProtocol: relayProtocol === 'responses' ? null : relayProtocol,
            });
            await emit('accounts-updated');
            // Reset form
            setRelayApiKey('');
            setRelayUsageCookie('');
            handleClose();
        } catch (e) {
            setRelayError(typeof e === 'string' ? e : String(e));
        } finally {
            setRelaySubmitting(false);
        }
    };

    // Listen for authorization code from backend
    useEffect(() => {
        if (!isOpen) return;

        const unlisten = listen<string>('oauth-callback-received', async (event) => {
            const code = event.payload;
            setOauthStatus('Authorization code received; exchanging token...');
            try {
                await finalizeOAuthLogin(code);
                setOauthStatus('Authorization successful! Account added.');
                setLoading(false);
                // Delay closing modal so user sees success message
                setTimeout(() => {
                    onSuccess?.();  // Notify parent to refresh list
                    onClose();
                }, 1000);
            } catch (err) {
                setError(String(err));
                setOauthStatus('');
                setLoading(false);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [isOpen, finalizeOAuthLogin]);

    useEffect(() => {
        if (!isOpen) return;
        const unlisten = listen<string>('antigravity-oauth-callback-received', async (event) => {
            setOauthStatus('Google auth code received; verifying account and project...');
            try {
                await invoke('finalize_antigravity_oauth_login', { code: event.payload });
                setOauthStatus('Google Antigravity account added.');
                setLoading(false);
                setTimeout(() => {
                    onSuccess?.();
                    onClose();
                }, 1000);
            } catch (err) {
                setError(String(err));
                setOauthStatus('');
                setLoading(false);
            }
        });
        return () => { unlisten.then(f => f()); };
    }, [isOpen, onClose, onSuccess]);

    if (!isOpen) return null;

    // Handle official import
    const handleSubmitOfficial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('Please enter account name');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await onAdd(name.trim(), notes.trim() || undefined);
            handleClose();
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    // Handle OpenAI login
    const handleOpenAILogin = async () => {
        setLoading(true);
        setError(null);
        setOauthStatus('Starting official browser authorization...');

        try {
            // Start OAuth backend task; opens browser and listener
            await startOAuthLogin();
            setOauthStatus('Complete OpenAI authorization in the opened browser window...');
        } catch (err) {
            setError(String(err));
            setOauthStatus('');
            setLoading(false);
        }
    };

    // Copy auth link (no default browser — user picks browser to paste into)
    const handleCopyOAuthLink = async () => {
        setLoading(true);
        setError(null);
        setOauthStatus('Generating authorization link...');

        try {
            const url = await startOAuthLogin(false);
            // Use backend pbcopy not navigator.clipboard (webview loses user-gesture after await)
            try {
                await invoke('copy_to_clipboard', { text: url });
                setOauthStatus('Auth link copied — paste in your browser; callback returns to this app...');
            } catch (copyErr) {
                // If copy fails, show URL for manual copy
                setCallbackInput(url);
                setShowPasteInput(false);
                setOauthStatus(`Clipboard copy failed (${String(copyErr)}); copy manually:\n${url}`);
            }
        } catch (err) {
            setError(String(err));
            setOauthStatus('');
            setLoading(false);
        }
    };

    const handleAntigravityLogin = async () => {
        setLoading(true);
        setError(null);
        setOauthStatus('Starting Google Antigravity authorization...');
        try {
            await invoke<string>('start_antigravity_oauth_login', { openBrowser: true });
            setOauthStatus('Complete Google authorization in the browser...');
        } catch (err) {
            setError(String(err));
            setOauthStatus('');
            setLoading(false);
        }
    };

    const handleCopyAntigravityOAuthLink = async () => {
        setLoading(true);
        setError(null);
        setOauthStatus('Generating Google auth link...');
        try {
            const url = await invoke<string>('start_antigravity_oauth_login', { openBrowser: false });
            try {
                await invoke('copy_to_clipboard', { text: url });
                setOauthStatus('Google auth link copied — paste in your browser to finish...');
            } catch (copyError) {
                setOauthStatus(`Clipboard copy failed (${String(copyError)}); copy manually:\n${url}`);
            }
        } catch (err) {
            setError(String(err));
            setOauthStatus('');
            setLoading(false);
        }
    };

    const handleClose = () => {
        // OAuth in progress can close; backend aborts old task on next start
        setName('');
        setNotes('');
        setError(null);
        setOauthStatus('');
        setLoading(false);
        setShowPasteInput(false);
        setCallbackInput('');
        // Keep bulk import results until next open; bulkBusy prevents mis-clicks
        // Session import: clear input after success; keep result for review
        if (sessionResult && sessionResult.ok.length > 0) {
            setSessionInput('');
        }
        onClose();
    };

    const handleBulkPickAndImport = async () => {
        setBulkError(null);
        setBulkResult(null);
        const selection = await openDialog({
            multiple: true,
            filters: [
                { name: 'Account import files', extensions: ['json', 'zip', 'txt'] },
                { name: 'All files', extensions: ['*'] },
            ],
        });
        const paths: string[] = Array.isArray(selection) ? selection : (selection ? [selection] : []);
        if (paths.length === 0) return;
        setBulkBusy(true);
        try {
            const files = await Promise.all(paths.map(async (p) => {
                const bytes = await readFile(p);
                const filename = p.split('/').pop() || p;
                return { filename, content_b64: bytesToBase64(bytes) };
            }));
            const r = await invoke<BulkImportResult>('bulk_import_accounts', { files });
            setBulkResult(r);
            onSuccess?.();
        } catch (e: any) {
            setBulkError(`${e}`);
        } finally {
            setBulkBusy(false);
        }
    };

    // ChatGPT Web session import: paste chatgpt.com session JSON (with accessToken)
    // → convert to auth.json and store. See gtxx3600/GPTSession2CPAandSub2API.
    // No refresh_token; ~30 days later access_token expires — re-import required.
    const handleSessionImport = async () => {
        setSessionError(null);
        setSessionResult(null);
        if (!sessionInput.trim()) {
            setSessionError('Please paste ChatGPT session JSON');
            return;
        }
        setSessionBusy(true);
        try {
            const r = await invoke<ImportSessionResult>('import_chatgpt_session', {
                sessionJson: sessionInput,
            });
            setSessionResult(r);
            if (r.ok.length > 0) {
                await emit('accounts-updated');
                onSuccess?.();
            }
        } catch (e: any) {
            setSessionError(String(e));
        } finally {
            setSessionBusy(false);
        }
    };

    // Manually submit callback URL when browser cannot return to app
    const handleSubmitCallback = async () => {
        const input = callbackInput.trim();
        if (!input) return;
        setSubmittingCallback(true);
        setError(null);
        try {
            await invoke('submit_oauth_callback', { input });
            // Backend emits oauth-callback-received; listener finalizes OAuth
            setOauthStatus('Callback URL submitted; exchanging token...');
            setCallbackInput('');
            setShowPasteInput(false);
        } catch (err) {
            setError(String(err));
        } finally {
            setSubmittingCallback(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={handleClose}>
            <div
                className={`modal-content${activeTab === 'relay' ? ' modal-wide' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header">
                    <div className="header-top">
                        <h2>Add Account</h2>
                        <button className="close-btn" onClick={handleClose}>
                            ×
                        </button>
                    </div>
                    <div className="modal-tabs">
                        <button
                            className={`tab-item ${activeTab === 'openai' ? 'active' : ''}`}
                            onClick={() => !loading && setActiveTab('openai')}
                        >
                            OpenAI Login (Recommended)
                        </button>
                        <button
                            className={`tab-item ${activeTab === 'official' ? 'active' : ''}`}
                            onClick={() => !loading && setActiveTab('official')}
                        >
                            Import from Official
                        </button>
                        <button
                            className={`tab-item ${activeTab === 'google' ? 'active' : ''}`}
                            onClick={() => !loading && setActiveTab('google')}
                        >
                            Google / Antigravity
                        </button>
                        <button
                            className={`tab-item ${activeTab === 'bulk' ? 'active' : ''}`}
                            onClick={() => !loading && setActiveTab('bulk')}
                        >
                            Bulk Import Files
                        </button>
                        <button
                            className={`tab-item ${activeTab === 'session' ? 'active' : ''}`}
                            onClick={() => !loading && setActiveTab('session')}
                        >
                            Session Import
                        </button>
                        {/* "Relay" tab moved to AddRelayModal — see App.tsx "+ Add Relay" */}
                    </div>
                </div>

                <div className="modal-body">
                    {activeTab === 'bulk' ? (
                        <div className="bulk-panel">
                            <p className="modal-tip">
                                Auto-detect format; select multiple files:<b>cpa</b>(codex_credentials zip / single .json),
                                <b> sub2api</b>, <b>Cockpit</b>, <b>four-segment RT</b>
                                (<code>email----xxx----xxx----rt_xxx</code>),
                                <b> codex-switcher native accounts.json</b>.
                                Existing email skipped; tokens not overwritten.
                            </p>
                            <button
                                className="btn btn-primary btn-full"
                                style={{ padding: '14px' }}
                                onClick={handleBulkPickAndImport}
                                disabled={bulkBusy}
                            >
                                {bulkBusy ? 'Importing…' : 'Select files and import'}
                            </button>
                            {bulkError && <div className="error-msg" style={{ marginTop: 12 }}>{bulkError}</div>}
                            {bulkResult && (
                                <div className="bulk-result" style={{ marginTop: 16 }}>
                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                                        <span className="bulk-stat">Parsed {bulkResult.summaries.reduce((s, x) => s + x.parsed, 0)}</span>
                                        <span className="bulk-stat ok">Added {bulkResult.accounts.length}</span>
                                        {bulkResult.summaries.reduce((s, x) => s + x.parsed, 0) - bulkResult.accounts.length > 0 && (
                                            <span className="bulk-stat skip">
                                                Skipped {bulkResult.summaries.reduce((s, x) => s + x.parsed, 0) - bulkResult.accounts.length} (duplicate)
                                            </span>
                                        )}
                                        {bulkResult.fatal.length > 0 && (
                                            <span className="bulk-stat fail">Failed {bulkResult.fatal.length}</span>
                                        )}
                                    </div>
                                    {bulkResult.summaries.map((s, i) => (
                                        <div key={i} className="bulk-summary-item">
                                            <span className="format-tag">{BULK_FORMAT_LABEL[s.format] || s.format}</span>
                                            <span>Parsed {s.parsed} account(s)</span>
                                        </div>
                                    ))}
                                    {bulkResult.fatal.map((msg, i) => (
                                        <div key={`f-${i}`} className="bulk-fatal">⚠️ {msg}</div>
                                    ))}
                                    {bulkResult.accounts.length > 0 && (
                                        <details style={{ marginTop: 8 }}>
                                            <summary style={{ cursor: 'pointer', color: '#aaa', fontSize: '12.5px', padding: '6px 0' }}>
                                                Added accounts ({bulkResult.accounts.length})
                                            </summary>
                                            <table className="bulk-table">
                                                <thead>
                                                    <tr><th>Email</th><th>Plan</th><th>Status</th></tr>
                                                </thead>
                                                <tbody>
                                                    {bulkResult.accounts.map((a, i) => (
                                                        <tr key={i}>
                                                            <td>{a.email}</td>
                                                            <td>{a.plan_type || '—'}</td>
                                                            <td>{a.needs_refresh ? <span className="needs-refresh">⚠ RT only; auto refresh on first request</span> : '✓ ready'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </details>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'session' ? (
                        <div className="bulk-panel">
                            <p className="modal-tip">
                                Paste <b>chatgpt.com web session JSON</b> (<code>accessToken / user.email / account.id</code>),
                                Bypass Codex phone verification. Single object, array, or nested — auto-detected.
                                <br />
                                <b style={{ color: 'var(--text-secondary)' }}>Note:</b>
                                Web session has no <code>refresh_token</code>; after ~30 days <code>access_token</code> expires the account stops working.
                                Re-paste a new session. Plus can call models; Free has no API access even after import.
                            </p>
                            <textarea
                                className="text-input"
                                style={{ width: '100%', minHeight: 260, fontFamily: 'monospace', fontSize: 12 }}
                                value={sessionInput}
                                onChange={e => setSessionInput(e.target.value)}
                                placeholder={`{\n  "user": {"id": "user-...", "email": "you@example.com"},\n  "expires": "2026-08-06T14:29:36.155Z",\n  "account": {"id": "uuid", "planType": "plus"},\n  "accessToken": "eyJhbGciOi...",\n  "sessionToken": "..."\n}`}
                                disabled={sessionBusy}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ flex: 1, padding: '12px' }}
                                    onClick={handleSessionImport}
                                    disabled={sessionBusy || !sessionInput.trim()}
                                >
                                    {sessionBusy ? 'Importing…' : 'Parse and import'}
                                </button>
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => { setSessionInput(''); setSessionResult(null); setSessionError(null); }}
                                    disabled={sessionBusy || (!sessionInput && !sessionResult && !sessionError)}
                                >
                                    Clear
                                </button>
                            </div>
                            {sessionError && <div className="error-message" style={{ marginTop: 12 }}>{sessionError}</div>}
                            {sessionResult && (
                                <div className="bulk-result" style={{ marginTop: 16 }}>
                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                                        <span className="bulk-stat ok">Added {sessionResult.ok.length}</span>
                                        {sessionResult.errors.length > 0 && (
                                            <span className="bulk-stat fail">Failed {sessionResult.errors.length}</span>
                                        )}
                                    </div>
                                    {sessionResult.ok.length > 0 && (
                                        <details open style={{ marginTop: 8 }}>
                                            <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12.5, padding: '6px 0' }}>
                                                Imported accounts ({sessionResult.ok.length})
                                            </summary>
                                            <table className="bulk-table">
                                                <thead>
                                                    <tr><th>Email</th><th>Plan</th><th>Notes</th></tr>
                                                </thead>
                                                <tbody>
                                                    {sessionResult.ok.map((item, i) => (
                                                        <tr key={i}>
                                                            <td>{item.info.email || item.account.name}</td>
                                                            <td>{item.info.plan_type || '—'}</td>
                                                            <td>
                                                                {item.info.has_refresh_token
                                                                    ? '✓ has refresh_token'
                                                                    : <span className="needs-refresh">⚠ no refresh_token; re-import after expiry</span>}
                                                                {item.info.id_token_synthetic ? '(id_token synthesized)' : ''}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </details>
                                    )}
                                    {sessionResult.errors.length > 0 && (
                                        <details open style={{ marginTop: 8 }}>
                                            <summary style={{ cursor: 'pointer', color: 'var(--danger, #c54)', fontSize: 12.5, padding: '6px 0' }}>
                                                Failed ({sessionResult.errors.length})
                                            </summary>
                                            {sessionResult.errors.map((err, i) => (
                                                <div key={i} className="bulk-fatal">⚠ {err.source_path}: {err.reason}</div>
                                            ))}
                                        </details>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'relay' ? (
                        <div className="relay-panel">
                            <p className="modal-tip" style={{ marginBottom: 12 }}>
                                Pick preset for base_url; paste API Key. Also <code>codexswitch://</code> deep link.
                            </p>

                            <div className="relay-form-grid">
                            <div className="form-group form-group-full">
                                <label htmlFor="relay-preset">Preset</label>
                                <select
                                    id="relay-preset"
                                    value={relayPresetId}
                                    onChange={e => handlePickRelayPreset(e.target.value)}
                                    disabled={relaySubmitting}
                                >
                                    {RELAY_PRESETS.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}{p.description ? ` — ${p.description}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="relay-name">Account name *</label>
                                <input
                                    id="relay-name"
                                    type="text"
                                    value={relayName}
                                    onChange={e => setRelayName(e.target.value)}
                                    disabled={relaySubmitting}
                                    placeholder="e.g. unity2-work"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="relay-base">Base URL *</label>
                                <input
                                    id="relay-base"
                                    type="text"
                                    value={relayBaseUrl}
                                    onChange={e => setRelayBaseUrl(e.target.value)}
                                    disabled={relaySubmitting}
                                    placeholder="https://unity2.ai"
                                    style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="relay-key">API Key (sk-... / tp-...) *</label>
                                <input
                                    id="relay-key"
                                    type="password"
                                    value={relayApiKey}
                                    onChange={e => setRelayApiKey(e.target.value)}
                                    disabled={relaySubmitting}
                                    placeholder="sk-... / tp-..."
                                    style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="relay-usage">Balance fetch strategy</label>
                                <select
                                    id="relay-usage"
                                    value={relayUsagePreset ?? ''}
                                    onChange={e => setRelayUsagePreset(e.target.value || null)}
                                    disabled={relaySubmitting}
                                >
                                    <option value="">Do not fetch</option>
                                    <option value="openai_compat">openai_compat (GET /v1/usage)</option>
                                    <option value="glm_zhipu">glm_zhipu (GLM quota API)</option>
                                    <option value="kimi_coding">kimi_coding (Kimi coding plan 5H / 7D)</option>
                                    <option value="mimo_token_plan">mimo_token_plan (MiMo console Cookie)</option>
                                </select>
                            </div>

                            {relayUsagePreset === 'mimo_token_plan' && (
                                <div className="form-group form-group-full">
                                    <label htmlFor="relay-usage-cookie">
                                        MiMo quota Cookie <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: 12 }}>
                                            After signing in at platform.xiaomimimo.com, copy Cookie header from Network
                                        </span>
                                    </label>
                                    <textarea
                                        id="relay-usage-cookie"
                                        value={relayUsageCookie}
                                        onChange={e => setRelayUsageCookie(e.target.value)}
                                        disabled={relaySubmitting}
                                        rows={3}
                                        placeholder="Cookie: api-platform_serviceToken=...; userId=...; api-platform_ph=..."
                                        style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, width: '100%' }}
                                    />
                                    <p className="modal-tip" style={{ margin: '6px 0 0', fontSize: 12 }}>
                                        Cookie is for Token Plan usage only, not model calls. Calls use tp-key above.
                                    </p>
                                </div>
                            )}

                            <div className="form-group">
                                <label htmlFor="relay-protocol">
                                    Upstream protocol <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: 12 }}>
                                        Which wire format the relay speaks
                                    </span>
                                </label>
                                <select
                                    id="relay-protocol"
                                    value={relayProtocol}
                                    onChange={e => setRelayProtocol(e.target.value)}
                                    disabled={relaySubmitting}
                                >
                                    <option value="responses">responses (default / Unity2, ChatGPT, OpenAI key)</option>
                                    <option value="chat_completions">chat_completions (GLM/MiMo Coding Plan / generic OpenAI Chat)</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label htmlFor="relay-model-fallback">
                                    Model fallback <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: 12 }}>
                                        Replace client model with this when not in map
                                    </span>
                                </label>
                                <input
                                    id="relay-model-fallback"
                                    type="text"
                                    value={relayModelFallback}
                                    onChange={e => setRelayModelFallback(e.target.value)}
                                    disabled={relaySubmitting}
                                    placeholder="e.g. glm-5.1 (empty = pass through)"
                                    style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
                                />
                            </div>

                            <div className="form-group form-group-full">
                                <label htmlFor="relay-model-map">
                                    Model map <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: 12 }}>
                                        One line per <code>clientModel=relayModel</code>
                                    </span>
                                </label>
                                <textarea
                                    id="relay-model-map"
                                    value={relayModelMapText}
                                    onChange={e => setRelayModelMapText(e.target.value)}
                                    disabled={relaySubmitting}
                                    rows={3}
                                    placeholder={'gpt-5.5=glm-5.1\ngpt-4o=glm-5\ngpt-4o-mini=glm-5.1-x'}
                                    style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, width: '100%' }}
                                />
                            </div>
                            </div>{/* end relay-form-grid */}

                            {relayError && <div className="error-message">{relayError}</div>}

                            <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
                                <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={relaySubmitting}>
                                    Cancel
                                </button>
                                <button type="button" className="btn btn-primary" onClick={handleSubmitRelay} disabled={relaySubmitting}>
                                    {relaySubmitting ? 'Importing…' : 'Import relay'}
                                </button>
                            </div>
                        </div>
                    ) : activeTab === 'google' ? (
                        <div className="oauth-content">
                            <div className="oauth-icon">◆</div>
                            <h3 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>Google Antigravity OAuth</h3>
                            <p className="oauth-desc">
                                After auth, Gemini routes via Codex Switcher; does not change Codex OpenAI login.
                            </p>
                            <button
                                className="btn btn-primary btn-full"
                                style={{ padding: '14px' }}
                                onClick={handleAntigravityLogin}
                                disabled={loading}
                            >
                                {loading ? 'Processing...' : 'Connect Google account'}
                            </button>
                            <button
                                className="btn btn-ghost btn-full"
                                style={{ marginTop: '8px' }}
                                onClick={handleCopyAntigravityOAuthLink}
                                disabled={loading}
                                type="button"
                                title="Do not open default browser; copy Google auth link to clipboard"
                            >
                                Copy auth link (choose browser)
                            </button>
                            {!loading && (
                                <button className="btn btn-ghost btn-full" style={{ marginTop: '12px' }} onClick={handleClose}>Cancel</button>
                            )}
                            {oauthStatus && <div className="oauth-status">{oauthStatus}</div>}
                            {error && <div className="error-message" style={{ marginTop: '16px' }}>{error}</div>}
                        </div>
                    ) : activeTab === 'official' ? (
                        <form onSubmit={handleSubmitOfficial}>
                            <p className="modal-tip">
                                Extract auth from local official Codex login (`auth.json`).
                            </p>

                            <div className="form-group">
                                <label htmlFor="name">Account name *</label>
                                <input
                                    id="name"
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="e.g. Work account, Personal account"
                                    disabled={loading}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="notes">Notes</label>
                                <textarea
                                    id="notes"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder="Optional notes..."
                                    disabled={loading}
                                    rows={3}
                                />
                            </div>

                            {error && <div className="error-message">{error}</div>}

                            <div className="modal-footer" style={{ padding: '16px 0 0', border: 'none' }}>
                                <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={loading}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={loading}>
                                    {loading ? 'Importing...' : 'Import current account'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="oauth-content">
                            <div className="oauth-icon">🛡️</div>
                            <h3 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>Official OAuth authorization</h3>
                            <p className="oauth-desc">
                                Sign in via OpenAI official channel. Auto token renewal; stable multi-account switching without manual `auth.json` updates.
                            </p>

                            <button
                                className="btn btn-primary btn-full"
                                style={{ padding: '14px' }}
                                onClick={handleOpenAILogin}
                                disabled={loading}
                            >
                                {loading && oauthStatus ? 'Processing...' : 'Sign in with OpenAI now'}
                            </button>

                            <button
                                className="btn btn-ghost btn-full"
                                style={{ marginTop: '8px' }}
                                onClick={handleCopyOAuthLink}
                                disabled={loading}
                                type="button"
                                title="Do not open default browser; copy auth link to clipboard for your chosen browser"
                            >
                                Copy auth link (choose browser)
                            </button>

                            {!loading && (
                                <button
                                    className="btn btn-ghost btn-full"
                                    style={{ marginTop: '12px' }}
                                    onClick={handleClose}
                                >
                                    Cancel
                                </button>
                            )}

                            {oauthStatus && <div className="oauth-status">{oauthStatus}</div>}
                            {error && <div className="error-message" style={{ marginTop: '16px' }}>{error}</div>}

                            <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                                Authorization completes in your default browser; secure and trusted.
                            </div>

                            {!showPasteInput ? (
                                <button
                                    className="btn btn-ghost btn-full"
                                    style={{ marginTop: '12px', fontSize: '12px' }}
                                    onClick={() => setShowPasteInput(true)}
                                    type="button"
                                >
                                    Browser did not return? Paste callback URL manually
                                </button>
                            ) : (
                                <div style={{ marginTop: '12px', textAlign: 'left' }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                                        Copy full URL from address bar (with <code>?code=...&state=...</code>) below:
                                    </div>
                                    <textarea
                                        className="text-input"
                                        style={{ width: '100%', minHeight: '64px', fontFamily: 'monospace', fontSize: '12px' }}
                                        value={callbackInput}
                                        onChange={e => setCallbackInput(e.target.value)}
                                        placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                        disabled={submittingCallback}
                                    />
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                        <button
                                            className="btn btn-primary"
                                            style={{ flex: 1 }}
                                            onClick={handleSubmitCallback}
                                            disabled={submittingCallback || !callbackInput.trim()}
                                            type="button"
                                        >
                                            {submittingCallback ? 'Submitting...' : 'Start authorization'}
                                        </button>
                                        <button
                                            className="btn btn-ghost"
                                            onClick={() => { setShowPasteInput(false); setCallbackInput(''); }}
                                            disabled={submittingCallback}
                                            type="button"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
