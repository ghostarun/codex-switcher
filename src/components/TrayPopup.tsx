import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { QuotaOverlay } from './QuotaOverlay';
// Rust on_window_event(Focused(false)) hides the popup
import './TrayPopup.css';

interface ProxyStatus {
    enabled: boolean;
    port: number;
    is_running: boolean;
    total_requests: number;
    auto_switches: number;
}

interface TokenStats {
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    total_cost_usd: number;
    total_requests: number;
    last_month_cost: number | null;
    last_month_tokens: number | null;
}

interface TrayData {
    proxy: ProxyStatus;
    tokens: TokenStats;
    next_account: { name: string; score: number } | null;
    /** Anchor account name when set; switching current while anchor differs leaves disk on anchor */
    anchor: { name: string; is_current: boolean } | null;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

export function TrayPopup() {
    const [data, setData] = useState<TrayData | null>(null);
    const [switching, setSwitching] = useState(false);

    const fetchData = async () => {
        try {
            const [proxy, tokens, accounts, currentId] = await Promise.all([
                invoke<ProxyStatus>('get_proxy_status'),
                invoke<TokenStats>('get_token_stats'),
                invoke<any[]>('get_accounts'),
                invoke<string | null>('get_current_account_id'),
            ]);

            const anchorAcc = accounts.find((a: any) => a.is_session_anchor);

            setData({
                proxy,
                tokens,
                next_account: null, // Will be populated later
                anchor: anchorAcc
                    ? { name: anchorAcc.name, is_current: anchorAcc.id === currentId }
                    : null,
            });
        } catch (e) {
            console.error('Failed to fetch tray data:', e);
        }
    };

    useEffect(() => {
        document.documentElement.classList.add('is-tray-popup');
        document.body.classList.add('is-tray-popup');
        fetchData();
        const interval = setInterval(fetchData, 5000);
        const unsub = listen('accounts-updated', fetchData);

        // Focus loss handled by Rust on_window_event

        return () => {
            clearInterval(interval);
            unsub.then(fn => fn());
            document.documentElement.classList.remove('is-tray-popup');
            document.body.classList.remove('is-tray-popup');
        };
    }, []);

    const handleSwitch = async () => {
        setSwitching(true);
        try {
            await invoke('switch_to_next_account_internal_cmd');
        } catch {
            // fallback: try tray's method
        }
        await fetchData();
        setSwitching(false);
    };

    const handleRefresh = async () => {
        try {
            const currentId = await invoke<string | null>('get_current_account_id');
            if (!currentId) return;
            // Relay accounts use refresh_relay_usage; subscriptions use OpenAI usage path.
            const accounts = await invoke<Array<{ id: string; kind?: string }>>('get_accounts');
            const acc = accounts.find(a => a.id === currentId);
            const isRelay = (acc?.kind ?? '').toLowerCase() === 'relay';
            if (isRelay) {
                await invoke('refresh_relay_usage', { id: currentId });
            } else {
                await invoke('get_quota_by_id', { id: currentId });
            }
            await fetchData();
        } catch (e) {
            console.error('Refresh failed:', e);
        }
    };

    const handleOpenDashboard = async () => {
        await invoke('show_main_window_cmd');
        getCurrentWebviewWindow().hide();
    };

    return (
        <div className="tray-popup">
            {/* Header */}
            <div className="tp-header">
                <div className="tp-title">
                    <div className="tp-logo">⚡</div>
                    <div>
                        <div className="tp-name">Codex Switcher</div>
                        <div className="tp-subtitle">Usage Monitor</div>
                    </div>
                </div>
                {data?.proxy.is_running && (
                    <div className="tp-badge running">● Proxy ON</div>
                )}
            </div>

            {/* Anchor bar when anchor != current: phone on anchor, proxy on current */}
            {data?.anchor && !data.anchor.is_current && (
                <div className="tp-anchor">
                    <span className="tp-anchor-icon">📱</span>
                    <span className="tp-anchor-text">Phone anchor <b>{data.anchor.name}</b> · active quota shown below</span>
                </div>
            )}
            {data?.anchor && data.anchor.is_current && (
                <div className="tp-anchor matched">
                    <span className="tp-anchor-icon">📱</span>
                    <span className="tp-anchor-text">Phone anchor = current</span>
                </div>
            )}

            <QuotaOverlay embedded />

            {/* Cost & Token Cards */}
            <div className="tp-cards">
                <div className="tp-card cost">
                    <div className="tp-card-header">
                        <span className="tp-card-icon">💰</span>
                        <span>COST USAGE</span>
                    </div>
                    <div className="tp-card-value cost-value">
                        ${(data?.tokens.total_cost_usd ?? 0).toFixed(2)}
                        <span className="tp-remaining">Spent</span>
                    </div>
                    {data?.tokens.last_month_cost !== null && data?.tokens.last_month_cost !== undefined && (
                        <div className="tp-compare">
                            Vs last month ${data.tokens.last_month_cost.toFixed(2)}
                        </div>
                    )}
                </div>

                <div className="tp-card tokens">
                    <div className="tp-card-header">
                        <span className="tp-card-icon">#</span>
                        <span>TOKEN USAGE</span>
                    </div>
                    <div className="tp-card-value token-value">
                        {formatTokens(data?.tokens.total_tokens ?? 0)}
                        <span className="tp-remaining">Tokens</span>
                    </div>
                    <div className="tp-token-detail">
                        In {formatTokens(data?.tokens.total_input_tokens ?? 0)} / Out {formatTokens(data?.tokens.total_output_tokens ?? 0)}
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="tp-actions">
                <button className="tp-btn primary" onClick={handleOpenDashboard}>
                    📋 Dashboard
                </button>
                <button className="tp-btn" onClick={handleRefresh}>
                    ↻ Refresh
                </button>
                <button
                    className="tp-btn accent"
                    onClick={handleSwitch}
                    disabled={switching}
                >
                    {switching ? '...' : '→ Switch'}
                </button>
            </div>
        </div>
    );
}
