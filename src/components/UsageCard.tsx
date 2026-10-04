import { UsageDisplay } from '../hooks/useUsage';
import { useCountdown } from '../hooks/useCountdown';
import { displayResetText } from '../utils/englishQuotaText';
import './UsageCard.css';

interface UsageCardProps {
    usage: UsageDisplay | null;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
}


export function UsageCard({ usage, loading, error, onRefresh }: UsageCardProps) {
    if (loading && !usage) {
        return (
            <div className="usage-inline loading">
                <div className="spinner-small" />
                <span>Loading usage...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="usage-inline error">
                <span className="error-text">{error}</span>
                <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
                    Retry
                </button>
            </div>
        );
    }

    if (!usage) {
        return null;
    }

    const fiveHourTimeLeft = useCountdown(usage.five_hour_reset_at);
    const weeklyTimeLeft = useCountdown(usage.weekly_reset_at);
    const isFree = usage.plan_type === 'free';

    return (
        <div className="usage-meters">
            {/* 5h quota / free limit */}
            <div className="usage-row">
                <span className="usage-label">{isFree ? 'Limit' : '5h Quota'}</span>
                <span className="usage-reset">{displayResetText(fiveHourTimeLeft || usage.five_hour_reset)}</span>
                <span className="usage-percent">{usage.five_hour_left}%</span>
            </div>
            <div className="meter-bar">
                <div
                    className={`meter-fill ${getColorClass(usage.five_hour_left)}`}
                    style={{ width: `${usage.five_hour_left}%` }}
                />
            </div>

            {/* Weekly quota — PRO accounts */}
            {!isFree && (
                <>
                    <div className="usage-row">
                        <span className="usage-label">Weekly Quota</span>
                        <span className="usage-reset">{displayResetText(weeklyTimeLeft || usage.weekly_reset)}</span>
                        <span className="usage-percent">{usage.weekly_left}%</span>
                    </div>
                    <div className="meter-bar">
                        <div
                            className={`meter-fill ${getColorClass(usage.weekly_left)}`}
                            style={{ width: `${usage.weekly_left}%` }}
                        />
                    </div>
                </>
            )}

            {usage.luna_reserve?.allowed && !usage.luna_reserve.limit_reached && (
                <>
                    <div className="usage-row">
                        <span className="usage-label">Luna Reserve</span>
                        <span className="usage-reset">{usage.luna_reserve.reset_at ? new Date(usage.luna_reserve.reset_at * 1000).toLocaleString() : ''}</span>
                        <span className="usage-percent">{Math.max(0, 100 - usage.luna_reserve.used_percent)}%</span>
                    </div>
                    <div className="meter-bar">
                        <div
                            className={`meter-fill ${getColorClass(100 - usage.luna_reserve.used_percent)}`}
                            style={{ width: `${Math.max(0, 100 - usage.luna_reserve.used_percent)}%` }}
                        />
                    </div>
                </>
            )}

            {/* Credits */}
            {usage.has_credits && usage.credits_balance !== null && (
                <div className="usage-credits">
                    <span className="credits-label">💰 Credits</span>
                    <span className="credits-value">${usage.credits_balance.toFixed(2)}</span>
                </div>
            )}
        </div>
    );
}

function getColorClass(percent: number): string {
    if (percent > 50) return 'green';
    if (percent > 20) return 'orange';
    return 'red';
}
