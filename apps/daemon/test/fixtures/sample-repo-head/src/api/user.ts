export interface User {
  id: string;
  name: string;
  email: string | null;
}

export interface FetchOptions {
  cache?: boolean;
}

/** Ambil user dari API; null kalau tidak ada. */
export async function fetchUser(id: string, opts: FetchOptions = {}): Promise<User | null> {
  const res = await fetch(`/api/users/${id}`, { cache: opts.cache ? 'force-cache' : 'no-store' });
  if (!res.ok) return null;
  return parseUser(await res.json());
}

export function parseUser(raw: unknown): User {
  const r = raw as User;
  return { id: r.id, name: r.name, email: r.email ?? null };
}
