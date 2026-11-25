import { fetchUser } from '../api/user';

export async function loadProfile(id: string) {
  const user = await fetchUser(id, { cache: true });
  const data = user.name.toUpperCase();
  return { title: formatName(data), id: user.id };
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
