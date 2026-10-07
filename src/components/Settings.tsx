import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Palette, Server, Monitor, Wrench, Save, Github, Radio, Smartphone, Search, X } from 'lucide-react';
import { Account, effectiveKind } from '../hooks/useAccounts';
import './Settings.css';

interface AppSettings {
    auto_reload_ide: boolean;
    primary_ide: string;
    use_pkill_restart: boolean;
    background_refresh: boolean;
    refresh_interval_minutes: number;
    inactive_refresh_days: number;
    theme_palette: string;
    quota_widget_identity: 'number' | 'emoji';
    allow_auto_switch_to_free: boolean;
    proxy_enabled: boolean;
    proxy_port: number;
    proxy_allow_lan: boolean;
    switch_mode: string;
    remote_mode: string;
    remote_server_port: number;
    remote_server_bind: string;
    remote_server_url: string;
    remote_server_url_fallback: string;
    remote_shared_secret: string;
    solo_auto_sync_current: boolean;
    two_pc_enabled: boolean;
    two_pc_peer_ip: string;
    two_pc_secret: string;
    two_pc_prefer_separate: boolean;
    two_pc_primary: boolean;
    proxy_bootstrap_byte_cap: number;
    proxy_bootstrap_time_cap_ms: number;
    relay_auto_switch_out: boolean;
    relay_auto_switch_in: boolean;
    client_direct_upstream: boolean;
    client_owns_current: boolean;
}

interface RemoteHealth {
    mode: string;
    version: string;
    account_count: number;
}

const IDE_OPTIONS = [
    { value: 'Windsurf', label: 'Windsurf' },
    { value: 'Antigravity', label: 'Antigravity' },
    { value: 'Cursor', label: 'Cursor' },
    { value: 'VSCode', label: 'VS Code' },
    { value: 'Codex', label: 'Codex App' },
];

interface SettingsProps {
    accounts?: Account[];
    onSetSessionAnchor?: (id: string, enabled: boolean) => Promise<void>;
}

export function Settings({ accounts = [], onSetSessionAnchor }: SettingsProps = {}) {
    const [settings, setSettings] = useState<AppSettings>({
        auto_reload_ide: false,
        primary_ide: 'Windsurf',
        use_pkill_restart: false,
        background_refresh: false,
        refresh_interval_minutes: 30,
        inactive_refresh_days: 7,
        theme_palette: 'obsidian',
        quota_widget_identity: 'number',
        allow_auto_switch_to_free: false,
        proxy_enabled: false,
        proxy_port: 18080,
        proxy_allow_lan: false,
        switch_mode: 'auto',
        remote_mode: 'off',
        remote_server_port: 18081,
        remote_server_bind: '0.0.0.0',
        remote_server_url: '',
        remote_server_url_fallback: '',
        remote_shared_secret: '',
        solo_auto_sync_current: true,
        two_pc_enabled: false,
        two_pc_peer_ip: '',
        two_pc_secret: '',
        two_pc_prefer_separate: true,
        two_pc_primary: false,
        proxy_bootstrap_byte_cap: 32 * 1024,
        proxy_bootstrap_time_cap_ms: 8000,
        relay_auto_switch_out: true,
        relay_auto_switch_in: false,
        client_direct_upstream: false,
        client_owns_current: false,
    });
    const [saving, setSaving] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [remoteBusy, setRemoteBusy] = useState(false);
    const [remoteStatus, setRemoteStatus] = useState<string>('');
    const [showAnchorPicker, setShowAnchorPicker] = useState(false);
    const [anchorSearch, setAnchorSearch] = useState('');
    const [anchorBusy, setAnchorBusy] = useState(false);

    // Phone anchor applies to ChatGPT subscription accounts only：Codex.app `/codex/remote/control/*`
    // Must authenticate with chatgpt_account_id；Relay / OpenAI API key lacks this claim.
    const anchorAccount = useMemo(
        () => accounts.find(a => a.is_session_anchor) || null,
        [accounts]
    );
    const anchorCandidates = useMemo(
        () => accounts.filter(a => effectiveKind(a) === 'chatgpt_oauth'),
        [accounts]
    );
    const filteredAnchorCandidates = useMemo(() => {
        const q = anchorSearch.trim().toLowerCase();
        if (!q) return anchorCandidates;
        return anchorCandidates.filter(a => {
            const plan = (a.cached_quota?.plan_type || '').toLowerCase();
            return a.name.toLowerCase().includes(q) || plan.includes(q);
        });
    }, [anchorCandidates, anchorSearch]);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const data = await invoke<AppSettings>('get_settings');
            setSettings(data);
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    };

    const saveSettings = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await invoke('update_settings', { settings });
            setMessage({ type: 'success', text: '✅ Settings saved' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Save failed: ${e}` });
        } finally {
            setSaving(false);
        }
    };

    const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const withRemote = async (label: string, fn: () => Promise<string>) => {
        setRemoteBusy(true);
        setRemoteStatus('');
        setMessage(null);
        try {
            const text = await fn();
            setRemoteStatus(`✅ ${label}: ${text}`);
            setMessage({ type: 'success', text: `${label} succeeded` });
        } catch (e) {
            setRemoteStatus(`❌ ${label} failed: ${e}`);
            setMessage({ type: 'error', text: `${label} failed: ${e}` });
        } finally {
            setRemoteBusy(false);
        }
    };

    const handleGenerateSecret = async () => {
        try {
            const s = await invoke<string>('remote_generate_secret');
            updateField('remote_shared_secret', s);
            setMessage({ type: 'success', text: 'New key generated — remember to save settings' });
        } catch (e) {
            setMessage({ type: 'error', text: `Generate failed:${e}` });
        }
    };

    const handleSoloSyncNow = () =>
        withRemote('Switch to same account now', async () => {
            const switched = await invoke<string | null>('solo_sync_current');
            return switched ? `Switched to ${switched}` : 'Already in sync with Server; no switch needed';
        });

    const handleRemoteTest = () =>
        withRemote('Test connection', async () => {
            const [url, h] = await invoke<[string, RemoteHealth]>('remote_probe');
            return `Using ${url}, Server v${h.version}, ${h.account_count} remote account(s)`;
        });

    const handleRemotePushAll = () =>
        withRemote('Push all accounts to Server', async () => {
            const n = await invoke<number>('remote_push_all');
            return `Uploaded ${n} account(s)`;
        });

    const handleRemotePullAll = () =>
        withRemote('Pull all accounts from Server', async () => {
            const n = await invoke<number>('remote_pull_all');
            return `Merged ${n} account(s)`;
        });

    const handleRemotePullAllTokens = () =>
        withRemote('Sync all tokens from Server', async () => {
            const r = await invoke<{
                pulled: number;
                refreshed: number;
                current: string | null;
                current_name: string | null;
                wrote_auth_json: boolean;
                errors: [string, string][];
            }>('remote_pull_all_tokens');
            const parts = [
                `Account ${r.pulled}`,
                `token ${r.refreshed}`,
            ];
            if (r.current_name) parts.push(`current=${r.current_name}`);
            if (r.wrote_auth_json) parts.push('wrote auth.json');
            if (r.errors.length > 0) parts.push(`${r.errors.length} error(s)`);
            return parts.join(' · ');
        });

    const handleRemoteRestart = () =>
        withRemote('Restart HTTP service', async () => {
            const s = await invoke<string>('remote_restart_server');
            return s;
        });

    const handleBindAnchor = async (id: string) => {
        if (!onSetSessionAnchor) return;
        setAnchorBusy(true);
        setMessage(null);
        try {
            await onSetSessionAnchor(id, true);
            setMessage({ type: 'success', text: '✅ Phone anchor set' });
            setTimeout(() => setMessage(null), 3000);
            setShowAnchorPicker(false);
            setAnchorSearch('');
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Bind failed:${e}` });
        } finally {
            setAnchorBusy(false);
        }
    };

    const handleUnbindAnchor = async () => {
        if (!onSetSessionAnchor || !anchorAccount) return;
        setAnchorBusy(true);
        setMessage(null);
        try {
            await onSetSessionAnchor(anchorAccount.id, false);
            setMessage({ type: 'success', text: '✅ Phone anchor cleared' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Unbind failed:${e}` });
        } finally {
            setAnchorBusy(false);
        }
    };

    const handleRepair = async () => {
        if (!confirm('This will attempt to remove Codex App quarantine attributes.\n\nThe system may prompt for your password. Continue?')) {
            return;
        }

        setRepairing(true);
        setMessage(null);
        try {
            const ticket = await invoke<string>('request_quarantine_fix_ticket');
            await invoke('fix_codex_quarantine', { ticket });
            alert('✅ Fix successful!\n\nTry reopening Codex App now.');
        } catch (e) {
            alert(`❌ Fix failed: ${e}`);
        } finally {
            setRepairing(false);
        }
    };


    return (
        <div className="settings-page">
            <div className="settings-header">
                <h2>Settings</h2>
                <button
                    className="save-button"
                    onClick={saveSettings}
                    disabled={saving}
                >
                    <Save size={14} />
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>

            {message && (
                <div className={`settings-message ${message.type}`}>
                    {message.text}
                </div>
            )}

            <div className="settings-section">
                <h3><Palette size={16} /> Appearance</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Theme</span>
                        <span className="setting-desc">Main interface color style</span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.theme_palette}
                        onChange={e => updateField('theme_palette', e.target.value)}
                    >
                        <option value="obsidian">Obsidian Black</option>
                        <option value="midnight">Midnight Dark</option>
                        <option value="github">Classic Blue</option>
                        <option value="agate">Agate Green</option>
                    </select>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Quota widget account label</span>
                        <span className="setting-desc">Show the active account’s assigned number or emoji</span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.quota_widget_identity}
                        onChange={e => updateField('quota_widget_identity', e.target.value as 'number' | 'emoji')}
                    >
                        <option value="number">Number</option>
                        <option value="emoji">Emoji</option>
                    </select>
                </div>
            </div>

            <div className="settings-section">
                <h3><Server size={16} /> Background service</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Background keepalive & sync</span>
                        <span className="setting-desc">
                            {settings.remote_mode === 'client'
                                ? 'In client mode: Server handles keepalive; disabled locally (avoids double refresh invalidating refresh_token).'
                                : 'Current account is authoritative sync only; inactive accounts refreshed by exclusive policy (after save).'}
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.remote_mode === 'client' ? false : settings.background_refresh}
                            disabled={settings.remote_mode === 'client'}
                            onChange={e => updateField('background_refresh', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                        <span className={`toggle-text ${settings.background_refresh && settings.remote_mode !== 'client' ? 'on' : ''}`}>
                            {settings.remote_mode === 'client'
                                ? 'Server managed'
                                : settings.background_refresh ? 'On' : 'Off'}
                        </span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Allow FREE in smart switch</span>
                        <span className="setting-desc">When switching next, allow FREE accounts (default prefers paid)</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.allow_auto_switch_to_free}
                            onChange={e => updateField('allow_auto_switch_to_free', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Fallback to subscription when relay/plan/third-party fails</span>
                        <span className="setting-desc">
                            On (default): auto fallback to healthy subscription on 401/429/quota. Off: errors pass through.
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.relay_auto_switch_out ?? true}
                            onChange={e => updateField('relay_auto_switch_out', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Auto pick includes relay / plan / third-party</span>
                        <span className="setting-desc">
                            Off (default): auto switch avoids relay/plan/API. On: they participate equally (uses their quota).
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.relay_auto_switch_in ?? false}
                            onChange={e => updateField('relay_auto_switch_in', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {settings.remote_mode === 'client' && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">HTTP uses local direct upstream</span>
                            <span className="setting-desc">
                                HTTP same as WebSocket — direct upstream; token still from Server.
                            </span>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.client_direct_upstream ?? false}
                                onChange={e => updateField('client_direct_upstream', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                )}

                {settings.remote_mode === 'client' && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Local owns current pointer</span>
                            <span className="setting-desc">
                                Local decides current; not overwritten by Server `/current`; local writes `~/.codex/auth.json` (legacy solo → client).
                            </span>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.client_owns_current ?? false}
                                onChange={e => updateField('client_owns_current', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                )}

                {
                    settings.background_refresh && settings.remote_mode !== 'client' && (
                        <>
                            <div className="setting-item sub-item">
                                <div className="setting-info">
                                    <span className="setting-label">Scheduler interval (minutes)</span>
                                </div>
                                <input
                                    type="number"
                                    className="number-input"
                                    min={5}
                                    max={120}
                                    value={settings.refresh_interval_minutes}
                                    onChange={e => updateField('refresh_interval_minutes', parseInt(e.target.value) || 30)}
                                />
                            </div>
                            <div className="setting-item sub-item">
                                <div className="setting-info">
                                    <span className="setting-label">Inactive keepalive threshold (days)</span>
                                    <span className="setting-desc">Scheduler refreshes when last_refresh exceeds threshold</span>
                                </div>
                                <input
                                    type="number"
                                    className="number-input"
                                    min={1}
                                    max={30}
                                    value={settings.inactive_refresh_days}
                                    onChange={e => updateField('inactive_refresh_days', parseInt(e.target.value) || 7)}
                                />
                            </div>
                        </>
                    )
                }
            </div >

            <div className="settings-section">
                <h3><Monitor size={16} /> IDE reload</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Auto reload IDE</span>
                        <span className="setting-desc">Reload IDE after switch to apply new token</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.auto_reload_ide}
                            onChange={e => updateField('auto_reload_ide', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {settings.auto_reload_ide && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Primary IDE</span>
                                <span className="setting-desc">Reload selected IDE only</span>
                            </div>
                            <select
                                className="select-input"
                                value={settings.primary_ide}
                                onChange={e => updateField('primary_ide', e.target.value)}
                            >
                                {IDE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Use kill-process restart</span>
                                <span className="setting-desc">pkill restart (recommended for Windsurf, no permissions)</span>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={settings.use_pkill_restart}
                                    onChange={e => updateField('use_pkill_restart', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </>
                )}
            </div>

            <div className="settings-section">
                <h3><Radio size={16} /> Remote Mode (LAN sync)</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Two-PC activity over Tailscale</span>
                        <span className="setting-desc">Pair this PC with exactly one other PC. No account tokens or project contents are exchanged.</span>
                    </div>
                    <input type="checkbox" checked={settings.two_pc_enabled} onChange={e => updateField('two_pc_enabled', e.target.checked)} />
                </div>
                {settings.two_pc_enabled && <>
                    <div className="setting-item"><label>Other PC's Tailscale IPv4</label><input className="text-input" value={settings.two_pc_peer_ip} onChange={e => updateField('two_pc_peer_ip', e.target.value.trim())} placeholder="100.95.7.78" /></div>
                    <div className="setting-item"><label>Pairing secret (same on both PCs, at least 32 characters)</label><input type="password" autoComplete="new-password" className="text-input" value={settings.two_pc_secret} onChange={e => updateField('two_pc_secret', e.target.value)} /></div>
                    <div className="setting-item"><label>Prefer separate usable accounts</label><input type="checkbox" checked={settings.two_pc_prefer_separate} onChange={e => updateField('two_pc_prefer_separate', e.target.checked)} /></div>
                    <div className="setting-item"><label>This PC wins an idle or simultaneous-start tie</label><input type="checkbox" checked={settings.two_pc_primary} onChange={e => updateField('two_pc_primary', e.target.checked)} /></div>
                    <p className="setting-desc">Sharing is allowed when no other usable account is available. An offline peer releases its account preference. Explicit session routes remain in force. For shared OAuth credentials, use one token-authority server and one client; pairing only exchanges activity. Paired clients keep their own current account and contact upstream directly.</p>
                </>}

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Work mode</span>
                        <span className="setting-desc">
                            off=standalone; server=Server API; client=local, RT rotation via Server.
                            Legacy solo merged into client (solo → client + local upstream + local current).
                        </span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.remote_mode}
                        onChange={e => updateField('remote_mode', e.target.value)}
                    >
                        <option value="off">off (disabled)</option>
                        <option value="server">server (Server side)</option>
                        <option value="client">client (local)</option>
                    </select>
                </div>

                {settings.remote_mode === 'server' && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Listen port</span>
                                <span className="setting-desc">Server HTTP API port (default 18081)</span>
                            </div>
                            <input
                                type="number"
                                className="number-input"
                                min={1024}
                                max={65535}
                                value={settings.remote_server_port}
                                onChange={e => updateField('remote_server_port', parseInt(e.target.value) || 18081)}
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Bind address</span>
                                <span className="setting-desc">0.0.0.0 = all interfaces; expose to ZeroTier only if possible</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                value={settings.remote_server_bind}
                                onChange={e => updateField('remote_server_bind', e.target.value)}
                                placeholder="0.0.0.0"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Shared secret</span>
                                <span className="setting-desc">Clients need X-Auth-Token; empty rejects all</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                    type="text"
                                    className="text-input"
                                    style={{ minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                                    value={settings.remote_shared_secret}
                                    onChange={e => updateField('remote_shared_secret', e.target.value)}
                                    placeholder="(not set)"
                                />
                                <button
                                    className="action-button"
                                    onClick={handleGenerateSecret}
                                    disabled={remoteBusy}
                                >
                                    Generate
                                </button>
                            </div>
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Restart HTTP service</span>
                                <span className="setting-desc">Apply after changing port/bind/secret (after Save Settings)</span>
                            </div>
                            <button
                                className="action-button"
                                onClick={handleRemoteRestart}
                                disabled={remoteBusy}
                            >
                                {remoteBusy ? 'Running...' : 'Restart now'}
                            </button>
                        </div>
                    </>
                )}

                {(settings.remote_mode === 'client' || settings.remote_mode === 'solo') && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Server API URL (primary)</span>
                                <span className="setting-desc">Try first; LAN IP e.g. http://192.168.2.14:18081</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260 }}
                                value={settings.remote_server_url}
                                onChange={e => updateField('remote_server_url', e.target.value)}
                                placeholder="http://192.168.2.14:18081"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Server API URL (fallback)</span>
                                <span className="setting-desc">When primary fails; ZeroTier IP e.g. http://172.26.96.198:18081</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260 }}
                                value={settings.remote_server_url_fallback}
                                onChange={e => updateField('remote_server_url_fallback', e.target.value)}
                                placeholder="http://172.26.96.198:18081"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Shared secret</span>
                                <span className="setting-desc">Must match Server</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                                value={settings.remote_shared_secret}
                                onChange={e => updateField('remote_shared_secret', e.target.value)}
                                placeholder="(not set)"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Sync actions</span>
                                <span className="setting-desc">Test connectivity / push local accounts / merge from Server</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="action-button" onClick={handleRemoteTest} disabled={remoteBusy}>
                                    Test connection
                                </button>
                                <button className="action-button" onClick={handleRemotePushAll} disabled={remoteBusy}>
                                    Push all
                                </button>
                                <button className="action-button" onClick={handleRemotePullAll} disabled={remoteBusy}>
                                    Pull merge
                                </button>
                                <button className="action-button" onClick={handleRemotePullAllTokens} disabled={remoteBusy}>
                                    Sync all tokens
                                </button>
                            </div>
                        </div>

                        {settings.remote_mode === 'solo' && (
                            <>
                                <div className="setting-item sub-item">
                                    <div className="setting-info">
                                        <span className="setting-label">Auto same account</span>
                                        <span className="setting-desc">
                                            On heartbeat align local current to Server current.
                                            If Server unreachable, skip silently and keep local state.
                                        </span>
                                    </div>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={settings.solo_auto_sync_current}
                                            onChange={e => updateField('solo_auto_sync_current', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>

                                <div className="setting-item sub-item">
                                    <div className="setting-info">
                                        <span className="setting-label">Switch to same account now</span>
                                        <span className="setting-desc">Manually pull Server current account and hot-switch (works when auto same is off)</span>
                                    </div>
                                    <button
                                        className="action-button"
                                        onClick={handleSoloSyncNow}
                                        disabled={remoteBusy}
                                    >
                                        {remoteBusy ? 'Running...' : 'Switch to same account now'}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {remoteStatus && (
                    <div className="setting-item sub-item">
                        <span className="setting-desc" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {remoteStatus}
                        </span>
                    </div>
                )}
            </div>

            {onSetSessionAnchor && (
                <div className="settings-section">
                    <h3><Smartphone size={16} /> Codex.app phone anchor</h3>
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Current bound account</span>
                            <span className="setting-desc">
                                Disk ~/.codex/auth.json always follows this account; Codex.app phone remote binds here.
                                Switching others moves proxy only; disk unchanged (phone bridge stays up).
                                Only ChatGPT subscription accounts can bind.
                            </span>
                        </div>
                        <div className="anchor-actions">
                            <span className={`anchor-current ${anchorAccount ? 'bound' : 'unbound'}`}>
                                {anchorAccount ? (
                                    <>
                                        📱 {anchorAccount.name}
                                        <span className={`anchor-current-plan plan-${(anchorAccount.cached_quota?.plan_type || 'unknown').toLowerCase()}`}>
                                            {anchorAccount.cached_quota?.plan_type
                                                ? anchorAccount.cached_quota.plan_type.toUpperCase()
                                                : 'Unknown'}
                                        </span>
                                    </>
                                ) : 'Unbound'}
                            </span>
                            <button
                                className="action-button"
                                onClick={() => { setAnchorSearch(''); setShowAnchorPicker(true); }}
                                disabled={anchorBusy}
                            >
                                {anchorAccount ? 'Replace' : 'Select bind account'}
                            </button>
                            {anchorAccount && (
                                <button
                                    className="action-button warning"
                                    onClick={handleUnbindAnchor}
                                    disabled={anchorBusy}
                                >
                                    Unbind
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="settings-section danger">
                <h3><Wrench size={16} /> Troubleshooting</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Fix Codex App crash</span>
                        <span className="setting-desc">Remove macOS quarantine attributes (admin required)</span>
                    </div>
                    <button
                        className="action-button warning"
                        onClick={handleRepair}
                        disabled={repairing}
                    >
                        {repairing ? 'Repairing...' : 'Fix now'}
                    </button>
                </div>
            </div>

            {showAnchorPicker && (
                <div className="modal-overlay" onClick={() => !anchorBusy && setShowAnchorPicker(false)}>
                    <div className="anchor-picker" onClick={e => e.stopPropagation()}>
                        <div className="anchor-picker-header">
                            <div>
                                <h3>Select phone anchor account</h3>
                                <p className="anchor-picker-hint">
                                    Only ChatGPT subscription accounts (Codex.app remote needs chatgpt_account_id)
                                </p>
                            </div>
                            <button
                                className="anchor-picker-close"
                                onClick={() => setShowAnchorPicker(false)}
                                disabled={anchorBusy}
                                title="Close"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="anchor-picker-search">
                            <Search size={14} />
                            <input
                                type="text"
                                placeholder="Search email / plan (team / pro / free)…"
                                value={anchorSearch}
                                onChange={e => setAnchorSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="anchor-picker-list">
                            {filteredAnchorCandidates.length === 0 ? (
                                <div className="anchor-picker-empty">
                                    {anchorCandidates.length === 0
                                        ? 'No ChatGPT subscription accounts'
                                        : 'No matching accounts'}
                                </div>
                            ) : (
                                filteredAnchorCandidates.map(acc => {
                                    const plan = acc.cached_quota?.plan_type;
                                    const planLabel = plan ? plan.toUpperCase() : 'Unknown';
                                    const planClass = (plan || 'unknown').toLowerCase();
                                    return (
                                        <button
                                            key={acc.id}
                                            className={`anchor-picker-item ${acc.is_session_anchor ? 'current' : ''}`}
                                            onClick={() => handleBindAnchor(acc.id)}
                                            disabled={anchorBusy || acc.is_session_anchor}
                                        >
                                            <span className="anchor-picker-name">{acc.name}</span>
                                            <span className={`anchor-picker-plan plan-${planClass}`}>{planLabel}</span>
                                            {acc.is_session_anchor && (
                                                <span className="anchor-picker-tag">✓ Current bound</span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="settings-section">
                <h3><Github size={16} /> About</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Codex Switcher</span>
                        <span className="setting-desc">Multi-account switching + local proxy + usage statistics</span>
                    </div>
                    <a
                        className="action-button github-link"
                        href="https://github.com/xtftbwvfp/codex-switcher"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Github size={14} /> GitHub
                    </a>
                </div>
            </div>
        </div >
    );
}
