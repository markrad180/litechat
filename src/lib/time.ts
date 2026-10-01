export function timeAgo(ts: number): string {
	const s = Math.floor((Date.now() - ts) / 1000);
	if (s < 60) return 'now';
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	const d = new Date(ts);
	return d.getFullYear() === new Date().getFullYear()
		? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
		: d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
}

export function fullDate(ts: number): string {
	return new Date(ts).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}
