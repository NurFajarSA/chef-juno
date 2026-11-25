export declare const BOT: { login: string; id: number; type: string };
export interface MockRequest { method: string; path: string; query: Record<string, string>; body: any; headers: Record<string, unknown>; at: number } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface MockComment { id: number; repo: string; issueNumber: number; body: string; user: { login: string; type: string }; html_url: string; updated?: number }
export interface MockReviewComment { id: number; reviewId: number; repo: string; prNumber: number; path: string; line: number; start_line: number | null; side: string; body: string; html_url: string; commit_id: string }
export interface MockReview { id: number; repo: string; prNumber: number; body: string; event: string; commit_id: string }
export interface MockReaction { id: number; subject: 'issue_comment' | 'review_comment'; subjectId: number; content: string; user: { login: string } }
export interface MockPr { number: number; title: string; body?: string; author: string; authorId?: number; baseSha: string; headSha: string; baseRef?: string; headRef?: string; state?: string; merged?: boolean; mergeSha?: string | null; draft?: boolean;
  /** riwayat untuk Analitik → Dampak */
  createdAt?: string; closedAt?: string | null; mergedAt?: string | null; additions?: number; deletions?: number; changedFiles?: number;
  /** review manusia yang dikembalikan GET /pulls/{n}/reviews */
  humanReviews?: { user: { login: string; type: string }; submitted_at: string; state: string }[] }
export declare class GithubMock {
  repos: Map<string, { fullName: string; id: number; bare: string; defaultBranch: string; installationId: number; prs: Map<number, MockPr> }>;
  issueComments: MockComment[];
  reviews: MockReview[];
  reviewComments: MockReviewComment[];
  reactions: MockReaction[];
  resolvedThreads: Set<number>;
  requests: MockRequest[];
  failNextReview: boolean;
  statuses: { id: number; repo: string; sha: string; state: string; context: string; description: string; target_url: string | null }[];
  denyStatuses: boolean;
  reset(): void;
  addRepo(r: { fullName: string; id: number; bare: string; defaultBranch?: string; installationId?: number }): void;
  addPr(fullName: string, pr: MockPr): void;
  calls(method: string, re: RegExp): MockRequest[];
  summaryComments(fullName: string, number: number): MockComment[];
  start(port?: number): Promise<this>;
  stop(): Promise<void>;
}
