import { UsageDisplay } from '../hooks/useUsage';
import { Account } from '../hooks/useAccounts';
import { StatsBar } from './StatsBar';
import { UsageCard } from './UsageCard';
import './Dashboard.css';

interface DashboardProps {
    accounts: Account[];
    currentAccount: Account | null;
    usage: UsageDisplay | null;
    usageLoading: boolean;
    usageError: string | null;
    isCurrentInvalid?: boolean;
    onSwitch: (id: string) => void;
    onRefreshUsage: () => void;
    onNavigateToAccounts: () => void;
    onExport: () => void;
    proxyRunning?: boolean;
    syncStatus?: {
        is_synced: boolean;
        disk_email: string | null;
        matching_id: string | null;
    };
    onSyncWithDisk: () => void;
    onImportDiskAccount: (name: string) => void;
    onForceOverwriteDisk: () => void;
}

export function Dashboard({
    accounts,
    currentAccount,
    usage,
    usageLoading,
    usageError,
    isCurrentInvalid,
    onSwitch,
    onRefreshUsage,
    onNavigateToAccounts,
    onExport,
    proxyRunning,
    syncStatus,
    onSyncWithDisk,
    onImportDiskAccount,
    onForceOverwriteDisk,
}: DashboardProps) {
    // Switch always writes disk auth.json (store ↔ disk); mismatch only when
    // user changed login in codex manually or disk edited externally.
    const isMismatched = !!(syncStatus && !syncStatus.is_synced);
    const isHarmless = isMismatched && proxyRunning;

    // v0.7+ phone anchor: disk intentionally behind current but identity = anchor,
    // BY DESIGN not conflict: anchor set, anchor != current, disk matches anchor.
    const anchorAccount = accounts.find(a => a.is_session_anchor);
    const anchorIsActiveLayer = !!(
        anchorAccount &&
        currentAccount &&
        anchorAccount.id !== currentAccount.id &&
        isMismatched &&
        syncStatus?.matching_id === anchorAccount.id
    );
    // Best account recommendation (highest quota)
    const getBestAccount = () => {
        if (accounts.length === 0) return null;
        // Return first non-current account
        return accounts.find(a => a.id !== currentAccount?.id) || null;
    };

    const bestAccount = getBestAccount();

    return (
        <div className="dashboard">
            {/* Greeting */}
            <div className="dashboard-greeting">
                <h2>
                    Hello, {currentAccount?.name.split('@')[0] || 'User'} 👋
                </h2>
            </div>

            {/* Stats cards */}
            <StatsBar accountCount={accounts.length} usage={usage} />

            {/* Phone anchor: disk locked on anchor — info not warning */}
            {anchorIsActiveLayer && anchorAccount && (
                <div className="sync-info-banner anchor-active">
                    <div className="banner-content">
                        <span className="banner-icon">📱</span>
                        <div className="banner-text">
                            <strong>Phone anchor active:</strong>
                            Codex.app stays online as <span>{anchorAccount.name}</span> (phone bridge stays up),
                            Proxy egress switched to <b>{currentAccount?.name}</b>.
                        </div>
                    </div>
                </div>
            )}

            {/* Legacy disk mismatch banner hidden when anchor active */}
            {syncStatus && !syncStatus.is_synced && !anchorIsActiveLayer && (
                <div className={isHarmless ? 'sync-info-banner' : 'sync-warning-banner'}>
                    <div className="banner-content">
                        <span className="banner-icon">{isHarmless ? 'ℹ️' : '⚠️'}</span>
                        <div className="banner-text">
                            {isHarmless ? (
                                <>
                                    <strong>Disk auth.json behind:</strong>
                                    Stuck on <span>{syncStatus.disk_email || 'Unknown account'}</span>
                                    (Proxy injects active account token — <b>codex still works</b>;
                                    After proxy off, codex reads this account)
                                </>
                            ) : (
                                <>
                                    <strong>Session mismatch:</strong>
                                    IDE is using <span>{syncStatus.disk_email || 'Unknown account'}</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="banner-actions">
                        {syncStatus.matching_id ? (
                            <button className="btn btn-sm btn-accent" onClick={onSyncWithDisk}>
                                {isHarmless ? 'Sync disk' : 'Fix active state'}
                            </button>
                        ) : (
                            <button className="btn btn-sm btn-primary" onClick={() => onImportDiskAccount(syncStatus.disk_email || 'New account')}>
                                Import this account
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Two-column layout */}
            <div className="dashboard-grid">
                {/* Current Account */}
                <div className={`dashboard-card current-account ${isCurrentInvalid ? 'invalid' : ''}`}>
                    <div className="card-header">
                        <span className="card-icon">✓</span>
                        <h3>Current Account</h3>
                        {isCurrentInvalid && <span className="invalid-badge" title="Auth expired — delete and sign in again">⚠️ Invalid</span>}
                    </div>
                    {currentAccount ? (
                        <div className="current-account-content">
                            <div className="account-info">
                                <span className="email-icon">✉</span>
                                <span className="email">{currentAccount.name}</span>
                                {usage?.plan_type && (
                                    <span className="plan-badge">{usage.plan_type.toUpperCase()}</span>
                                )}
                            </div>

                            {isMismatched && !anchorIsActiveLayer ? (
                                <div className="mismatch-panel">
                                    <div className="mismatch-headline">
                                        Does not match ~/.codex/auth.json identity
                                    </div>
                                    <div className="mismatch-detail">
                                        IDE currently:<span className="mono">{syncStatus?.disk_email || 'Unknown'}</span>
                                    </div>
                                    <div className="mismatch-actions">
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={onForceOverwriteDisk}
                                        >
                                            Overwrite IDE with this account
                                        </button>
                                        {syncStatus?.matching_id ? (
                                            <button className="btn btn-ghost btn-sm" onClick={onSyncWithDisk}>
                                                Use IDE current
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => onImportDiskAccount(syncStatus?.disk_email || 'New account')}
                                            >
                                                Import IDE current
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <UsageCard
                                    usage={usage}
                                    loading={usageLoading}
                                    error={usageError}
                                    onRefresh={onRefreshUsage}
                                />
                            )}

                            <button
                                className="btn btn-outline btn-full"
                                onClick={onNavigateToAccounts}
                            >
                                Switch account
                            </button>
                        </div>
                    ) : (
                        <div className="no-account">
                            <p>No accounts</p>
                        </div>
                    )}
                </div>

                {/* Best account pick */}
                <div className="dashboard-card best-accounts">
                    <div className="card-header">
                        <span className="card-icon">↗</span>
                        <h3>Best account pick</h3>
                    </div>
                    <div className="best-accounts-list">
                        {bestAccount ? (
                            <div className="best-account-item">
                                <div className="account-label">
                                    <span className="label-text">Recommended</span>
                                    <span className="account-email">{bestAccount.name}</span>
                                </div>
                                <span className="quota-badge">100%</span>
                            </div>
                        ) : (
                            <p className="no-recommendation">No recommendation</p>
                        )}
                    </div>
                    {accounts.length > 1 && (
                        <button
                            className="btn btn-accent btn-full"
                            onClick={() => bestAccount && onSwitch(bestAccount.id)}
                        >
                            Switch to best
                        </button>
                    )}
                </div>
            </div>

            {/* Quick links */}
            <div className="dashboard-links">
                <button className="link-card" onClick={onNavigateToAccounts}>
                    <span>View all accounts</span>
                    <span className="link-arrow">→</span>
                </button>
                <button className="link-card" onClick={onExport}>
                    <span>Export account data</span>
                    <span className="link-icon">↓</span>
                </button>
            </div>
        </div>
    );
}
