import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Account, LunaReserveWindow, RelayUsageCache } from './useAccounts';

export interface UsageDisplay {
    plan_type: string;
    five_hour_used: number;
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    weekly_used: number;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
    credits_balance: number | null;
    has_credits: boolean;
    reset_credits?: number | null;
    spark?: SparkWindows | null;
    luna_reserve?: LunaReserveWindow | null;
}

export interface SparkWindows {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
}

/// Relay accounts lack OpenAI 5h/weekly windows; map GLM-style % remaining to five_hour_left for UsageCard.
function relayCacheToUsage(cache: RelayUsageCache, planLabel: string): UsageDisplay {
    const isPercent = (cache.unit ?? '').includes('%');
    const remaining = Number.isFinite(cache.remaining) ? cache.remaining : 0;
    return {
        plan_type: planLabel || 'relay',
        five_hour_used: isPercent ? Math.max(0, 100 - remaining) : 0,
        five_hour_left: isPercent ? remaining : 0,
        five_hour_reset: '',
        five_hour_reset_at: cache.next_reset_at ?? undefined,
        weekly_used: 0,
        weekly_left: 0,
        weekly_reset: '',
        weekly_reset_at: undefined,
        // Amount-style relay: show remaining as credits
        credits_balance: isPercent ? null : remaining,
        has_credits: !isPercent,
    };
}

export function useUsage() {
    const [usage, setUsage] = useState<UsageDisplay | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchUsage = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const currentId = await invoke<string | null>('get_current_account_id');
            if (!currentId) {
                setError('No current account set');
                return;
            }
            // Relay: dedicated fetcher (GLM /api/monitor/usage/quota/limit); not OpenAI usage.
            const accounts = await invoke<Account[]>('get_accounts');
            const acc = accounts.find(a => a.id === currentId);
            const isRelay = (acc?.kind ?? '').toLowerCase() === 'relay';
            if (isRelay) {
                const cache = await invoke<RelayUsageCache>('refresh_relay_usage', { id: currentId });
                const label = (acc?.relay_homepage ? 'Relay' : 'GLM');
                setUsage(relayCacheToUsage(cache, label));
                return;
            }
            const data = await invoke<UsageDisplay>('get_quota_by_id', { id: currentId });
            setUsage(data);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsage();
    }, [fetchUsage]);

    return {
        usage,
        loading,
        error,
        refresh: fetchUsage,
    };
}
