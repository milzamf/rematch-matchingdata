export type EffectiveReviewStatus = "matched" | "possible_match" | "unmatched";

const compatibility: Record<string, EffectiveReviewStatus> = {
  matched: "matched", auto_matched: "matched", manual_accepted: "matched",
  possible_match: "possible_match", need_review: "possible_match", manual_rejected: "possible_match",
  unmatched: "unmatched", confirmed_unmatched: "unmatched",
};

/** Server status is authoritative; display labels describe provenance. */
export function effectiveReviewStatus(item: { status?: string; display_status?: string }): EffectiveReviewStatus | null {
  const value = item.status || item.display_status;
  return value && Object.hasOwn(compatibility, value) ? compatibility[value] : null;
}
