// Types for the session routing feature (frontend mirror of Rust types).
// Backend contract is fixed — DON'T drift from this without coordinating with
// the Tauri commands in src-tauri/.

export interface SessionRoute {
    id: string;
    session_id: string;
    account_id: string;
    enabled: boolean;
    label: string | null;
    created_at: string;          // ISO 8601
    last_hit_at: string | null;
    hit_count: number;
}

export interface CodexSession {
    session_id: string;
    rollout_path: string;
    started_at: string;          // ISO 8601
    cwd: string | null;
    cli_version: string | null;
    first_user_text: string | null;
    model: string | null;
}

/** Loose UUID v4/v7 validation. 36 chars + 4 dashes; doesn't enforce variant
 *  bits. The backend is the source of truth — frontend just protects against
 *  obvious typos. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isLikelyUuid(s: string): boolean {
    return UUID_RE.test(s.trim());
}

/** Show the first 12 chars of a session_id (so the row stays readable when
 *  there's no label). 8 hex + dash + 3 hex == 12 chars, enough to disambiguate. */
export function shortSessionId(sid: string): string {
    return sid.length > 12 ? sid.slice(0, 12) : sid;
}

/** Relative time formatter — "3h ago" / "Yesterday 14:22" / "2025-11-08 14:22". */
export function formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diff = now - d.getTime();
    const min = Math.floor(diff / 60_000);
    const hr = Math.floor(diff / 3_600_000);
    const day = Math.floor(diff / 86_400_000);

    if (diff < 0) return d.toLocaleString();
    if (min < 1) return 'Just now';
    if (min < 60) return `${min} min ago`;
    if (hr < 24) return `${hr} hr ago`;
    if (day === 1) {
        return `Yesterday ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    if (day < 7) return `${day}d ago`;
    // Older than a week — fall back to absolute date.
    const yyyy = d.getFullYear();
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    const hh = d.getHours().toString().padStart(2, '0');
    const mi = d.getMinutes().toString().padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/** Pull the last path segment (basename) from a cwd. Handles both POSIX and
 *  Windows separators. Returns '' for null. */
export function basename(p: string | null | undefined): string {
    if (!p) return '';
    const norm = p.replace(/[\\/]+$/, '');
    const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
    return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Truncate first_user_text to a fixed width for the picker list. */
export function truncate(s: string | null | undefined, max = 80): string {
    if (!s) return '';
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
