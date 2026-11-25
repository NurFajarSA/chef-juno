export interface User {
  id: string;
  name: string;
  email: string | null;
}

/** Ambil user dari API; null kalau tidak ada. */
export async function fetchUser(id: string): Promise<User | null> {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) return null;
  return parseUser(await res.json());
}

export function parseUser(raw: unknown): User {
  const r = raw as User;
  return { id: r.id, name: r.name, email: r.email ?? null };
}
