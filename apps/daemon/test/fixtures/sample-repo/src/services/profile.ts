import { fetchUser } from '../api/user';

export async function loadProfile(id: string) {
  const user = await fetchUser(id);
  if (!user) return null;
  return { title: formatName(user.name), id: user.id };
}

function formatName(name: string): string {
  return name.trim();
}

export class ProfileService {
  async display(id: string) {
    const p = await loadProfile(id);
    return p?.title ?? '-';
  }
}
