import type { ReviewItem } from '@/lib/api';
import { VersionedReview } from './versioned-review';
import { useWorkspaceAccess } from './use-workspace-access';
import type { Decision } from '@/lib/workspace-access';

export function ReviewRevisionButton({ item, job, workspace, reload }: { item: ReviewItem; job: string; workspace: string; reload: () => void }) {
  const permission = useWorkspaceAccess(workspace);
  if (!permission.access || item.version === undefined || !item.actions?.propose) return null;
  return <VersionedReview jobId={job} actorId={Number(permission.actorId)} access={permission.access} reload={reload}
    record={{ key: item.input_record_key, version: item.version, status: item.status, decision: item.decision?.decision as Decision ?? null,
      reviewerId: item.reviewer_user_id ?? null, reviewerName: item.decision?.reviewer ?? null,
      protection: item.decision_protection ?? 'open', origin: item.decision_origin ?? 'auto',
      candidates: item.candidates.map(c => ({ id: c.id, referenceKey: c.reference_record_key ?? '', label: `${c.reference_record_key ?? '—'} (${c.score ?? '—'}%)` })) }} />;
}
