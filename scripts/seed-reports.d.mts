import type { Firestore } from 'firebase-admin/firestore';
export declare function seedReportFixture(db: Firestore, weekStart: string): Promise<void>;
export declare const EXPECTED: {
  dev2: {
    prsReviewed: number;
    avgScore: number;
    findings: number;
    bug: number;
    test: number;
    addressedRate: number;
    prevPrs: number;
    prevFindings: number;
    prevAddressedRate: number;
    findingsPerPr: number;
    prevFindingsPerPr: number;
    improvement: number;
    bugDevPct: number;
  };
  dev3: { prsReviewed: number; avgScore: number; findings: number; improvement: number };
  team: { prsReviewed: number; findings: number; avgScore: number; mostImproved: string[] };
};
