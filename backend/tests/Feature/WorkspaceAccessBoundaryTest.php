<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\WorkspaceAccessController;
use App\Http\Requests\WorkspaceAccessRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class WorkspaceAccessBoundaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_new_endpoints_are_disabled_and_cannot_be_enabled_on_main_or_sqlite(): void
    {
        $this->assertFalse((bool) config('workspace_access.enabled'));
        $this->getJson('/api/stage5a/workspaces')->assertStatus(503)->assertJson(['code' => 'workspace_access_disabled']);
        config(['workspace_access.enabled' => true, 'review_transactions.enabled' => true]);
        $this->getJson('/api/stage5a/workspaces')->assertStatus(503)->assertJson(['code' => 'workspace_access_disabled']);
    }

    public function test_unauthed_requests_cannot_enter_isolated_api(): void
    {
        auth()->forgetGuards();
        $this->getJson('/api/stage5a/workspaces')->assertUnauthorized();
    }

    private function validateBody(string $method, array $body): array
    {
        $request = WorkspaceAccessRequest::create('/api/stage5a/test', 'POST', $body);
        $route = new Route(['POST'], 'api/stage5a/test', ['uses' => WorkspaceAccessController::class.'@'.$method, 'controller' => WorkspaceAccessController::class.'@'.$method]);
        $request->setRouteResolver(fn () => $route);
        $request->setUserResolver(fn () => User::query()->first());
        $request->setContainer($this->app);
        $request->setRedirector($this->app['redirect']);
        $request->validateResolved();

        return $request->validated();
    }

    public function test_actor_spoofing_and_extra_nested_fields_are_rejected(): void
    {
        foreach ([
            ['setMember', ['user_id' => 1, 'role' => 'owner', 'expected_version' => 0]],
            ['setMember', ['user_id' => 1, 'role' => 'editor', 'expected_version' => 0, 'actor_user_id' => 1]],
            ['decide', ['idempotency_key' => 'x', 'items' => [['input_record_key' => '001', 'expected_version' => 1, 'decision' => 'mark_unmatched', 'approved_by_user_id' => 1]]]],
        ] as [$method, $body]) {
            try {
                $this->validateBody($method, $body);
            } catch (ValidationException $error) {
                $this->assertNotEmpty($error->errors());

                continue;
            }
            $this->fail('Manipulated request accepted');
        }
    }

    public function test_validated_review_keeps_string_key_and_approval_has_no_actor_field(): void
    {
        $data = $this->validateBody('propose', ['input_record_key' => '001', 'expected_version' => 1, 'decision' => 'mark_unmatched', 'reason' => 'Verified evidence', 'idempotency_key' => 'proposal']);
        $this->assertSame('001', $data['input_record_key']);
        $this->assertArrayNotHasKey('reviewer_user_id', $data);
        $data = $this->validateBody('resolve', ['expected_request_version' => 1, 'approve' => true, 'idempotency_key' => 'approve']);
        $this->assertTrue($data['approve']);
    }
}
