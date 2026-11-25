export interface FixtureRepo {
  root: string;
  bare: string;
  work: string;
  fullName: string;
  baseSha: string;
  headSha: string;
  prNumber: number;
  commit(files: Record<string, string>, msg: string, branch?: string): string;
  git(...args: string[]): string;
}
export declare function createFixtureRepo(fullName?: string, root?: string): FixtureRepo;
export declare function gitUrlTemplate(root: string): string;
