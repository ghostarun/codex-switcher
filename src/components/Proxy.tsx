import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Copy, Check, Save } from 'lucide-react';
import './Proxy.css';

interface ProxyStatus {
    enabled: boolean;
    port: number;
    is_running: boolean;
    base_url: string;
    allow_lan: boolean;
    lan_base_url?: string | null;
    total_requests: number;
    auto_switches: number;
}

interface AppSettings {
    auto_reload_ide: boolean;
    primary_ide: string;
    use_pkill_restart: boolean;
    background_refresh: boolean;
    refresh_interval_minutes: number;
    inactive_refresh_days: number;
    theme_palette: string;
    allow_auto_switch_to_free: boolean;
    proxy_enabled: boolean;
    proxy_port: number;
    proxy_allow_lan: boolean;
    proxy_threshold_5h: number;
    proxy_threshold_weekly: number;
    proxy_free_guard: number;
    notify_on_switch: boolean;
    inject_switch_message: boolean;
    quota_refresh_enabled: boolean;
    quota_refresh_interval: number;
    quota_refresh_batch: number;
    switch_mode: string;
    remote_mode: string;
    proxy_bootstrap_byte_cap: number;
    proxy_bootstrap_time_cap_ms: number;
}

export function Proxy() {
    const [status, setStatus] = useState<ProxyStatus | null>(null);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [port, setPort] = useState(18080);
    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);
    const [envWriting, setEnvWriting] = useState(false);
    const [killing, setKilling] = useState(false);
    const [disablingRouting, setDisablingRouting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [switchedAccount, setSwitchedAccount] = useState<string | null>(null);
    const [fastMode, setFastMode] = useState(false);
    const [goalsMode, setGoalsMode] = useState(false);

    const fetchAll = async () => {
        try {
            const [s, st, fm, gm] = await Promise.all([
                invoke<AppSettings>('get_settings'),
                invoke<ProxyStatus>('get_proxy_status'),
                invoke<boolean>('get_codex_fast_mode'),
                invoke<boolean>('get_codex_features_goals'),
            ]);
            setSettings(s);
            setFastMode(fm);
            setGoalsMode(gm);
            setStatus(st);
            setPort(s.proxy_port);
        } catch (e) {
            console.error('Failed to load proxy status:', e);
        }
    };

    useEffect(() => {
        fetchAll();
        const unsub1 = listen('settings-updated', fetchAll);
        const unsub2 = listen<string>('proxy-account-switched', (e) => {
            setSwitchedAccount(e.payload);
            setTimeout(() => setSwitchedAccount(null), 5000);
            fetchAll();
        });
        const unsub3 = listen<string>('proxy-all-exhausted', (e) => {
            setMessage({ type: 'error', text: e.payload });
        });
        return () => {
            unsub1.then(fn => fn());
            unsub2.then(fn => fn());
            unsub3.then(fn => fn());
        };
    }, []);

    const toggleProxy = async (enabled: boolean) => {
        if (!settings) return;
        setSaving(true);
        setMessage(null);
        try {
            await invoke('update_settings', {
                settings: { ...settings, proxy_enabled: enabled, proxy_port: port },
            });
            setMessage({ type: 'success', text: enabled ? 'Proxy started' : 'Proxy stopped' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `Operation failed: ${e}` });
        } finally {
            setSaving(false);
        }
    };

    const savePort = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            await invoke('update_settings', {
                settings: { ...settings, proxy_port: port },
            });
            setMessage({ type: 'success', text: 'Port updated (effective after proxy restart)' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `Save failed: ${e}` });
        } finally {
            setSaving(false);
        }
    };

    const handleSetEnv = async (enable: boolean) => {
        setEnvWriting(true);
        setMessage(null);
        try {
            const result = await invoke<string>('set_proxy_env', { port, enable });
            setMessage({ type: 'success', text: result });
            setTimeout(() => setMessage(null), 5000);
        } catch (e) {
            setMessage({ type: 'error', text: `${e}` });
        } finally {
            setEnvWriting(false);
        }
    };

    const handleKill = async () => {
        setKilling(true);
        try {
            const result = await invoke<string>('kill_codex_processes');
            setMessage({ type: 'success', text: result });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `${e}` });
        } finally {
            setKilling(false);
        }
    };

    const handleDisableRouting = async () => {
        if (disablingRouting || !window.confirm('Disable Switcher routing? This stops background control, removes global proxy configuration, clears the phone anchor, and requires restarting Codex Desktop. Account and token data are preserved.')) return;
        setDisablingRouting(true);
        setMessage(null);
        try {
            const result = await invoke<string>('disable_switcher_routing');
            setMessage({ type: 'success', text: result });
            await fetchAll();
        } catch (e) {
            setMessage({ type: 'error', text: `${e}` });
        } finally {
            setDisablingRouting(false);
        }
    };

    const isRunning = status?.is_running ?? false;
    const isEnabled = settings?.proxy_enabled ?? false;

    return (
        <div className="proxy-page">
            <div className="proxy-header">
                <h2>Proxy Service</h2>
                <div className={`proxy-status-badge ${isRunning ? 'running' : 'stopped'}`}>
                    <span className="status-dot" />
                    {isRunning ? 'Running' : 'Stopped'}
                </div>
            </div>

            {message && (
                <div className={`settings-message ${message.type}`}>
                    {message.text}
                </div>
            )}

            {switchedAccount && (
                <div className="settings-message success">
                    Proxy auto-switched to account: {switchedAccount}
                </div>
            )}

            {/* Proxy toggle */}
            <div className="settings-section">
                <h3>Proxy Control</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Local proxy server</span>
                        <span className="setting-desc">
                            Codex CLI connects via proxy to OpenAI; seamless switch and 429 smart retry
                        </span>
                    </div>
                    <button
                        className={`proxy-toggle-btn ${isEnabled ? 'on' : 'off'}`}
                        onClick={() => toggleProxy(!isEnabled)}
                        disabled={saving}
                    >
                        {saving ? '...' : isEnabled ? 'Stop Proxy' : 'Start Proxy'}
                    </button>
                </div>

                <div className="setting-item sub-item">
                    <div className="setting-info">
                        <span className="setting-label">Proxy port</span>
                    </div>
                    <div className="port-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={1024}
                            max={65535}
                            value={port}
                            onChange={e => setPort(parseInt(e.target.value) || 18080)}
                        />
                        {port !== settings?.proxy_port && (
                            <button className="btn btn-sm btn-primary" onClick={savePort} disabled={saving}>
                                <Save size={12} /> Save
                            </button>
                        )}
                    </div>
                </div>

                <div className="setting-item sub-item">
                    <div className="setting-info">
                        <span className="setting-label">Allow LAN access</span>
                        <span className="setting-desc">Listen on `0.0.0.0`; Windows on LAN can connect to this proxy</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings?.proxy_allow_lan ?? false}
                            onChange={async e => {
                                if (!settings) return;
                                const updated = { ...settings, proxy_allow_lan: e.target.checked };
                                setSettings(updated);
                                await invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item sub-item">
                    <div className="setting-info">
                        <span className="setting-label">Switch mode</span>
                        <span className="setting-desc">
                             auto: hot switch when proxy on (no auth.json write, no kill; updates store.current only).
                            When proxy off, cold switch. cold: always cold switch.
                        </span>
                    </div>
                    <select
                        className="select-input"
                        value={settings?.switch_mode ?? 'auto'}
                        onChange={async e => {
                            if (!settings) return;
                            const updated = { ...settings, switch_mode: e.target.value };
                            setSettings(updated);
                            await invoke('update_settings', { settings: updated });
                        }}
                    >
                        <option value="auto">auto (proxy on = hot)</option>
                        <option value="cold">cold (force cold)</option>
                    </select>
                </div>
            </div>

            {/* Environment variables */}
            <div className="settings-section">
                <h3>Environment Variables</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Manual launch</span>
                        <span className="setting-desc">Copy command to terminal</span>
                    </div>
                    <button
                        className="copy-command-button"
                        onClick={() => {
                            navigator.clipboard.writeText(
                                `OPENAI_BASE_URL=${status?.base_url ?? `http://localhost:${port}/v1`} codex`
                            );
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        }}
                    >
                        <code>OPENAI_BASE_URL={status?.base_url ?? `http://localhost:${port}/v1`} codex</code>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                </div>

                {status?.allow_lan && status.lan_base_url && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">LAN client</span>
                            <span className="setting-desc">Windows can point `OPENAI_BASE_URL` to the address below</span>
                        </div>
                        <button
                            className="copy-command-button"
                            onClick={() => {
                                navigator.clipboard.writeText(
                                    `OPENAI_BASE_URL=${status.lan_base_url} codex`
                                );
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}
                        >
                            <code>OPENAI_BASE_URL={status.lan_base_url} codex</code>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                    </div>
                )}

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Global proxy (CLI + App)</span>
                        <span className="setting-desc">
                            Writes ~/.zshrc, launchctl, ~/.codex/config.toml — CLI and Codex App use proxy
                        </span>
                    </div>
                    <div className="env-btn-group">
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleSetEnv(true)}
                            disabled={envWriting}
                        >
                            {envWriting ? '...' : 'Write environment variables'}
                        </button>
                        <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => handleSetEnv(false)}
                            disabled={envWriting}
                        >
                            Remove
                        </button>
                    </div>
                </div>
            </div>

            <div className="settings-section danger">
                <h3>Disable Switcher routing</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Stop Switcher routing and background control</span>
                        <span className="setting-desc">
                            Removes global proxy configuration and clears the Codex Desktop phone anchor. Account and token data are preserved. Restart Codex Desktop to finish.
                        </span>
                    </div>
                    <button
                        className="action-button warning"
                        onClick={handleDisableRouting}
                        disabled={disablingRouting}
                    >
                        {disablingRouting ? 'Disabling...' : 'Disable Switcher routing'}
                    </button>
                </div>
            </div>

            {/* Scheduled quota refresh */}
            <div className="settings-section">
                <h3>Scheduled quota refresh</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Auto refresh account quota</span>
                        <span className="setting-desc">
                            {settings?.remote_mode === 'client'
                                ? 'In client mode: no local OAuth; sync cached_quota from Server /quotas (~every 5 minutes).'
                                : 'Sort by last update time; cycle through all accounts refreshing quota.'}
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings?.remote_mode === 'client' ? false : (settings?.quota_refresh_enabled ?? false)}
                            disabled={settings?.remote_mode === 'client'}
                            onChange={async e => {
                                if (!settings) return;
                                const updated = { ...settings, quota_refresh_enabled: e.target.checked };
                                setSettings(updated);
                                await invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>
                {settings?.quota_refresh_enabled && settings?.remote_mode !== 'client' && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Refresh interval (minutes per account)</span>
                                <span className="setting-desc">Interval between each account refresh</span>
                            </div>
                            <input
                                type="number"
                                className="number-input"
                                min={1}
                                max={60}
                                value={settings.quota_refresh_interval}
                                onChange={async e => {
                                    const val = parseInt(e.target.value) || 5;
                                    const updated = { ...settings, quota_refresh_interval: val };
                                    setSettings(updated);
                                    await invoke('update_settings', { settings: updated });
                                }}
                            />
                        </div>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Accounts per refresh cycle</span>
                                <span className="setting-desc">How many accounts per cycle</span>
                            </div>
                            <input
                                type="number"
                                className="number-input"
                                min={1}
                                max={10}
                                value={settings.quota_refresh_batch}
                                onChange={async e => {
                                    const val = parseInt(e.target.value) || 1;
                                    const updated = { ...settings, quota_refresh_batch: val };
                                    setSettings(updated);
                                    await invoke('update_settings', { settings: updated });
                                }}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Notifications */}
            <div className="settings-section">
                <h3>Switch notifications</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">macOS notifications</span>
                        <span className="setting-desc">Show system notification on switch</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings?.notify_on_switch ?? false}
                            onChange={async e => {
                                if (!settings) return;
                                const updated = { ...settings, notify_on_switch: e.target.checked };
                                setSettings(updated);
                                await invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Inject notice in chat (experimental)</span>
                        <span className="setting-desc">Insert switch notice in Codex chat after switch. May affect conversation state.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings?.inject_switch_message ?? false}
                            onChange={async e => {
                                if (!settings) return;
                                const updated = { ...settings, inject_switch_message: e.target.checked };
                                setSettings(updated);
                                await invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>
            </div>

            {/* Codex configuration */}
            <div className="settings-section">
                <h3>Codex configuration</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Fast mode</span>
                        <span className="setting-desc">
                            Faster inference but 2× quota usage.{fastMode ? 'Currently: on' : 'Currently: off'}
                        </span>
                    </div>
                    <button
                        className={`proxy-toggle-btn ${fastMode ? 'on' : 'off'}`}
                        onClick={async () => {
                            try {
                                const result = await invoke<string>('set_codex_fast_mode', { enable: !fastMode });
                                setFastMode(!fastMode);
                                setMessage({ type: 'success', text: result });
                                setTimeout(() => setMessage(null), 3000);
                            } catch (e) {
                                setMessage({ type: 'error', text: `${e}` });
                            }
                        }}
                    >
                        {fastMode ? 'Turn off Fast' : 'Turn on Fast'}
                    </button>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Goals (experimental)</span>
                        <span className="setting-desc">
                            Writes <code>[features]</code> goals = true to ~/.codex/config.toml.
                            {goalsMode ? 'Currently: on' : 'Currently: off'}
                        </span>
                    </div>
                    <button
                        className={`proxy-toggle-btn ${goalsMode ? 'on' : 'off'}`}
                        onClick={async () => {
                            try {
                                const result = await invoke<string>('set_codex_features_goals', { enable: !goalsMode });
                                setGoalsMode(!goalsMode);
                                setMessage({ type: 'success', text: result });
                                setTimeout(() => setMessage(null), 3000);
                            } catch (e) {
                                setMessage({ type: 'error', text: `${e}` });
                            }
                        }}
                    >
                        {goalsMode ? 'Turn off Goals' : 'Turn on Goals'}
                    </button>
                </div>
            </div>

            {/* Process management */}
            <div className="settings-section">
                <h3>Process management</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Kill all Codex processes</span>
                        <span className="setting-desc">
                            Force kill all codex processes after proxy mode change or for debugging
                        </span>
                    </div>
                    <button
                        className="action-button warning"
                        onClick={handleKill}
                        disabled={killing}
                    >
                        {killing ? 'Killing...' : 'Kill processes'}
                    </button>
                </div>
            </div>

            {/* Smart switch policy */}
            <div className="settings-section">
                <h3>Smart switch policy</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">5h quota preventive switch threshold</span>
                        <span className="setting-desc">Switch when remaining below this % (0 = 429 only; recommend 10)</span>
                    </div>
                    <div className="threshold-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={0}
                            max={50}
                            value={settings?.proxy_threshold_5h ?? 0}
                            onChange={e => {
                                if (!settings) return;
                                const val = parseInt(e.target.value) || 0;
                                const updated = { ...settings, proxy_threshold_5h: val };
                                setSettings(updated);
                                invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="threshold-unit">%</span>
                    </div>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Weekly quota preventive switch threshold</span>
                        <span className="setting-desc">Switch when weekly remaining below this % (0 = 429 only; recommend 5)</span>
                    </div>
                    <div className="threshold-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={0}
                            max={50}
                            value={settings?.proxy_threshold_weekly ?? 0}
                            onChange={e => {
                                if (!settings) return;
                                const val = parseInt(e.target.value) || 0;
                                const updated = { ...settings, proxy_threshold_weekly: val };
                                setSettings(updated);
                                invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="threshold-unit">%</span>
                    </div>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Free account guard</span>
                        <span className="setting-desc">Force switch when Free remaining below this % (0 = none; recommend 35)</span>
                    </div>
                    <div className="threshold-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={0}
                            max={80}
                            value={settings?.proxy_free_guard ?? 0}
                            onChange={e => {
                                if (!settings) return;
                                const val = parseInt(e.target.value) || 0;
                                const updated = { ...settings, proxy_free_guard: val };
                                setSettings(updated);
                                invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="threshold-unit">%</span>
                    </div>
                </div>
            </div>

            {/* SSE bootstrap sniff window: buffer size before mid-stream quota events */}
            <div className="settings-section">
                <h3>SSE bootstrap sniff window</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Byte cap</span>
                        <span className="setting-desc">
                            Release codex after this many bytes without content (default 32768; larger catches slow quota events)
                        </span>
                    </div>
                    <div className="threshold-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={4096}
                            max={1048576}
                            step={4096}
                            value={settings?.proxy_bootstrap_byte_cap ?? 32768}
                            onChange={e => {
                                if (!settings) return;
                                const val = parseInt(e.target.value) || 32768;
                                const updated = { ...settings, proxy_bootstrap_byte_cap: val };
                                setSettings(updated);
                                invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="threshold-unit">B</span>
                    </div>
                </div>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Time cap</span>
                        <span className="setting-desc">
                            Max wait for first content event (default 8000ms). With SSE keep-alive, 30000ms is safe.
                        </span>
                    </div>
                    <div className="threshold-input-group">
                        <input
                            type="number"
                            className="number-input"
                            min={1000}
                            max={60000}
                            step={500}
                            value={settings?.proxy_bootstrap_time_cap_ms ?? 8000}
                            onChange={e => {
                                if (!settings) return;
                                const val = parseInt(e.target.value) || 8000;
                                const updated = { ...settings, proxy_bootstrap_time_cap_ms: val };
                                setSettings(updated);
                                invoke('update_settings', { settings: updated });
                            }}
                        />
                        <span className="threshold-unit">ms</span>
                    </div>
                </div>
            </div>

        </div>
    );
}
