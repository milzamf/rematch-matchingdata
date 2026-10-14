import type { VersionedReviewRecord } from "@/components/workspace-access/versioned-review";
// Explicit dev-only read-model fixture. No fake endpoint or database state.
export const reviewFixture: VersionedReviewRecord = {
  key: "001",
  version: 3,
  decision: "accept_match",
  status: "matched",
  reviewerId: 1,
  reviewerName: "Owner",
  protection: "reviewer_owned",
  origin: "manual",
  candidates: [
    { id: "01a1237b-9ba0-72b3-9063-8a47736f4863", referenceKey: "1", label: "Perusahaan Acuan" },
  ],
};
