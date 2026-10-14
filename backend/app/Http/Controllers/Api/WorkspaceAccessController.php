<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\WorkspaceAccessRequest;
use App\Services\Matching\Transactions\ReviewTransactionService;
use App\Services\Workspace\WorkspaceAccessService;
use App\Services\Workspace\WorkspaceMembershipService;
use Illuminate\Support\Facades\DB;

/** Only the isolated /stage5a namespace uses this controller. Actor always comes from session. */
final class WorkspaceAccessController extends Controller
{
    private function access(): WorkspaceAccessService
    {
        return new WorkspaceAccessService(DB::connection(), (bool) config('workspace_access.enabled'));
    }

    private function members(): WorkspaceMembershipService
    {
        return new WorkspaceMembershipService(DB::connection(), $this->access());
    }

    private function review(): ReviewTransactionService
    {
        return new ReviewTransactionService(DB::connection(), (bool) config('review_transactions.enabled'), null, $this->access());
    }

    private function output(mixed $data, int $status = 200)
    {
        return response()->json(['success' => $status < 400, 'data' => $data], $status);
    }

    public function index(WorkspaceAccessRequest $r)
    {
        return $this->output($this->access()->workspaces((int) $r->user()->getKey(), (int) $r->input('page', 1)));
    }

    public function permissions(WorkspaceAccessRequest $r, string $workspace)
    {
        $access = $this->access()->workspace((int) $r->user()->getKey(), $workspace);

        return $this->output(['workspace_id' => $workspace, 'role' => $access['role'], 'permissions' => $access['permissions'], 'membership_version' => $access['membership_version']]);
    }

    public function listMembers(WorkspaceAccessRequest $r, string $workspace)
    {
        return $this->output($this->members()->members((int) $r->user()->getKey(), $workspace, (int) $r->input('page', 1)));
    }

    public function searchUsers(WorkspaceAccessRequest $r, string $workspace)
    {
        return $this->output($this->members()->search((int) $r->user()->getKey(), $workspace, $r->validated('search')));
    }

    public function setMember(WorkspaceAccessRequest $r, string $workspace)
    {
        return $this->output($this->members()->set((int) $r->user()->getKey(), $workspace, (int) $r->validated('user_id'), $r->validated('role'), (int) $r->validated('expected_version')));
    }

    public function revokeMember(WorkspaceAccessRequest $r, string $workspace, string $member)
    {
        return $this->output($this->members()->set((int) $r->user()->getKey(), $workspace, (int) $member, null, (int) $r->validated('expected_version')));
    }

    public function resource(WorkspaceAccessRequest $r, string $workspace, string $kind, string $resource)
    {
        $row = $this->access()->resource((int) $r->user()->getKey(), $workspace, $kind, $resource);

        // Scoped metadata inspection, never expose storage paths, credentials or arbitrary JSON.
        return $this->output(array_intersect_key((array) $row, array_flip(['id', 'name', 'status', 'row_count', 'column_count', 'matching_job_id', 'input_record_key', 'reference_record_key', 'candidate_rank', 'overall_score', 'decision', 'reviewer_user_id', 'proposed_by_user_id', 'approved_by_user_id', 'last_modified_by_user_id', 'state_version_after', 'processed_count', 'total_count', 'created_at'])));
    }

    public function propose(WorkspaceAccessRequest $r, string $job)
    {
        $data = $r->validated();
        $item = array_intersect_key($data, array_flip(['input_record_key', 'expected_version', 'decision', 'candidate_id']));
        $item['expected_version'] = (int) $item['expected_version'];

        return $this->output($this->review()->propose((int) $r->user()->getKey(), $job, $data['idempotency_key'], $item, $data['reason']));
    }

    public function resolve(WorkspaceAccessRequest $r, string $job, string $proposal)
    {
        $ack = $this->review()->resolve((int) $r->user()->getKey(), $job, $r->validated('idempotency_key'), $proposal, (int) $r->validated('expected_request_version'), $r->boolean('approve'), $r->validated('reason') ?? '');

        return $this->output($ack, $ack['conflicted'] > 0 ? 409 : 200);
    }

    public function decide(WorkspaceAccessRequest $r, string $job)
    {
        $items = $r->validated('items');
        foreach ($items as &$item) {
            $item['expected_version'] = (int) $item['expected_version'];
        } unset($item);

        return $this->output($this->review()->decide((int) $r->user()->getKey(), $job, $r->validated('idempotency_key'), $items, count($items) > 1));
    }

    public function undo(WorkspaceAccessRequest $r, string $job)
    {
        $items = $r->validated('items');
        foreach ($items as &$item) {
            $item['expected_version'] = (int) $item['expected_version'];
        } unset($item);

        return $this->output($this->review()->undo((int) $r->user()->getKey(), $job, $r->validated('idempotency_key'), $r->validated('operation_id'), $items));
    }

    public function proposals(WorkspaceAccessRequest $r, string $job)
    {
        $this->access()->job((int) $r->user()->getKey(), $job, 'approve');
        $query = DB::table('review_change_requests as r')->join('review_states as s', 's.id', '=', 'r.review_state_id')
            ->leftJoin('review_decisions as b', fn ($join) => $join->on('b.review_state_id', '=', 'r.review_state_id')->on('b.state_version_after', '=', 'r.expected_version'))
            ->leftJoin('users as old', 'old.id', '=', 'r.previous_reviewer_user_id')->join('users as proposer', 'proposer.id', '=', 'r.proposed_by_user_id')
            ->leftJoin('users as approver', 'approver.id', '=', 'r.approved_by_user_id')->where('r.matching_job_id', $job);
        if ($r->has('status')) {
            $query->where('r.status', $r->validated('status'));
        }
        $query->selectRaw('CASE WHEN s.version = r.expected_version THEN s.decision ELSE b.decision END AS before_decision');

        return $this->output($query->addSelect(['r.*', 's.input_record_key', 's.version as current_state_version', 'old.name as previous_reviewer_name', 'proposer.name as proposer_name', 'approver.name as approver_name'])->orderBy('r.created_at')->orderBy('r.id')->paginate(50,
            ['r.*', 's.input_record_key', 's.version as current_state_version', 'old.name as previous_reviewer_name', 'proposer.name as proposer_name', 'approver.name as approver_name'], 'page', (int) $r->input('page', 1))->toArray());
    }
}
