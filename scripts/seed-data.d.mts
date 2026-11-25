import type { Firestore } from 'firebase-admin/firestore';
export declare const SEED_MEMBERS: { id: string; githubLogin: string; name: string; role: string; level: string }[];
export declare function readSeedPrompt(key: string): string;
export declare function seedBase(
  db: Firestore,
  members?: { id: string; githubLogin: string; name: string; role: string; level: string }[],
): Promise<void>;
