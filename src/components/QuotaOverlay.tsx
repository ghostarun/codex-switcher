import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import './QuotaOverlay.css';

type Account = {
    id: string;
    name: string;
    last_used: string | null;
    is_session_anchor: boolean;
    is_logged_out: boolean;
    widget_number?: number | null;
    widget_emoji?: string | null;
    cached_quota: {
        five_hour_left: number;
        five_hour_reset_at?: number | null;
        weekly_left: number;
        weekly_reset_at?: number | null;
        updated_at: string;
    } | null;
};

type OverlayData = { account: Account | null; source: string; identityMode: 'number' | 'emoji' };

function compactAccountName(name: string) {
    const local = name.split('@')[0];
    return local.length > 9 ? `${local.slice(0, 6)}…${local.slice(-2)}` : local;
}

export function QuotaOverlay({ embedded = false }: { embedded?: boolean } = {}) {
    const [data, setData] = useState<OverlayData>({ account: null, source: 'Loading', identityMode: 'number' });

    useEffect(() => {
        if (!embedded) {
            document.documentElement.classList.add('is-quota-overlay');
            document.body.classList.add('is-quota-overlay');
        }
        let mounted = true;
        const refresh = async () => {
            try {
                const [accounts, currentId, proxy, history, sync, settings] = await Promise.all([
                    invoke<Account[]>('get_accounts'),
                    invoke<string | null>('get_current_account_id'),
                    invoke<{ is_running: boolean; desktop_proxy_configured: boolean }>('get_proxy_status'),
                    invoke<Array<{ account_id: string; timestamp: string; codex_desktop: boolean }>>('get_token_history', { days: 1 }),
                    invoke<{ matching_id: string | null }>('get_sync_status'),
                    invoke<{ quota_widget_identity?: string }>('get_settings'),
                ]);
                const selected = accounts.find(a => a.id === currentId);
                const routed = proxy.is_running && proxy.desktop_proxy_configured;
                const latest = history.filter(e => e.codex_desktop && e.account_id).slice(-1)[0];
                const verified = routed && latest && Date.now() - Date.parse(latest.timestamp) < 10 * 60_000
                    && (!selected?.last_used || Date.parse(latest.timestamp) >= Date.parse(selected.last_used));
                const account = routed
                    ? (verified ? accounts.find(a => a.id === latest.account_id) : null) ?? selected
                    : accounts.find(a => a.id === sync.matching_id) ?? accounts.find(a => a.is_session_anchor) ?? selected;
                if (mounted) setData({
                    account: account ?? null,
                    source: routed ? verified ? 'DESKTOP VERIFIED' : 'PROXY SELECTED' : 'DIRECT · DISK ID',
                    identityMode: settings.quota_widget_identity === 'emoji' ? 'emoji' : 'number',
                });
            } catch {
                if (mounted) setData({ account: null, source: 'UNAVAILABLE', identityMode: 'number' });
            }
        };
        void refresh();
        const timer = window.setInterval(refresh, 10_000);
        const unlisten = listen('accounts-updated', refresh);
        return () => {
            mounted = false;
            window.clearInterval(timer);
            unlisten.then(fn => fn());
            if (!embedded) {
                document.documentElement.classList.remove('is-quota-overlay');
                document.body.classList.remove('is-quota-overlay');
            }
        };
    }, [embedded]);

    const quota = data.account?.cached_quota;
    const pct = (value: number | undefined) => value == null ? '—' : `${Math.round(value)}%`;
    const reset = (at?: number | null, weekly = false) => {
        if (!at) return '--';
        const remaining = at - Math.floor(Date.now() / 1000);
        if (remaining <= 0) return 'resetting';
        const days = Math.floor(remaining / 86400);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        if (weekly) return `${days}d ${Math.floor((remaining % 86400) / 3600)}h ${minutes}m`;
        return `${hours}h ${minutes}m`;
    };
    const barWidth = (value?: number) => `${Math.max(0, Math.min(100, value ?? 0))}%`;
    const quotaTone = (value?: number) => value == null ? 'unknown' : value <= 10 ? 'low' : value <= 30 ? 'mid' : 'high';
    const accountTone = data.account?.is_logged_out ? 'invalid' : data.source === 'DESKTOP VERIFIED' ? 'verified' : 'unverified';
    const sourceTag = data.account?.is_logged_out ? 'LOGIN' : data.source === 'DESKTOP VERIFIED' ? 'LIVE' : data.source === 'PROXY SELECTED' ? 'PXY' : data.source === 'DIRECT · DISK ID' ? 'DISK' : '?';
    const accountIdentity = data.account
        ? data.identityMode === 'emoji'
            ? data.account.widget_emoji ?? (data.account.widget_number ? `#${data.account.widget_number}` : compactAccountName(data.account.name))
            : data.account.widget_number ? `#${data.account.widget_number}` : compactAccountName(data.account.name)
        : '—';
    const overlayWindow = getCurrentWebviewWindow();

    return (
        <div className={`quota-overlay${embedded ? ' embedded' : ''}`} role="status" aria-label="Codex quota widget">
            <div className="qo-header" onMouseDown={e => { if (!embedded && e.button === 0) void overlayWindow.startDragging(); }} title={embedded ? undefined : 'Drag to move'}>
                <span className={`qo-dot ${accountTone}`} />
                <span>{data.account?.is_session_anchor ? '📱' : '◉'} {accountIdentity}</span>
                <span className="qo-source-tag">{sourceTag}</span>
            </div>
            <div className="qo-values">
                <div className={`qo-meter ${quotaTone(quota?.five_hour_left)}`}>
                    <div className="qo-meter-label">
                        <span>5H</span>
                        <div className="qo-battery" role="img" aria-label={`5-hour quota ${pct(quota?.five_hour_left)}`}>
                            <span className="qo-battery-track"><i style={{ width: barWidth(quota?.five_hour_left) }} /></span>
                            <strong>{pct(quota?.five_hour_left)}</strong>
                        </div>
                    </div>
                    <small className="qo-reset">↻ {reset(quota?.five_hour_reset_at)}</small>
                </div>
                <div className={`qo-meter ${quotaTone(quota?.weekly_left)}`}>
                    <div className="qo-meter-label">
                        <span>7D</span>
                        <div className="qo-battery" role="img" aria-label={`Weekly quota ${pct(quota?.weekly_left)}`}>
                            <span className="qo-battery-track"><i style={{ width: barWidth(quota?.weekly_left) }} /></span>
                            <strong>{pct(quota?.weekly_left)}</strong>
                        </div>
                    </div>
                    <small className="qo-reset">↻ {reset(quota?.weekly_reset_at, true)}</small>
                </div>
            </div>
        </div>
    );
}
