import { ApiError, fetchReviewResults, type ReviewCaseGroup, type ReviewDecisionResult, type ReviewDecisionSummary, type ReviewItem, type ReviewResults } from './api';
import { accessApi, type Decision, type ReviewAck, WorkspaceAccessError } from './workspace-access';

type Input = { inputRecordKey: string; inputRecordKeys?: string[]; matchingResultId?: string; decision: Decision; snapshots?: ReviewItem[]; groupSnapshot?: ReviewCaseGroup };

async function snapshot(job: string, keys: string[]): Promise<ReviewResults> {
  let result: ReviewResults | undefined;
  const items: ReviewItem[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    result = await fetchReviewResults(job, { input_keys: keys.slice(i, i + 100), include_groups: false, include_quality: false, per_page: 100 });
    items.push(...result.items);
  }
  if (!result) throw new ApiError('Tidak ada record yang dipilih.', 422);
  return { ...result, items };
}

export async function saveVersionedReview(job: string, input: Input): Promise<ReviewDecisionResult> {
  const keys = [...new Set(input.inputRecordKeys ?? [input.inputRecordKey])];
  if (keys.length > 50) throw new ApiError('Pilih maksimal 50 record per operasi review. Keputusan belum dikirim.', 422);
  const rows = new Map(input.snapshots?.map(row => [row.input_record_key, row]));
  const items = keys.map(key => {
    const row = rows.get(key);
    const version = row?.version ?? input.groupSnapshot?.review_versions?.[`key:${key}`];
    const candidate = input.matchingResultId ?? row?.candidates[0]?.id ?? input.groupSnapshot?.review_candidates?.[`key:${key}`];
    if (!Number.isInteger(version)) throw new ApiError('Muat hasil terbaru sebelum memutuskan record ini.', 409);
    if (row?.actions?.requires_proposal) throw new ApiError('Keputusan reviewer lain memerlukan pengajuan revisi melalui panel review bersama.', 409);
    return { input_record_key: key, expected_version: version!, decision: input.decision,
      ...(input.decision === 'mark_unmatched' ? {} : { candidate_id: candidate }) };
  });
  let applied = 0;
  const skipped: { input_record_key: string; reference_record_key: string | null; reason: string }[] = [];
  let operation = '';
  try {
    for (let i = 0; i < items.length; i += 50) {
      let ack: ReviewAck;
      try { ack = await accessApi.decide(job, items.slice(i, i + 50), crypto.randomUUID()); }
      catch (error) {
        if (error instanceof WorkspaceAccessError && error.ack) ack = error.ack;
        else throw error;
      }
      operation = ack.operation_id;
      applied += ack.applied;
      skipped.push(...ack.items.filter(item => item.outcome !== 'applied').map(item => ({ input_record_key: item.input_record_key, reference_record_key: null, reason: item.code ?? item.conflict_code ?? item.outcome })));
      // Never automatically resubmit stale/conflicting versions.
    }
    if (!applied) throw new ApiError(skipped.map(item => item.reason).join('; ') || 'Keputusan belum diterapkan. Muat data terbaru.', 409);
    const review = await snapshot(job, keys);
    return { review, decision: { id: operation, input_record_key: input.inputRecordKey, decision: input.decision, selected_reference_record_key: null,
      new_result_type: input.decision === 'mark_unmatched' ? 'unmatched' : input.decision === 'reject_match' ? 'possible_match' : 'matched',
      affected_records: applied, skipped_records: skipped, skipped_count: skipped.length } };
  } catch (error) {
    window.dispatchEvent(new Event('rematch:review-changed'));
    throw new ApiError(`${error instanceof Error ? error.message : 'Keputusan gagal disimpan.'}${applied ? ` ${applied} record sudah tersimpan; muat data terbaru.` : ''}`, error instanceof WorkspaceAccessError || error instanceof ApiError ? error.status : 409);
  }
}

export async function undoVersionedReview(job: string, decision?: ReviewDecisionSummary): Promise<ReviewResults> {
  if (!decision?.operation_id || !decision.undo_items?.length || decision.undo_items.length > 50) {
    throw new ApiError('Undo operasi ini tidak tersedia pada snapshot sekarang. Muat hasil terbaru.', 409);
  }
  try {
    await accessApi.undo(job, decision.operation_id, decision.undo_items, crypto.randomUUID());
    return snapshot(job, decision.undo_items.map(item => item.input_record_key));
  } catch (error) {
    window.dispatchEvent(new Event('rematch:review-changed'));
    throw new ApiError(error instanceof Error ? error.message : 'Undo gagal.', error instanceof WorkspaceAccessError ? error.status : 409);
  }
}
