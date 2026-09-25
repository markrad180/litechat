export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
	if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
	return res.json() as Promise<T>;
}
