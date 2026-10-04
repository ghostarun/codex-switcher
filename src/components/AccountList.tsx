import { useState, useEffect, useMemo, useRef } from 'react';
import { Zap, RefreshCw, ArrowLeftRight, Trash2, Clock, UploadCloud, Plus, Gauge, UserPlus } from 'lucide-react';
import { Account, AppSettings, LunaReserveWindow, RelayUsageCache, SparkWindows, effectiveKind } from '../hooks/useAccounts';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { AntigravityQuota, type AntigravityModelQuota } from './AntigravityQuota';
import { AgyRelayModelQuotas, RelayQuotaWindows } from './RelayQuotaWindows';
import { relayCurrentState } from '../utils/relayCurrent';
import { displayQuotaLabel, displayResetText } from '../utils/englishQuotaText';
import { ReferralInviteModal } from './ReferralInviteModal';

const KIND_BADGE: Record<ReturnType<typeof effectiveKind>, { label: string; className: string }> = {
    chatgpt_oauth: { label: 'Sub', className: 'badge kind-chatgpt' },
    openai_key: { label: 'API', className: 'badge kind-openai' },
    relay: { label: 'Relay', className: 'badge kind-relay' },
    antigravity_oauth: { label: 'Google', className: 'badge kind-antigravity' },
};

const WIDGET_EMOJIS = [
    { value: '📱', label: '📱 Phone' },
    { value: '⭐', label: '⭐ Star' },
    { value: '⚡', label: '⚡ Bolt' },
    { value: '🌙', label: '🌙 Moon' },
    { value: '🔥', label: '🔥 Fire' },
    { value: '🚀', label: '🚀 Rocket' },
    { value: '🧠', label: '🧠 Brain' },
    { value: '💎', label: '💎 Diamond' },
    { value: '🟢', label: '🟢 Green' },
    { value: '🔵', label: '🔵 Blue' },
    { value: '🟣', label: '🟣 Purple' },
    { value: '🟠', label: '🟠 Orange' },
    { value: '🌸', label: '🌸 Flower' },
    { value: '🐼', label: '🐼 Panda' },
];

/** Relay row badge: `relay_category` is authoritative; falls back to generic "Relay". */
function relayCategoryBadge(account: Account): { label: string; className: string } {
    switch (account.relay_category) {
        case 'coding_plan':
            return { label: 'Plan', className: 'badge kind-codingplan' };
        case 'third_party':
            return { label: '3rd', className: 'badge kind-thirdparty' };
        case 'aggregator':
        default:
            return { label: 'Relay', className: 'badge kind-relay' };
    }
}

function antigravityModelQuotas(account: Account): Record<string, AntigravityModelQuota> {
    const auth = account.auth_json as { model_quotas?: Record<string, AntigravityModelQuota> } | null;
    return auth?.model_quotas ?? {};
}

function antigravityTier(account: Account): { label: string; className: string } {
    const tier = (account.auth_json as { subscription_tier?: string } | null)?.subscription_tier?.toLowerCase();
    if (tier?.includes('ultra')) return { label: 'ULTRA', className: 'badge google-tier google-tier-ultra' };
    if (tier?.includes('pro')) return { label: 'PRO', className: 'badge google-tier google-tier-pro' };
    if (tier?.includes('plus')) return { label: 'PLUS', className: 'badge google-tier google-tier-pro' };
    if (tier === 'free' || tier?.includes('starter')) return { label: 'FREE', className: 'badge google-tier google-tier-free' };
    return { label: 'Plan pending sync', className: 'badge google-tier google-tier-unknown' };
}

function antigravityQuotaUpdatedAt(account: Account): string | undefined {
    return Object.values(antigravityModelQuotas(account))
        .map(quota => quota.updated_at)
        .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
import { useShortCountdown } from '../hooks/useCountdown';
import './AccountList.css';
import { ConfirmModal } from './ConfirmModal';

/** Format Unix expiry seconds as local short time e.g. "07-18 00:34" */
function fmtExpiry(ts?: number | null): string {
    if (!ts || ts <= 0) return 'Unknown';
    return new Date(ts * 1000).toLocaleString(undefined, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

/** Days until expiry (floor; 0 if expired; null if none) */
function daysLeft(ts?: number | null): number | null {
    if (!ts || ts <= 0) return null;
    return Math.max(0, Math.floor((ts - Math.floor(Date.now() / 1000)) / 86400));
}

type AccountExpiryInfo = {
    text: string;
    badge: string | null;
    tone: 'unset' | 'normal' | 'soon' | 'expired';
    title: string;
};

/** Manual expiry uses local calendar day; expiry day shows as "expires today". */
function accountExpiryInfo(value?: string | null): AccountExpiryInfo {
    if (!value) {
        return { text: 'Not set', badge: null, tone: 'unset', title: 'Click to set account expiry date' };
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return { text: value, badge: 'Invalid date', tone: 'expired', title: 'Bad date format — click to fix' };
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        return { text: value, badge: 'Invalid date', tone: 'expired', title: 'Bad date value — click to fix' };
    }
    const now = new Date();
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const expiryUtc = parsed.getTime();
    const remainingDays = Math.round((expiryUtc - todayUtc) / 86_400_000);

    if (remainingDays < 0) {
        return { text: `${value} · expired`, badge: 'Account expired', tone: 'expired', title: `Expired on ${value} — click to edit` };
    }
    if (remainingDays === 0) {
        return { text: `${value} · today`, badge: 'Expires today', tone: 'soon', title: 'Expires today — click to edit' };
    }
    if (remainingDays <= 7) {
        return { text: `${value} · ${remainingDays}d`, badge: `${remainingDays}d left`, tone: 'soon', title: `${remainingDays} day(s) left — click to edit` };
    }
    return { text: value, badge: null, tone: 'normal', title: `Expiry ${value} — click to edit` };
}

function primingWindowKind(account: Account): 'five_hour' | 'weekly' {
    const seconds = account.cached_quota?.primary_window_seconds;
    if (typeof seconds === 'number' && seconds > 0) {
        return seconds >= 24 * 60 * 60 ? 'weekly' : 'five_hour';
    }
    const primaryLabel = account.cached_quota?.five_hour_label ?? '';
    if (/周|weekly|7\s*d/i.test(primaryLabel)) {
        return 'weekly';
    }
    return 'five_hour';
}


interface ResetCreditResult {
    ok: boolean;
    status_code: number;
    code: string;
    windows_reset: number;
    message: string;
    consumed_credit_id?: string | null;
    upstream_raw: string;
}

// Manual reset credit from GET wham/rate-limit-reset-credits
interface ResetCreditItem {
    id: string;
    expires_at?: number | null; // Unix seconds
    granted_at?: number | null;
    title: string;
    source: string;
}

interface UsageData {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    five_hour_label: string;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
    weekly_label: string;
    plan_type: string;
    is_valid_for_cli: boolean;
    reset_credits?: number | null;
    spark?: SparkWindows | null;
    luna_reserve?: LunaReserveWindow | null;
}

type FilterType = 'all' | 'sub' | 'google' | 'plus' | 'pro' | 'team' | 'free' | 'relay' | 'coding_plan' | 'third_party';

interface AccountListProps {
    accounts: Account[];
    currentId: string | null;
    settings: AppSettings;
    onSwitch: (id: string) => void | Promise<void>;
    onDelete: (id: string) => void;
    onUpdateAccount: (id: string, name?: string, notes?: string, accountExpiresAt?: string) => Promise<void>;
    onUpdateSettings: (settings: AppSettings) => void | Promise<void>;
    onRefreshComplete?: () => void | Promise<void>;
    onAddAccount?: () => void;
    onAddRelay?: () => void;
    onRefreshUsage?: () => void;
    usageLoading?: boolean;
}

export function AccountList({
    accounts,
    currentId,
    settings,
    onSwitch,
    onAddAccount,
    onAddRelay,
    onRefreshUsage,
    usageLoading,
    onDelete,
    onUpdateAccount,
    onUpdateSettings,
    onRefreshComplete,
}: AccountListProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [switchingIds, setSwitchingIds] = useState<Set<string>>(new Set());
    const [usageMap, setUsageMap] = useState<Record<string, UsageData>>({});
    const [desktopUsage, setDesktopUsage] = useState<{ account_id: string; timestamp: string } | null>(null);
    const [desktopProxyConfigured, setDesktopProxyConfigured] = useState(false);
    const [isRefreshingAll, setIsRefreshingAll] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<FilterType>('all');
    const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
    const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
    const [accountToDelete, setAccountToDelete] = useState<{ id: string, name: string } | null>(null);
    const [pushingIds, setPushingIds] = useState<Set<string>>(new Set());
    const [pushToast, setPushToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // Relay balance cache (separate from ChatGPT usage)
    const [relayUsageMap, setRelayUsageMap] = useState<Record<string, RelayUsageCache>>({});
    const [cookieEditor, setCookieEditor] = useState<{ id: string; name: string; value: string } | null>(null);
    const [savingCookie, setSavingCookie] = useState(false);
    // Codex invite modal
    const [inviteModal, setInviteModal] = useState<{ id: string; name: string } | null>(null);
    // Launch Codex Desktop (ChatGPT) — uses ~/.codex / phone-anchor identity
    const [launchingIds, setLaunchingIds] = useState<Set<string>>(new Set());
    // Manual reset: badge opens modal with credits (expiry), then consume
    const [resetModal, setResetModal] = useState<{ id: string; name: string; credits: number | null } | null>(null);
    const resetQueryVersion = useRef(0);
    const [resetting, setResetting] = useState(false);
    const [resetList, setResetList] = useState<ResetCreditItem[] | null>(null);
    const [resetListLoading, setResetListLoading] = useState(false);
    const [resetListError, setResetListError] = useState<string | null>(null);
    // Monthly account expiry: manual; separate from OAuth expires_at.
    const [expiryEditor, setExpiryEditor] = useState<{ id: string; name: string; value: string } | null>(null);
    const [savingExpiry, setSavingExpiry] = useState(false);
    const [expiryError, setExpiryError] = useState<string | null>(null);
    const [widgetIdentityEditor, setWidgetIdentityEditor] = useState<{ id: string; name: string; number: string; emoji: string } | null>(null);
    const [savingWidgetIdentity, setSavingWidgetIdentity] = useState(false);
    const [widgetIdentityError, setWidgetIdentityError] = useState<string | null>(null);
    // Window priming: after reset_at, one minimal Codex request per account.
    const [primeEditor, setPrimeEditor] = useState<{
        id: string;
        name: string;
        fiveHour: boolean;
        weekly: boolean;
        mode: 'five_hour' | 'weekly';
        lastAttempt?: string | null;
        lastSuccess?: string | null;
        lastError?: string | null;
    } | null>(null);
    const [savingPrime, setSavingPrime] = useState(false);
    const [primeError, setPrimeError] = useState<string | null>(null);

    const autoReload = settings.auto_reload_ide;
    useEffect(() => {
        let mounted = true;
        const check = async () => {
            try {
                const history = await invoke<{ account_id: string; timestamp: string; codex_desktop?: boolean }[]>('get_token_history', { days: 1 });
                if (mounted) setDesktopUsage(history.filter(e => e.codex_desktop && e.account_id).slice(-1)[0] ?? null);
                const status = await invoke<{ desktop_proxy_configured: boolean }>('get_proxy_status');
                if (mounted) setDesktopProxyConfigured(status.desktop_proxy_configured);
            } catch {
                if (mounted) setDesktopUsage(null);
            }
        };
        void check();
        const timer = window.setInterval(check, 5000);
        return () => { mounted = false; window.clearInterval(timer); };
    }, []);
    const lastDesktopAccount = accounts.find(a => a.id === desktopUsage?.account_id);
    const recentDesktopUsage = desktopUsage && Date.now() - Date.parse(desktopUsage.timestamp) < 10 * 60_000;
    const selectedSince = accounts.find(a => a.id === currentId)?.last_used;
    const verifiedAfterSwitch = recentDesktopUsage && (!selectedSince || Date.parse(desktopUsage.timestamp) >= Date.parse(selectedSince));
    const setAutoReload = (val: boolean) => onUpdateSettings({ ...settings, auto_reload_ide: val });

    const saveAccountExpiry = async () => {
        if (!expiryEditor || savingExpiry) return;
        setSavingExpiry(true);
        setExpiryError(null);
        try {
            await onUpdateAccount(expiryEditor.id, undefined, undefined, expiryEditor.value);
            if (settings.remote_mode === 'client' || settings.remote_mode === 'solo') {
                try {
                    await invoke('remote_push_account', { id: expiryEditor.id });
                } catch (err) {
                    throw new Error(`Saved locally but Server sync failed: ${String(err)}`);
                }
            }
            onRefreshComplete?.();
            setExpiryEditor(null);
        } catch (err) {
            setExpiryError(String(err));
        } finally {
            setSavingExpiry(false);
        }
    };

    const saveWidgetIdentity = async () => {
        if (!widgetIdentityEditor || savingWidgetIdentity) return;
        const rawNumber = widgetIdentityEditor.number.trim();
        const number = rawNumber ? Number(rawNumber) : null;
        if (number !== null && (!Number.isInteger(number) || number < 1 || number > 9999)) {
            setWidgetIdentityError('Enter a whole number from 1 to 9999, or leave it blank.');
            return;
        }
        setSavingWidgetIdentity(true);
        setWidgetIdentityError(null);
        try {
            await invoke('set_quota_widget_identity', {
                id: widgetIdentityEditor.id,
                number,
                emoji: widgetIdentityEditor.emoji || null,
            });
            await onRefreshComplete?.();
            setWidgetIdentityEditor(null);
        } catch (err) {
            setWidgetIdentityError(String(err));
        } finally {
            setSavingWidgetIdentity(false);
        }
    };

    const saveWindowPriming = async () => {
        if (!primeEditor || savingPrime) return;
        setSavingPrime(true);
        setPrimeError(null);
        try {
            await invoke('set_account_window_priming', {
                id: primeEditor.id,
                fiveHourEnabled: primeEditor.fiveHour,
                weeklyEnabled: primeEditor.weekly,
            });
            if (settings.remote_mode === 'client' || settings.remote_mode === 'solo') {
                try {
                    await invoke('remote_push_account', { id: primeEditor.id });
                } catch (err) {
                    throw new Error(`Saved locally but Server sync failed: ${String(err)}`);
                }
            }
            onRefreshComplete?.();
            setPrimeEditor(null);
        } catch (err) {
            setPrimeError(String(err));
        } finally {
            setSavingPrime(false);
        }
    };

    const handleCopy = (id: string, text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const handleLaunchCodex = async (id: string, name: string) => {
        if (launchingIds.has(id)) return;
        setLaunchingIds(prev => new Set(prev).add(id));
        try {
            const msg = await invoke<string>('open_codex_terminal', { id });
            setPushToast({ type: 'success', text: msg || `${name} Codex Desktop opened` });
        } catch (e) {
            setPushToast({ type: 'error', text: `${name} launch failed: ${String(e)}` });
        } finally {
            setLaunchingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    // Click 🔄: modal lists reset credits with expiry
    const openResetModal = async (id: string, name: string, credits: number | null) => {
        if (resetting) return;
        const version = ++resetQueryVersion.current;
        setResetModal({ id, name, credits });
        setResetList(null);
        setResetListError(null);
        setResetListLoading(true);
        try {
            const items = await invoke<ResetCreditItem[]>('list_reset_credits', { id });
            if (version !== resetQueryVersion.current) return;
            setResetList(items);
        } catch (e) {
            if (version !== resetQueryVersion.current) return;
            setResetListError(humanizeRefreshError(String(e)));
        } finally {
            if (version === resetQueryVersion.current) setResetListLoading(false);
        }
    };

    const closeResetModal = () => {
        if (resetting) return;
        resetQueryVersion.current++;
        setResetModal(null);
        setResetList(null);
        setResetListError(null);
    };

    // Close modal after consume (bypass resetting guard while resetting is true)
    const closeResetModalForce = () => {
        setResetModal(null);
        setResetList(null);
        setResetListError(null);
    };

    const handleConsumeReset = async () => {
        if (!resetModal || resetting || resetListLoading || resetListError || !resetList?.length) return;
        const { id, name } = resetModal;
        // Track list; after success find consumed credit by id
        const listSnapshot = resetList;
        setResetting(true);
        try {
            const res = await invoke<ResetCreditResult>('consume_reset_credit', { id });
            closeResetModalForce();
            let text = `${name}: ${res.message}`;
            if (res.ok && res.consumed_credit_id && listSnapshot) {
                const burned = listSnapshot.find(c => c.id === res.consumed_credit_id);
                if (burned?.expires_at) {
                    text = `${name}: ${res.message} (used credit expiring ${fmtExpiry(burned.expires_at)})`;
                }
            }
            setPushToast({ type: res.ok ? 'success' : 'error', text });
            // After reset (or nothing_to_reset) refresh quota and credits
            if (res.ok || res.code === 'nothing_to_reset') {
                await handleRefreshOne(id);
            }
        } catch (e) {
            closeResetModalForce();
            setPushToast({ type: 'error', text: `${name} reset failed: ${humanizeRefreshError(String(e))}` });
        } finally {
            setResetting(false);
            setTimeout(() => setPushToast(null), 5000);
        }
    };

    const openInvite = (id: string, name: string) => setInviteModal({ id, name });

    // Initialize data
    useEffect(() => {
        const initialUsage: Record<string, UsageData> = {};
        const initialInvalids = new Set<string>();
        const initialBanned = new Set<string>();
        const initialRelayUsage: Record<string, RelayUsageCache> = {};

        accounts.forEach(acc => {
            if (acc.is_banned) {
                initialBanned.add(acc.id);
                initialInvalids.add(acc.id);
            } else if (acc.is_token_invalid || acc.is_logged_out) {
                initialInvalids.add(acc.id);
            }
            if (acc.relay_usage_cache) {
                initialRelayUsage[acc.id] = acc.relay_usage_cache;
            }
            if (acc.cached_quota) {
                const isValid = acc.cached_quota.is_valid_for_cli !== false;
                initialUsage[acc.id] = {
                    five_hour_left: acc.cached_quota.five_hour_left,
                    five_hour_reset: acc.cached_quota.five_hour_reset,
                    five_hour_reset_at: acc.cached_quota.five_hour_reset_at,
                    five_hour_label: acc.cached_quota.five_hour_label || '5H limit',
                    weekly_left: acc.cached_quota.weekly_left,
                    weekly_reset: acc.cached_quota.weekly_reset,
                    weekly_reset_at: acc.cached_quota.weekly_reset_at,
                    weekly_label: acc.cached_quota.weekly_label || 'Weekly limit',
                    plan_type: acc.cached_quota.plan_type,
                    is_valid_for_cli: isValid,
                    reset_credits: acc.cached_quota.reset_credits,
                    spark: acc.cached_quota.spark,
                    luna_reserve: acc.cached_quota.luna_reserve,
                };
                if (!isValid) initialInvalids.add(acc.id);
            }
        });
        setUsageMap(prev => ({ ...prev, ...initialUsage }));
        setRelayUsageMap(prev => ({ ...prev, ...initialRelayUsage }));
        setInvalidIds(initialInvalids);
        setBannedIds(initialBanned);
    }, [accounts]);

    // After auto reset: if cache older than reset_at, window reset but cache stale,
    // trigger refresh.
    // - 90s cooldown for invoke + new cached_quota;
    //   retry after 90s on failure
    // - skip in-flight refreshingIds
    // - backend persists invalid/banned/logged_out
    const handleRefreshOneRef = useRef<(id: string) => Promise<void>>(async () => {});
    const autoRefreshTsRef = useRef<Map<string, number>>(new Map());
    const refreshingIdsRef = useRef<Set<string>>(new Set());
    refreshingIdsRef.current = refreshingIds;
    useEffect(() => {
        const COOLDOWN_MS = 90 * 1000;
        const AUTO_CONCURRENCY = 4;

        const scan = () => {
            const nowMs = Date.now();
            const stale: string[] = [];
            const reasons: Record<string, string> = {};
            for (const acc of accounts) {
                if (effectiveKind(acc) !== 'chatgpt_oauth') continue;
                if (acc.is_banned || acc.is_token_invalid || acc.is_logged_out) continue;
                const cq = acc.cached_quota;
                if (!cq) continue;
                const updatedAtMs = cq.updated_at ? new Date(cq.updated_at).getTime() : 0;
                const fiveResetMs = (cq.five_hour_reset_at ?? 0) * 1000;
                const weeklyResetMs = (cq.weekly_reset_at ?? 0) * 1000;
                const needs5h = fiveResetMs > 0 && fiveResetMs <= nowMs && updatedAtMs < fiveResetMs;
                const needsWk = weeklyResetMs > 0 && weeklyResetMs <= nowMs && updatedAtMs < weeklyResetMs;
                if (!needs5h && !needsWk) continue;
                if (refreshingIdsRef.current.has(acc.id)) continue;
                const last = autoRefreshTsRef.current.get(acc.id) ?? 0;
                if (nowMs - last < COOLDOWN_MS) continue;
                autoRefreshTsRef.current.set(acc.id, nowMs);
                stale.push(acc.id);
                reasons[acc.id] = needs5h ? '5H' : 'weekly';
            }
            if (stale.length === 0) return;
            console.log(`[AutoRefresh] post-reset refresh for ${stale.length} account(s):`,
                stale.map(id => `${accounts.find(a => a.id === id)?.name}(${reasons[id]})`).join(', '));
            let cursor = 0;
            const worker = async () => {
                while (cursor < stale.length) {
                    const i = cursor++;
                    await handleRefreshOneRef.current(stale[i]).catch((e) => {
                        console.warn(`[AutoRefresh] ${stale[i]} refresh failed:`, e);
                    });
                }
            };
            for (let i = 0; i < Math.min(AUTO_CONCURRENCY, stale.length); i++) worker();
        };

        scan();
        const t = setInterval(scan, 30_000);
        return () => clearInterval(t);
    }, [accounts]);

    // Search and filter
    const filteredAccounts = useMemo(() => {
        let result = searchQuery
            ? accounts.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : accounts;

        if (filter !== 'all') {
            result = result.filter(a => {
                // Relay accounts filtered by relay_category
                const isRelay = effectiveKind(a) === 'relay';
                if (filter === 'relay') return isRelay && (a.relay_category ?? 'aggregator') === 'aggregator';
                if (filter === 'coding_plan') return isRelay && a.relay_category === 'coding_plan';
                if (filter === 'third_party') return isRelay && a.relay_category === 'third_party';
                if (isRelay) return false; // other plan filters are subscription-only
                if (filter === 'google') return effectiveKind(a) === 'antigravity_oauth';
                // Sub = ChatGPT subscriptions (not Relay / OpenAI key)
                if (filter === 'sub') return effectiveKind(a) === 'chatgpt_oauth';
                const type = usageMap[a.id]?.plan_type?.toLowerCase() || '';
                if (filter === 'pro') return type.includes('pro');
                if (filter === 'plus') return type.includes('plus');
                if (filter === 'team') return type.includes('team');
                if (filter === 'free') return type && !type.includes('pro') && !type.includes('plus') && !type.includes('team');
                return true;
            });
        }
        return result;
    }, [accounts, searchQuery, filter, usageMap]);

    const filterCounts = useMemo(() => {
        const counts = { all: accounts.length, sub: 0, google: 0, pro: 0, plus: 0, team: 0, free: 0, relay: 0, coding_plan: 0, third_party: 0 };
        accounts.forEach(a => {
            const kind = effectiveKind(a);
            if (kind === 'relay') {
                const cat = a.relay_category ?? 'aggregator';
                if (cat === 'coding_plan') counts.coding_plan++;
                else if (cat === 'third_party') counts.third_party++;
                else counts.relay++;
                return;
            }
            if (kind === 'antigravity_oauth') {
                counts.google++;
                return;
            }
            // Sub = ChatGPT subscription tiers combined
            if (kind === 'chatgpt_oauth') counts.sub++;
            const type = usageMap[a.id]?.plan_type?.toLowerCase() || '';
            if (type.includes('pro')) counts.pro++;
            else if (type.includes('plus')) counts.plus++;
            else if (type.includes('team')) counts.team++;
            else if (type) counts.free++;
        });
        return counts;
    }, [accounts, usageMap]);

    // Helpers
    const formatDate = (val?: string | Date | null) => {
        if (!val) return '-';
        const d = typeof val === 'string' ? new Date(val) : val;
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    const parseDuration = (str?: string) => {
        if (!str || str === 'Unknown' || str === 'N/A') return { text: 'N/A', hours: 999 };
        if (str === 'Reset soon') return { text: 'Resetting', hours: 0 };
        const matches = { d: str.match(/(\d+)d/), h: str.match(/(\d+)h/), m: str.match(/(\d+)m/) };
        const d = parseInt(matches.d?.[1] || '0'), h = parseInt(matches.h?.[1] || '0'), m = parseInt(matches.m?.[1] || '0');
        const totalH = d * 24 + h + m / 60;
        const compact = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
        return { text: compact || 'N/A', hours: totalH };
    };

    const getStatusInfo = (account: Account) => {
        const isCurrent = account.id === currentId;
        const err = account.keepalive?.last_error;
        const isPermanent = err?.toLowerCase().match(/invalidated|expired|invalid_refresh_token|invalid_grant/);

        if (isPermanent) return { text: 'Expired', warn: true };
        if (isCurrent) return { text: 'Current Account', warn: false };
        return { text: err ? 'Retrying' : 'OK', warn: !!err };
    };

    const handlePushToServer = async (id: string, name: string) => {
        setPushingIds(prev => new Set(prev).add(id));
        try {
            const r = await invoke<{ ok: boolean; id: string; upserted: string; quota_refreshed?: boolean }>(
                'remote_push_account',
                { id }
            );
            const actionText =
                r.upserted === 'created' ? 'New'
                : r.upserted === 'merged' ? 'Merge into existing account with same email'
                : 'Updated';
            const quotaText = r.quota_refreshed ? ', quota refreshed' : '';
            setPushToast({ type: 'success', text: `${name} push to Server OK (${actionText}${quotaText})` });
        } catch (e) {
            setPushToast({ type: 'error', text: `${name} push failed: ${e}` });
        } finally {
            setPushingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    const handleSwitchAntigravity = async (id: string, name: string) => {
        if (switchingIds.has(id)) return;
        setSwitchingIds(prev => new Set(prev).add(id));
        try {
            await invoke('switch_antigravity_account', { id });
            onRefreshComplete?.();
            setPushToast({ type: 'success', text: `Google current account switched to ${name}` });
        } catch (error) {
            setPushToast({ type: 'error', text: `Google switch failed: ${String(error)}` });
        } finally {
            setSwitchingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    const handleSwitchRelayModel = async (id: string, name: string) => {
        if(switchingIds.has(id))return;
        setSwitchingIds(prev=>new Set(prev).add(id));
        try {
            await invoke('switch_relay_model_account',{id,model:null});
            onRefreshComplete?.();
            setPushToast({type:'success',text:`Set ${name} as model current account (Codex / Google unchanged)`});
        }catch(error){setPushToast({type:'error',text:`Model switch failed: ${String(error)}`});}
        finally{setSwitchingIds(prev=>{const next=new Set(prev);next.delete(id);return next;});setTimeout(()=>setPushToast(null),4000);}
    };

    // Map Tauri/backend errors to readable messages.
    const humanizeRefreshError = (raw: string): string => {
        const s = raw.toLowerCase();
        if (s.includes('account_banned')) return 'Account banned';
        if (s.includes('token_invalid')) return 'Token invalid — re-login required';
        if (s.includes('account_logged_out')) return 'Login invalid: refresh_token expired or revoked — sign in again';
        if (s.includes('token_refresh_transient')) return 'Refresh failed: transient network/service error; account not marked invalid';
        if (s.includes('timeout') || s.includes('timed out')) return 'Request timeout (OpenAI slow/throttled)';
        if (s.includes('Network request failed') || s.includes('network')) return 'Network request failed — check proxy/network';
        if (s.includes('Refresh token') || s.includes('refresh')) return 'refresh_token refresh failed';
        if (s.includes('relay_account')) return 'For relay accounts use Relay balance refresh';
        if (raw.length > 160) return raw.slice(0, 160) + '…';
        return raw;
    };

    // Handlers
    const handleRefreshOne = async (id: string) => {
        setRefreshingIds(prev => new Set(prev).add(id));
        const acc = accounts.find(a => a.id === id);
        const accName = acc?.name ?? id;
        try {
            if (acc && effectiveKind(acc) === 'antigravity_oauth') {
                await invoke<Record<string, AntigravityModelQuota>>('refresh_antigravity_quota', { id });
                await onRefreshComplete?.();
                return;
            }
            // Relay uses dedicated fetcher (not OpenAI usage)
            if (acc && effectiveKind(acc) === 'relay') {
                const cache = await invoke<RelayUsageCache>('refresh_relay_usage', { id });
                setRelayUsageMap(prev => ({ ...prev, [id]: cache }));
                onRefreshComplete?.();
                return;
            }
            const cmd = settings.remote_mode === 'client'
                ? 'remote_refresh_account_quota'
                : 'get_quota_by_id';
            const usage = await invoke<UsageData>(cmd, { id });
            setUsageMap(prev => ({ ...prev, [id]: usage }));
            setInvalidIds(prev => {
                const next = new Set(prev);
                usage.is_valid_for_cli ? next.delete(id) : next.add(id);
                return next;
            });
            onRefreshComplete?.();
        } catch (err) {
            const errMsg = String(err);
            // Mark UI state by error type
            if (errMsg.includes('ACCOUNT_BANNED')) {
                setBannedIds(prev => new Set(prev).add(id));
                setInvalidIds(prev => new Set(prev).add(id));
            } else if (errMsg.includes('TOKEN_INVALID')) {
                setInvalidIds(prev => new Set(prev).add(id));
            }
            // Reload accounts when backend persisted re-login state.
            if (errMsg.includes('ACCOUNT_LOGGED_OUT')) {
                onRefreshComplete?.();
            }
            // Surface errors instead of silent fail
            setPushToast({
                type: 'error',
                text: `${accName} refresh failed: ${acc && effectiveKind(acc) === 'antigravity_oauth' ? errMsg : humanizeRefreshError(errMsg)}`,
            });
            setTimeout(() => setPushToast(null), 6000);
        } finally {
            setRefreshingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
    };

    // Ref latest handleRefreshOne for post-reset auto refresh effect
    // Avoid rebuilding effect dependencies.
    handleRefreshOneRef.current = handleRefreshOne;

    // The local AGY bridge exposes its quota through /v1/usage. Refresh it on
    // first appearance so the Relay row shows real 5H/7D progress bars instead
    // of the empty placeholder; other Relay providers remain manual-refresh.
    useEffect(() => {
        const agy = accounts.filter(acc => effectiveKind(acc) === 'relay'
            && /^(https?:\/\/)?(127\.0\.0\.1|localhost):28100\/v1\/?$/i.test(acc.relay_base_url || '')
            && !relayUsageMap[acc.id]);
        for (const account of agy) void handleRefreshOne(account.id);
        // The dependency is intentionally accounts: relayUsageMap changes as a
        // result of this effect and must not start a second request loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts]);

    const handleSaveUsageCookie = async () => {
        if (!cookieEditor) return;
        setSavingCookie(true);
        try {
            await invoke('update_relay_usage_cookie', {
                id: cookieEditor.id,
                usageCookie: cookieEditor.value.trim() || null,
            });
            setRelayUsageMap(prev => {
                const next = { ...prev };
                delete next[cookieEditor.id];
                return next;
            });
            const id = cookieEditor.id;
            setCookieEditor(null);
            await handleRefreshOne(id);
        } catch (e) {
            setPushToast({ type: 'error', text: `Save MiMo Cookie failed: ${e}` });
            setTimeout(() => setPushToast(null), 4000);
        } finally {
            setSavingCookie(false);
        }
    };

    /// Relay balance display:
    /// - unit `%` → progress mini-card (GLM-style percent)
    /// - else (USD/CNY) → text mini-card (unity2 amounts)
    const RelayQuotaItem = ({ account, cache }: { account: Account; cache: RelayUsageCache | undefined }) => {
        const isMiMoRelay = [
            account.relay_usage_preset,
            account.relay_base_url,
            account.relay_homepage,
            account.name,
        ].some(v => (v ?? '').toLowerCase().includes('mimo') || (v ?? '').toLowerCase().includes('xiaomimimo'));
        const canEditCookie = isMiMoRelay;
        const openCookieEditor = () => {
            if (!canEditCookie) return;
            setCookieEditor({
                id: account.id,
                name: account.name,
                value: account.relay_usage_cookie ?? '',
            });
        };
        const editableProps = canEditCookie
            ? {
                role: 'button',
                tabIndex: 0,
                title: 'Click to edit MiMo quota Cookie',
                onClick: openCookieEditor,
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openCookieEditor();
                    }
                },
            }
            : {};
        if (!cache) {
            return (
                <div className="quota-grid" {...editableProps}>
                    <QuotaItem label="Token quota" percentage={undefined} reset={undefined} />
                </div>
            );
        }
        if (cache.windows?.length) return <RelayQuotaWindows cache={cache} onlyGemini={/28100/.test(account.relay_base_url || '')} />;
        const unit = cache.unit ?? '';
        const isPercent = unit === '%' || unit.includes('%');
        if (isPercent) {
            return (
                <div className="quota-grid" {...editableProps}>
                    <QuotaItem
                        label="Token quota"
                        percentage={cache.remaining}
                        reset={cache.next_reset_at ? '' : undefined}
                        resetAt={cache.next_reset_at ?? undefined}
                    />
                </div>
            );
        }
        // Amount style mini-card with number + unit
        const tone = cache.is_active ? 'green' : 'red';
        return (
            <div className="quota-grid" {...editableProps}>
                <div className="quota-mini-card">
                    <div className={`quota-mini-bg ${tone}`} style={{ width: '100%' }} />
                    <div className="quota-mini-content">
                        <span className="quota-label">Balance</span>
                        <span className={`quota-percent ${tone}`}>
                            {cache.remaining.toFixed(2)} {unit}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    const QuotaItem = ({ label, percentage, reset, resetAt }: { label: string, percentage: number | undefined, reset: string | undefined, resetAt?: number }) => {
        const countdown = useShortCountdown(resetAt);
        const displayLabel = displayQuotaLabel(label);
        if (percentage === undefined) return (
            <div className="quota-mini-card empty">
                <span className="quota-label">{displayLabel}</span>
                <span className="quota-empty">-</span>
            </div>
        );
        const { text, hours } = parseDuration(reset);
        const displayTime = countdown || text;
        const color = percentage > 50 ? 'green' : percentage > 20 ? 'orange' : 'red';
        const timeColor = hours < 1 ? 'success' : hours < 6 ? 'warning' : 'neutral';

        return (
            <div className="quota-mini-card">
                <div className={`quota-mini-bg ${color}`} style={{ width: `${percentage}%` }} />
                <div className="quota-mini-content">
                    <span className="quota-label">{displayLabel}</span>
                    <div className={`quota-time ${timeColor}`}>
                        <Clock className="icon-tiny" />
                        <span>{displayResetText(displayTime)}</span>
                    </div>
                    <span className={`quota-percent ${color}`}>{Math.round(percentage)}%</span>
                </div>
            </div>
        );
    };

    return (
        <div className="account-list-container">
            <div className="account-list-toolbar">
                <div className="search-box">
                    <span className="search-icon">🔍</span>
                    <input type="text" placeholder="Search email..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <div className="filter-group">
                    {(['all', 'sub', 'google', 'pro', 'plus', 'team', 'free', 'relay', 'coding_plan', 'third_party'] as const).map(t => {
                        const isRelayLike = t === 'relay' || t === 'coding_plan' || t === 'third_party';
                        const isSubGroup = t === 'sub';
                        const label = t === 'all' ? 'ALL'
                            : t === 'sub' ? 'Sub'
                            : t === 'google' ? 'Google'
                            : t === 'coding_plan' ? 'Plan'
                            : t === 'third_party' ? '3rd'
                            : t === 'relay' ? 'Relay'
                            : t.toUpperCase();
                        return (
                            <button
                                key={t}
                                className={`filter-btn filter-btn-compact ${isRelayLike ? 'filter-btn--relay' : ''} ${isSubGroup ? 'filter-btn--sub' : ''} ${filter === t ? 'active' : ''}`}
                                onClick={() => setFilter(t)}
                            >
                                {label}<span className="filter-count">{filterCounts[t]}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="toolbar-spacer" />
                <button
                    className={`toolbar-icon-btn ${autoReload ? 'active-reload' : ''}`}
                    onClick={() => setAutoReload(!autoReload)}
                    title={autoReload ? 'Disable auto reload IDE' : 'Enable auto reload IDE'}
                >
                    <Zap size={16} fill={autoReload ? "currentColor" : "none"} />
                </button>
                {onAddAccount && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-primary"
                        onClick={onAddAccount}
                        title="Sign in (OpenAI / Google / import)"
                    >
                        <Plus size={16} />
                    </button>
                )}
                {onAddRelay && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-relay"
                        onClick={onAddRelay}
                        title="Add Relay (Coding Plan / general Responses relay)"
                    >
                        <Plus size={16} />
                    </button>
                )}
                {onRefreshUsage && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-accent"
                        onClick={onRefreshUsage}
                        disabled={usageLoading}
                        title="Refresh Codex current account quota"
                    >
                        <Gauge className={usageLoading ? 'spinning' : ''} size={16} />
                    </button>
                )}
                <button className="btn-refresh" title="Refresh quota for listed accounts" aria-label="Refresh quota for listed accounts" disabled={isRefreshingAll} onClick={() => {
                    // Was Promise.all — N accounts hit OpenAI usage at once,
                    // one throttled account 10s+ slows whole batch tail latency.
                    // Now concurrency 6 sliding window: fast first, slow queue,
                    // not thundering herd nor serial.
                    const CONCURRENCY = 6;
                    const ids = filteredAccounts.map(a => a.id);
                    setIsRefreshingAll(true);
                    let cursor = 0;
                    const worker = async () => {
                        while (cursor < ids.length) {
                            const i = cursor++;
                            await handleRefreshOne(ids[i]);
                        }
                    };
                    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker);
                    Promise.all(workers).finally(() => setIsRefreshingAll(false));
                }}>
                    <RefreshCw className={isRefreshingAll ? 'spinning' : ''} size={16} />
                </button>
            </div>

            <div className="desktop-quota-indicator" role="status">
                {!desktopProxyConfigured
                    ? 'Codex Desktop is not configured to use the proxy. Proxy ON alone does not switch Desktop quota; use Proxy → Global proxy, then restart Desktop.'
                    : verifiedAfterSwitch && lastDesktopAccount
                    ? `Codex Desktop quota verified: ${lastDesktopAccount.name}${lastDesktopAccount.id === currentId ? '' : ' (differs from selected)'} · ${new Date(desktopUsage!.timestamp).toLocaleTimeString()}`
                    : 'Codex Desktop quota unverified — send a request through the proxy to confirm the active account.'}
            </div>
            <div className="account-table-scroll">
                <div className="account-table-header">
                    <div className="col-checkbox">
                        <input type="checkbox" className="custom-checkbox" checked={filteredAccounts.length > 0 && filteredAccounts.every(a => selectedIds.has(a.id))} onChange={() => { const s = new Set(selectedIds); filteredAccounts.every(a => s.has(a.id)) ? filteredAccounts.forEach(a => s.delete(a.id)) : filteredAccounts.forEach(a => s.add(a.id)); setSelectedIds(s); }} />
                    </div>
                    <div className="col-drag"></div>
                    <div className="col-email">Account</div>
                    <div className="col-quota-merged">Quota</div>
                    <div className="col-time">Sync / keepalive</div>
                    <div className="col-actions">Actions</div>
                </div>

                <div className="account-table-body">
                    {filteredAccounts.map(acc => {
                        const usage = usageMap[acc.id];
                        const kind = effectiveKind(acc);
                        // Rate limited = any bucket (5H / week / Spark) at 0; upstream 429.
                        // Consume one manual reset now to recover (refill 0% window).
                        const rateLimited = !!usage && (
                            usage.five_hour_left === 0 ||
                            usage.weekly_left === 0 ||
                            (!!usage.spark && (usage.spark.five_hour_left === 0 || usage.spark.weekly_left === 0))
                        );
                        const isCurrent = acc.id === currentId;
                        const relayCurrent = relayCurrentState(acc,settings.current_relay_accounts);
                        const isModelRelay = relayCurrent.models.length>0;
                        const isAntigravityCurrent = kind === 'antigravity_oauth'
                            && settings.current_antigravity_account_id === acc.id;
                        const status = isAntigravityCurrent
                            ? { text: 'Google current', warn: false }
                            : relayCurrent.isCurrent ? {text:relayCurrent.label,warn:false} : getStatusInfo(acc);
                        const err = acc.keepalive?.last_error;
                        const isPermanentError = err?.toLowerCase().match(/invalidated|expired|invalid_refresh_token|invalid_grant/);
                        const isInvalid = invalidIds.has(acc.id) || !!isPermanentError || acc.is_token_invalid || acc.is_logged_out;
                        const isBanned = bannedIds.has(acc.id);
                        const isLoggedOut = acc.is_logged_out;
                        const isRefreshing = refreshingIds.has(acc.id);
                        const expiry = accountExpiryInfo(acc.account_expires_at);
                        const priming = acc.window_priming;
                        const primeMode = primingWindowKind(acc);
                        const primingEnabled = priming?.configured
                            ? (primeMode === 'weekly'
                                ? priming?.weekly_enabled
                                : priming?.five_hour_enabled)
                            : true;
                        const primingLabel = primeMode === 'weekly' ? '7D' : '5H';

                        return (
                            <div key={acc.id} className={`account-row ${isCurrent || isAntigravityCurrent || relayCurrent.isCurrent ? 'current' : ''} ${selectedIds.has(acc.id) ? 'selected' : ''} ${isBanned ? 'banned' : isLoggedOut ? 'logged-out' : isInvalid ? 'expired' : ''}`}>
                                <div className="col-checkbox">
                                    <input type="checkbox" className="custom-checkbox" checked={selectedIds.has(acc.id)} onChange={() => { const s = new Set(selectedIds); s.has(acc.id) ? s.delete(acc.id) : s.add(acc.id); setSelectedIds(s); }} />
                                </div>
                                <div className="col-drag"><span className="drag-handle">⋮⋮</span></div>
                                <div className="col-email" title="Click to copy account">
                                    {(() => {
                                        const isRelay = effectiveKind(acc) === 'relay';
                                        const isMiMoRelay = [
                                            acc.relay_usage_preset,
                                            acc.relay_base_url,
                                            acc.relay_homepage,
                                            acc.name,
                                        ].some(v => (v ?? '').toLowerCase().includes('mimo') || (v ?? '').toLowerCase().includes('xiaomimimo'));
                                        const link = isRelay
                                            ? (isMiMoRelay
                                                ? 'https://platform.xiaomimimo.com/console/plan-manage'
                                                : (acc.relay_homepage || acc.relay_base_url || ''))
                                            : '';
                                        const onNameClick = (e: React.MouseEvent) => {
                                            // Relay: click name opens homepage/base_url; else copy
                                            if (isRelay && link) {
                                                e.stopPropagation();
                                                openUrl(link).catch((err) => {
                                                    console.error('openUrl failed:', err);
                                                });
                                            } else {
                                                handleCopy(acc.id, acc.name);
                                            }
                                        };
                                        return (
                                            <span
                                                className={isRelay ? 'email-text relay-name-link' : 'email-text'}
                                                onClick={onNameClick}
                                                title={isRelay && link ? `Open ${link}` : undefined}
                                            >
                                                {acc.name}
                                            </span>
                                        );
                                    })()}
                                    <div className="badges" style={{ display: 'flex', gap: '4px', marginLeft: '8px', flexWrap: 'wrap' }}>
                                        {(() => {
                                            const k = effectiveKind(acc);
                                            if (k === 'antigravity_oauth' && isAntigravityCurrent) return null;
                                            const meta = k === 'relay' ? relayCategoryBadge(acc) : KIND_BADGE[k];
                                        return <span className={meta.className}>{meta.label}</span>;
                                        })()}
                                        <button
                                            type="button"
                                            className="badge widget-id-badge"
                                            title="Set the number and symbol shown in the quota widget"
                                            onClick={e => {
                                                e.stopPropagation();
                                                setWidgetIdentityError(null);
                                                setWidgetIdentityEditor({
                                                    id: acc.id,
                                                    name: acc.name,
                                                    number: acc.widget_number?.toString() ?? '',
                                                    emoji: acc.widget_emoji ?? '',
                                                });
                                            }}
                                        >{acc.widget_emoji ? `${acc.widget_emoji} ` : ''}{acc.widget_number == null ? (acc.widget_emoji ? '' : 'ID') : `#${acc.widget_number}`}</button>
                                        {copiedId === acc.id && <span className="badge copy-success">Copied</span>}
                                        {isCurrent && !isModelRelay && <span className="badge current">Current</span>}
                                        {relayCurrent.isCurrent && <span className="badge current" title={`Current models: ${relayCurrent.active.join(', ')}`}>{relayCurrent.label}</span>}
                                        {isAntigravityCurrent && <span className="badge current">Google current</span>}
                                        {kind === 'antigravity_oauth' && (() => {
                                            const tier = antigravityTier(acc);
                                            return <span className={tier.className}>{tier.label}</span>;
                                        })()}
                                        {acc.is_session_anchor && (
                                            <span
                                                className="badge anchor"
                                                title="Phone anchor: disk ~/.codex/auth.json follows this account; Codex.app phone remote binds here; switching others moves proxy only, disk unchanged"
                                            >📱 Phone anchor</span>
                                        )}
                                        {isBanned ? <span className="badge banned" title="This account was banned by OpenAI">Banned</span> : isLoggedOut ? <span className="badge logged-out" title="Login invalid — refresh_token expired, revoked, or session ended elsewhere">Re-login</span> : isInvalid && <span className="badge expired" title="This account token expired or invalid">Expired</span>}
                                        {expiry.badge && <span className={`badge account-expiry ${expiry.tone}`} title={expiry.title}>📅 {expiry.badge}</span>}
                                        {usage?.plan_type && <span className="badge plan">{usage.plan_type.toUpperCase()}</span>}
                                        {kind === 'chatgpt_oauth' && usage?.reset_credits == null && (
                                            <button type="button" className="badge reset-credits clickable"
                                                title="Upstream returned no reset credits — not necessarily zero. Click to query bank details."
                                                onClick={() => openResetModal(acc.id, acc.name, null)}>
                                                🔄 Credits unknown
                                            </button>
                                        )}
                                        {usage?.reset_credits != null && (
                                            usage.reset_credits > 0 ? (
                                                <span
                                                    className={`badge reset-credits clickable${rateLimited ? ' limited' : ''}`}
                                                    title={rateLimited
                                                        ? '⚡ Rate limited (quota bucket 0) — use a manual reset now for best recovery; click for details'
                                                        : 'Click to list manual reset credits (with expiry), then consume one to reset quota window'}
                                                    onClick={() => openResetModal(acc.id, acc.name, usage.reset_credits ?? 0)}
                                                    style={{ cursor: 'pointer' }}
                                                >{rateLimited ? '⚡' : ''}🔄 {usage.reset_credits}</span>
                                            ) : (
                                                <span className="badge reset-credits" title="Manual reset credits (0 left — cannot reset)">🔄 {usage.reset_credits}</span>
                                            )
                                        )}
                                    </div>
                                </div>
                                <div className={`col-quota-merged ${kind === 'antigravity_oauth' ? 'google-quota-column' : ''}`}>
                                    {effectiveKind(acc) === 'relay' ? (
                                        <>{<RelayQuotaItem account={acc} cache={relayUsageMap[acc.id]} />} {/28100/.test(acc.relay_base_url || '') && <AgyRelayModelQuotas cache={relayUsageMap[acc.id]} models={relayCurrent.models} />}</>
                                    ) : effectiveKind(acc) === 'antigravity_oauth' ? (
                                        <AntigravityQuota quotas={antigravityModelQuotas(acc)} />
                                    ) : usage ? (
                                        <div className="quota-grid">
                                            <QuotaItem label={usage.five_hour_label} percentage={usage.five_hour_left} reset={usage.five_hour_reset} resetAt={usage.five_hour_reset_at} />
                                            {usage.weekly_reset_at && (
                                                <QuotaItem label={usage.weekly_label} percentage={usage.weekly_left} reset={usage.weekly_reset} resetAt={usage.weekly_reset_at} />
                                            )}
                                            {usage.spark && (
                                                <>
                                                    <QuotaItem label="Spark 5H" percentage={usage.spark.five_hour_left} reset={usage.spark.five_hour_reset} resetAt={usage.spark.five_hour_reset_at} />
                                                    <QuotaItem label="Spark weekly" percentage={usage.spark.weekly_left} reset={usage.spark.weekly_reset} resetAt={usage.spark.weekly_reset_at} />
                                                </>
                                            )}
                                            {usage.luna_reserve?.allowed && !usage.luna_reserve.limit_reached && (
                                                <QuotaItem
                                                    label="Luna Reserve"
                                                    percentage={Math.max(0, 100 - usage.luna_reserve.used_percent)}
                                                    reset=""
                                                    resetAt={usage.luna_reserve.reset_at ?? undefined}
                                                />
                                            )}
                                        </div>
                                    ) : <span className="quota-empty">No data</span>}
                                </div>
                                <div className="col-time">
                                    <div className="time-item">
                                        <span className="time-label">Keepalive:</span>
                                        <span className={`time-val ${status.warn ? 'warn' : ''}`}>{status.text}</span>
                                    </div>
                                    <div className="time-item refresh">
                                        <span className="time-label">Refresh:</span>
                                        <span className="time-val">{formatDate(kind === 'antigravity_oauth' ? antigravityQuotaUpdatedAt(acc) : acc.cached_quota?.updated_at)}</span>
                                    </div>
                                    <div className="time-item account-expiry-row">
                                        <span className="time-label">Expiry:</span>
                                        <button
                                            className={`time-val account-expiry-value ${expiry.tone}`}
                                            title={expiry.title}
                                            onClick={() => {
                                                setExpiryError(null);
                                                setExpiryEditor({ id: acc.id, name: acc.name, value: acc.account_expires_at ?? '' });
                                            }}
                                        >{expiry.text}</button>
                                    </div>
                                    {effectiveKind(acc) !== 'relay' && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <div className="wakeup-row">
                                            <button
                                                className="wakeup-btn"
                                                onClick={() => handleLaunchCodex(acc.id, acc.name)}
                                                disabled={launchingIds.has(acc.id)}
                                                title='Open Codex Desktop (ChatGPT app). Uses ~/.codex — with phone anchor, the anchored account stays on disk.'
                                            >
                                                {launchingIds.has(acc.id) ? 'Starting…' : '🚀 Launch Desktop'}
                                            </button>
                                            {effectiveKind(acc) === 'chatgpt_oauth' && (
                                                <button
                                                    className={`wakeup-btn window-prime-btn ${primingEnabled ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setPrimeError(null);
                                                        setPrimeEditor({
                                                            id: acc.id,
                                                            name: acc.name,
                                                            mode: primeMode,
                                                            fiveHour: primeMode === 'five_hour' ? (priming?.configured ? (priming?.five_hour_enabled ?? false) : true) : false,
                                                            weekly: primeMode === 'weekly' ? (priming?.configured ? (priming?.weekly_enabled ?? false) : true) : false,
                                                            lastAttempt: priming?.last_attempt_at,
                                                            lastSuccess: priming?.last_success_at,
                                                            lastError: priming?.last_error,
                                                        });
                                                    }}
                                                    title={priming?.last_error
                                                        ? `Window priming last error: ${priming.last_error}`
                                                        : 'Window priming sends one minimal Codex request after quota window reset'}
                                                >{primingEnabled ? `🌿 Priming · ${primingLabel}` : `🌿 Priming off · ${primingLabel}`}</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="col-actions">
                                    <button className="action-btn refresh" onClick={() => handleRefreshOne(acc.id)} disabled={isRefreshing} title={kind === 'antigravity_oauth' ? 'Refresh model quota' : 'Refresh'}><RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} /></button>
                                    {settings.remote_mode === 'client' && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <button
                                            className="action-btn push"
                                            onClick={() => handlePushToServer(acc.id, acc.name)}
                                            disabled={pushingIds.has(acc.id)}
                                            title="Push to Server"
                                        >
                                            <UploadCloud size={14} className={pushingIds.has(acc.id) ? 'spinning' : ''} />
                                        </button>
                                    )}
                                    {!isCurrent && !isModelRelay && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <button className="action-btn switch" onClick={() => onSwitch(acc.id)} disabled={switchingIds.has(acc.id)} title="Switch"><ArrowLeftRight size={14} /></button>
                                    )}
                                    {isModelRelay && !relayCurrent.allCurrent && <button className="action-btn switch"
                                        onClick={()=>handleSwitchRelayModel(acc.id,acc.name)} disabled={switchingIds.has(acc.id)}
                                        title={`Set current for models: ${relayCurrent.models.join(', ')} (Codex / Google unchanged)`}><ArrowLeftRight size={14}/></button>}
                                    {kind === 'antigravity_oauth' && !isAntigravityCurrent && (
                                        <button
                                            className="action-btn switch"
                                            onClick={() => handleSwitchAntigravity(acc.id, acc.name)}
                                            disabled={switchingIds.has(acc.id)}
                                            title="Switch Google current (Codex current unchanged)"
                                        >
                                            <ArrowLeftRight size={14} />
                                        </button>
                                    )}
                                    {effectiveKind(acc) === 'chatgpt_oauth' && (usage?.plan_type ?? '').toLowerCase() !== 'free' && (
                                        <button className="action-btn invite" onClick={() => openInvite(acc.id, acc.name)} title="ChatGPT desktop invites & rewards"><UserPlus size={14} /></button>
                                    )}
                                    <button className="action-btn delete" onClick={() => setAccountToDelete({ id: acc.id, name: acc.name })} title="Delete"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="account-list-footer">
                <span>{filteredAccounts.length} account(s)</span>
                {selectedIds.size > 0 && <span className="selected-info">{selectedIds.size} selected</span>}
                {pushToast && (
                    <span className={`push-toast ${pushToast.type}`} style={{ marginLeft: 'auto' }}>
                        {pushToast.text}
                    </span>
                )}
            </div>

            <ConfirmModal
                isOpen={!!accountToDelete}
                title="Confirm delete account"
                message={<p>Permanently delete account <strong>{accountToDelete?.name}</strong>?<br /><br />This cannot be undone; local auth for this account will be removed.</p>}
                confirmText="Delete permanently"
                onConfirm={() => {
                    if (accountToDelete) {
                        onDelete(accountToDelete.id);
                        setAccountToDelete(null);
                    }
                }}
                onCancel={() => setAccountToDelete(null)}
            />

            {expiryEditor && (
                <div className="modal-overlay" onClick={() => !savingExpiry && setExpiryEditor(null)}>
                    <div className="modal-content account-expiry-modal" onClick={e => e.stopPropagation()}>
                        <div className="account-expiry-modal-header">
                            <div>
                                <h2>Account expiry date</h2>
                                <p>{expiryEditor.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setExpiryEditor(null)} disabled={savingExpiry}>×</button>
                        </div>
                        <div className="account-expiry-modal-body">
                            <label htmlFor="account-expiry-date">Expiry date</label>
                            <input
                                id="account-expiry-date"
                                type="date"
                                value={expiryEditor.value}
                                onChange={e => setExpiryEditor({ ...expiryEditor, value: e.target.value })}
                                disabled={savingExpiry}
                            />
                            <p className="account-expiry-help">ChatGPT / Codex do not expose a reliable subscription expiry API — set it manually here. Does not change login token, quota reset, or auto-switch. Clear the date and save to remove.</p>
                            {expiryError && <p className="account-expiry-error">{expiryError}</p>}
                        </div>
                        <div className="account-expiry-modal-actions">
                            <button
                                className="secondary-btn"
                                onClick={() => setExpiryEditor({ ...expiryEditor, value: '' })}
                                disabled={savingExpiry || !expiryEditor.value}
                            >Clear date</button>
                            <div className="account-expiry-modal-actions-right">
                                <button className="secondary-btn" onClick={() => setExpiryEditor(null)} disabled={savingExpiry}>Cancel</button>
                                <button className="primary-btn" onClick={saveAccountExpiry} disabled={savingExpiry}>
                                    {savingExpiry ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {widgetIdentityEditor && (
                <div className="modal-overlay" onClick={() => !savingWidgetIdentity && setWidgetIdentityEditor(null)}>
                    <div className="modal-content account-expiry-modal" onClick={e => e.stopPropagation()}>
                        <div className="account-expiry-modal-header">
                            <div>
                                <h2>Widget account identifier</h2>
                                <p>{widgetIdentityEditor.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setWidgetIdentityEditor(null)} disabled={savingWidgetIdentity}>×</button>
                        </div>
                        <div className="account-expiry-modal-body">
                            <label htmlFor="widget-account-number">Number ID</label>
                            <input
                                id="widget-account-number"
                                type="number"
                                min={1}
                                max={9999}
                                step={1}
                                placeholder="Optional"
                                value={widgetIdentityEditor.number}
                                onChange={e => setWidgetIdentityEditor({ ...widgetIdentityEditor, number: e.target.value })}
                                disabled={savingWidgetIdentity}
                            />
                            <label htmlFor="widget-account-emoji">Symbol / emoji</label>
                            <select
                                id="widget-account-emoji"
                                value={widgetIdentityEditor.emoji}
                                onChange={e => setWidgetIdentityEditor({ ...widgetIdentityEditor, emoji: e.target.value })}
                                disabled={savingWidgetIdentity}
                            >
                                <option value="">None</option>
                                {WIDGET_EMOJIS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <p className="account-expiry-help">Choose Number or Emoji in Settings → Appearance. A missing identifier falls back to the shortened account name.</p>
                            {widgetIdentityError && <p className="account-expiry-error">{widgetIdentityError}</p>}
                        </div>
                        <div className="account-expiry-modal-actions">
                            <span />
                            <div className="account-expiry-modal-actions-right">
                                <button className="secondary-btn" onClick={() => setWidgetIdentityEditor(null)} disabled={savingWidgetIdentity}>Cancel</button>
                                <button className="primary-btn" onClick={saveWidgetIdentity} disabled={savingWidgetIdentity}>
                                    {savingWidgetIdentity ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {primeEditor && (
                <div className="modal-overlay" onClick={() => !savingPrime && setPrimeEditor(null)}>
                    <div className="modal-content account-expiry-modal window-prime-modal" onClick={e => e.stopPropagation()}>
                        <div className="account-expiry-modal-header">
                            <div>
                                <h2>Window priming</h2>
                                <p>{primeEditor.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setPrimeEditor(null)} disabled={savingPrime}>×</button>
                        </div>
                        <div className="account-expiry-modal-body window-prime-options">
                            {primeEditor.mode === 'five_hour' ? (
                                <label className="window-prime-option">
                                    <input
                                        type="checkbox"
                                        checked={primeEditor.fiveHour}
                                        onChange={e => setPrimeEditor({ ...primeEditor, fiveHour: e.target.checked })}
                                        disabled={savingPrime}
                                    />
                                    <span><strong>API · 5-hour window</strong><small>Auto-detect from primary_window duration</small></span>
                                </label>
                            ) : (
                                <label className="window-prime-option">
                                    <input
                                        type="checkbox"
                                        checked={primeEditor.weekly}
                                        onChange={e => setPrimeEditor({ ...primeEditor, weekly: e.target.checked })}
                                        disabled={savingPrime}
                                    />
                                    <span><strong>API · 7-day window</strong><small>Auto-detect from primary_window duration</small></span>
                                </label>
                            )}
                            <p className="account-expiry-help">By default all subscription accounts are managed using /wham/usage primary_window for 5H vs 7D (not plan name). First ambiguous 100% window gets one tiny request; then fixed reset_at schedule. Disable per account here; client/solo runs on Server only.</p>
                            {(primeEditor.lastAttempt || primeEditor.lastSuccess || primeEditor.lastError) && (
                                <div className="window-prime-status">
                                    {primeEditor.lastAttempt && <span>Last attempt: {new Date(primeEditor.lastAttempt).toLocaleString()}</span>}
                                    {primeEditor.lastSuccess && <span className="ok">Last success: {new Date(primeEditor.lastSuccess).toLocaleString()}</span>}
                                    {primeEditor.lastError && <span className="err">Last result: {primeEditor.lastError}</span>}
                                </div>
                            )}
                            {primeError && <p className="account-expiry-error">{primeError}</p>}
                        </div>
                        <div className="account-expiry-modal-actions">
                            <span></span>
                            <div className="account-expiry-modal-actions-right">
                                <button className="secondary-btn" onClick={() => setPrimeEditor(null)} disabled={savingPrime}>Cancel</button>
                                <button className="primary-btn" onClick={saveWindowPriming} disabled={savingPrime}>
                                    {savingPrime ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {resetModal && (
                <div className="modal-overlay" onClick={closeResetModal}>
                    <div className="modal-content reset-credit-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-top">
                                <h2>Manual reset · {resetModal.name}</h2>
                                <button className="close-btn" onClick={closeResetModal} disabled={resetting}>×</button>
                            </div>
                        </div>
                        <div className="modal-body">
                            {resetListLoading ? (
                                <p className="modal-tip">Loading reset credits…</p>
                            ) : resetListError ? (
                                <p className="modal-tip err" role="alert">Failed to load details: {resetListError}<br />Available count unknown — not necessarily zero. Retry later.</p>
                            ) : resetList && resetList.length > 0 ? (
                                <>
                                    <p className="modal-tip" style={{ marginBottom: 10 }}>
                                        <strong>{resetList.length}</strong> credit(s), sorted by expiry (earliest first). All credits are <strong>equivalent</strong>; server picks which to consume (usually earliest expiry).
                                    </p>
                                    <ul className="reset-credit-list">
                                        {resetList.map((c, i) => {
                                            const dl = daysLeft(c.expires_at);
                                            const urgency = dl == null ? '' : dl < 3 ? 'urgent' : dl < 7 ? 'warn' : '';
                                            return (
                                                <li key={c.id} className={`reset-credit-row ${urgency}`}>
                                                    <span className="rc-mark">{i === 0 ? '▸' : ''}</span>
                                                    <span className="rc-expiry">{fmtExpiry(c.expires_at)}</span>
                                                    <span className="rc-days">{dl == null ? '' : `${dl}d left`}</span>
                                                    <span className="rc-source">{c.source}</span>
                                                    {i === 0 && <span className="rc-badge">Will be used</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="modal-tip" style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                                        Using 1 credit clears exhausted 5H / weekly window immediately; irreversible. If quota not maxed, upstream may return nothing to reset and <strong>not deduct</strong>.
                                    </p>
                                </>
                            ) : (
                                <p className="modal-tip">No manual reset credits for this account.</p>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-ghost" onClick={closeResetModal} disabled={resetting}>Cancel</button>
                            <button type="button" className="btn btn-ghost"
                                onClick={() => openResetModal(resetModal.id, resetModal.name, resetModal.credits)}
                                disabled={resetting || resetListLoading}>Query again</button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleConsumeReset}
                                disabled={resetting || resetListLoading || !!resetListError || !resetList?.length}
                            >
                                {resetting ? 'Resetting…' : 'Reset now'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {cookieEditor && (
                <div className="modal-overlay" onClick={() => !savingCookie && setCookieEditor(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-top">
                                <h2>Edit MiMo quota Cookie</h2>
                                <button className="close-btn" onClick={() => setCookieEditor(null)} disabled={savingCookie}>
                                    ×
                                </button>
                            </div>
                        </div>
                        <div className="modal-body">
                            <p className="modal-tip" style={{ marginBottom: 12 }}>
                                Account: {cookieEditor.name}. Sign in at <code>platform.xiaomimimo.com</code>, copy <code>Cookie:</code> header from Network.
                            </p>
                            <textarea
                                value={cookieEditor.value}
                                onChange={e => setCookieEditor(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                rows={5}
                                placeholder="Cookie: api-platform_serviceToken=...; userId=...; api-platform_ph=..."
                                style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, width: '100%' }}
                                disabled={savingCookie}
                            />
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-ghost" onClick={() => setCookieEditor(null)} disabled={savingCookie}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSaveUsageCookie} disabled={savingCookie}>
                                {savingCookie ? 'Saving…' : 'Save and refresh'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inviteModal && <ReferralInviteModal key={inviteModal.id} {...inviteModal} onClose={() => setInviteModal(null)} />}
        </div>
    );
}
