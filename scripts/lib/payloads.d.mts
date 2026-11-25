/* eslint-disable @typescript-eslint/no-explicit-any */
export declare const INSTALLATION_ID: number;
export declare function repoJson(fullName: string, id: number): any;
export interface IssueCommentOpts { fullName: string; repoId: number; prNumber: number; body: string; login?: string; userId?: number; association?: string; commentId?: number; userType?: string }
export declare function issueComment(o: IssueCommentOpts): any;
export declare function pullRequestClosed(o: { fullName: string; repoId: number; prNumber: number; merged?: boolean; headSha: string; baseSha: string; mergeSha?: string | null; title?: string; login?: string }): any;
export declare function push(o: { fullName: string; repoId: number; before: string; after: string; ref?: string }): any;
export declare function installationRepositories(o: { fullName: string; repoId: number }): any;
export declare function reviewCommentReply(o: { fullName: string; repoId: number; prNumber: number; inReplyTo: number; body: string; login?: string; userId?: number }): any;
export declare function sign(raw: string, secret: string): string;
export declare function sendWebhook(base: string, event: string, payload: unknown, o?: { secret?: string; delivery?: string; badSignature?: boolean }): Promise<{ status: number; body: any; delivery: string }>;
