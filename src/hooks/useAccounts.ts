import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface CachedQuota {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    primary_window_seconds?: number | null;
    five_hour_label?: string;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
    secondary_window_seconds?: number | null;
    weekly_label?: string;
    plan_type: string;
    is_valid_for_cli?: boolean;
    reset_credits?: number | null;
    spark?: SparkWindows | null;
    luna_reserve?: LunaReserveWindow | null;
    updated_at: string;
}

export interface SparkWindows {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
}

export interface LunaReserveWindow {
    normal_model_slug: string;
    allowed: boolean;
    limit_reached: boolean;
    used_percent: number;
    reset_after_seconds?: number | null;
    reset_at?: number | null;
}

export interface AppSettings {
    auto_reload_ide: boolean;
    primary_ide: string;
    use_pkill_restart: boolean;
    background_refresh: boolean;
    refresh_interval_minutes: number;
    inactive_refresh_days: number;
    theme_palette: string;
    quota_widget_identity?: 'number' | 'emoji';
    remote_mode?: string;
    relay_auto_switch_out?: boolean;
    relay_auto_switch_in?: boolean;
    client_direct_upstream?: boolean;
    current_antigravity_account_id?: string | null;
    current_relay_accounts?: Record<string,string>;
}

export interface KeepaliveState {
    inactive_refresh_enabled: boolean;
    last_attempt_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
}

export interface WindowPrimingState {
    configured?: boolean;
    five_hour_enabled: boolean;
    weekly_enabled: boolean;
    last_five_hour_reset_at?: number | null;
    last_weekly_reset_at?: number | null;
    last_attempt_at?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
}

export interface SyncStatus {
    is_synced: boolean;
    disk_email: string | null;
    matching_id: string | null;
    current_id: string | null;
}

export type AccountKind = 'legacy' | 'chatgpt_oauth' | 'openai_key' | 'relay' | 'antigravity_oauth';

export interface RelayUsageCache {
    windows?: { label: string; remaining_percent: number | null; reset_at: number | null }[];
    remaining: number;
    unit: string;
    is_active: boolean;
    next_reset_at?: number | null;
    updated_at: string;
}

export interface Account {
    id: string;
    name: string;
    auth_json: unknown;
    created_at: string;
    last_used: string | null;
    notes: string | null;
    /** User-maintained account/subscription expiry (YYYY-MM-DD), not access token expiry. */
    account_expires_at?: string | null;
    /** After window reset, one minimal Codex request per account to restart rolling countdown. */
    window_priming?: WindowPrimingState;
    cached_quota: CachedQuota | null;
    keepalive: KeepaliveState;
    is_banned: boolean;
    is_token_invalid: boolean;
    is_logged_out: boolean;
    kind?: AccountKind;
    relay_base_url?: string | null;
    relay_homepage?: string | null;
    relay_usage_preset?: string | null;
    relay_usage_cookie?: string | null;
    relay_usage_cache?: RelayUsageCache | null;
    relay_model_map?: Record<string, string> | null;
    relay_model_fallback?: string | null;
    relay_protocol?: string | null;
    /** Category: aggregator (relay) / coding_plan / third_party (API) */
    relay_category?: 'aggregator' | 'coding_plan' | 'third_party' | null;
    /** Phone anchor (Codex.app remote bind). At most one true in the store. */
    is_session_anchor?: boolean;
    widget_number?: number | null;
    widget_emoji?: string | null;
}

/** Resolve effective kind; matches Rust `Account::effective_kind()` (legacy: from access_token prefix). */
export function effectiveKind(account: Account): Exclude<AccountKind, 'legacy'> {
    if (account.kind && account.kind !== 'legacy') return account.kind;
    const auth = account.auth_json as { tokens?: { access_token?: string }; access_token?: string } | null;
    const tok = auth?.tokens?.access_token ?? auth?.access_token;
    if (typeof tok === 'string' && tok.startsWith('eyJ')) return 'chatgpt_oauth';
    return 'openai_key';
}

export function useAccounts() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [settings, setSettings] = useState<AppSettings>({
        auto_reload_ide: false,
        primary_ide: 'Windsurf',
        use_pkill_restart: false,
        background_refresh: false,
        refresh_interval_minutes: 30,
        inactive_refresh_days: 7,
        theme_palette: 'obsidian',
        quota_widget_identity: 'number',
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load accounts and settings
    const loadData = useCallback(async () => {
        try {
            setError(null);

            const [accountList, current, appSettings] = await Promise.all([
                invoke<Account[]>('get_accounts'),
                invoke<string | null>('get_current_account_id'),
                invoke<AppSettings>('get_settings'),
            ]);

            setAccounts(accountList);
            setCurrentId(current);
            setSettings(appSettings);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial load
    useEffect(() => {
        loadData();
    }, [loadData]);

    const setInactiveRefreshEnabled = useCallback(async (id: string, enabled: boolean) => {
        try {
            setError(null);
            await invoke('set_account_inactive_refresh_enabled', { id, enabled });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Set / clear phone anchor (mutually exclusive)
    const setSessionAnchor = useCallback(async (id: string, enabled: boolean) => {
        try {
            setError(null);
            await invoke('set_session_anchor', { id, enabled });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Update settings
    const updateSettings = useCallback(async (newSettings: AppSettings) => {
        try {
            setError(null);
            await invoke('update_settings', { settings: newSettings });
            setSettings(await invoke<AppSettings>('get_settings'));
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    // Other methods use loadData instead of loadAccounts

    // Import current account
    const importCurrent = useCallback(async (name: string, notes?: string) => {
        try {
            setError(null);
            await invoke('import_current_account', { name, notes });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Switch account
    const switchTo = useCallback(async (id: string) => {
        try {
            setError(null);
            await invoke('switch_account', { id });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Delete account (confirm in AccountList UI only — no double confirm)
    const deleteAccount = useCallback(async (id: string) => {
        try {
            setError(null);
            if (currentId === id) {
                setCurrentId(null);
            }
            await invoke('delete_account', { id });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData, currentId]);

    // Update account
    const updateAccount = useCallback(async (
        id: string,
        name?: string,
        notes?: string,
        accountExpiresAt?: string,
    ) => {
        try {
            setError(null);
            await invoke('update_account', { id, name, notes, accountExpiresAt });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Export
    const exportAccounts = useCallback(async () => {
        try {
            return await invoke<string>('export_accounts');
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    // Import
    const importAccounts = useCallback(async (json: string) => {
        try {
            setError(null);
            await invoke('import_accounts', { json });
            await loadData();
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Check Codex login state
    const checkCodexLogin = useCallback(async () => {
        try {
            return await invoke<boolean>('check_codex_login');
        } catch {
            return false;
        }
    }, []);

    // Start OAuth; openBrowser=false prepares URL + listener without opening browser
    const startOAuthLogin = useCallback(async (openBrowser: boolean = true) => {
        try {
            setError(null);
            return await invoke<string>('start_oauth_login', { openBrowser });
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    // Finalize OAuth login
    const finalizeOAuthLogin = useCallback(async (code: string) => {
        try {
            setError(null);
            const account = await invoke<Account>('finalize_oauth_login', { code });
            await loadData();
            return account;
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, [loadData]);

    // Reload IDE windows
    const reloadIdeWindows = useCallback(async (useWindowReload: boolean = false) => {
        try {
            setError(null);
            return await invoke<string[]>('reload_ide_windows', { useWindowReload });
        } catch (err) {
            setError(String(err));
            throw err;
        }
    }, []);

    return {
        accounts,
        currentId,
        settings,
        loading,
        error,
        refresh: loadData,
        importCurrent,
        switchTo,
        deleteAccount,
        updateAccount,
        exportAccounts,
        importAccounts,
        checkCodexLogin,
        startOAuthLogin,
        finalizeOAuthLogin,
        reloadIdeWindows,
        updateSettings,
        setInactiveRefreshEnabled,
        setSessionAnchor,
        checkSyncConflict: useCallback(async () => {
            return invoke<string | null>('check_sync_conflict');
        }, []),
        getSyncStatus: useCallback(async () => {
            return invoke<SyncStatus>('get_sync_status');
        }, []),
        syncActiveWithDisk: useCallback(async () => {
            await invoke('sync_active_with_disk');
            await loadData();
        }, [loadData]),
    };
}
