import type { Credentials, FirebaseWebConfig } from './creds.js';
import { DAEMON_VERSION } from './env.js';

async function post<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Server membalas ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Server membalas ${res.status}`);
  return json as T;
}

export async function exchangeCode(server: string, code: string) {
  return post<{ machineId: string; machineSecret: string; firebaseConfig: FirebaseWebConfig }>(
    `${server.replace(/\/$/, '')}/exchangeMachineCode`,
    { code, platform: `${process.platform}-${process.arch}`, daemonVersion: DAEMON_VERSION },
  );
}

export async function mintToken(c: Credentials) {
  const r = await post<{ token: string }>(`${c.server.replace(/\/$/, '')}/mintMachineToken`, {
    machineId: c.machineId,
    secret: c.machineSecret,
  });
  return r.token;
}

/** Panggil callable lewat protokol HTTP callable. */
export async function callFunction<T>(server: string, name: string, data: unknown, idToken: string): Promise<T> {
  const r = await post<{ result?: T; error?: { message: string } }>(
    `${server.replace(/\/$/, '')}/${name}`,
    { data },
    { authorization: `Bearer ${idToken}` },
  );
  if (r.error) throw new Error(r.error.message);
  return r.result as T;
}
