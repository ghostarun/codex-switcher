export function displayQuotaLabel(label: string): string {
    if (/weekly|7\s*d|周/i.test(label)) return 'Weekly limit';
    if (/24\s*h|24小时/i.test(label)) return '24H limit';
    if (/5\s*h|5小时/i.test(label)) return '5H limit';
    return label;
}

export function displayResetText(text: string): string {
    return text
        .replace(/(\d+)天(\d+)小时(\d+)分钟后重置/g, 'Resets in $1d $2h $3m')
        .replace(/(\d+)天后重置/g, 'Resets in $1d')
        .replace(/(\d+)小时(\d+)分钟后重置/g, 'Resets in $1h $2m')
        .replace(/(\d+)分钟后重置/g, 'Resets in $1m')
        .replace(/未知/g, 'Unknown')
        .replace(/即将重置/g, 'Resetting soon');
}
