<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SharedWorkspaceReaderBoundaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_reader_routes_stay_disabled_even_with_flags_on_sqlite(): void
    {
        foreach ([false, true] as $enabled) {
            config(['workspace_access.enabled' => $enabled]);
            foreach (['workspaces/w', 'workspaces/w/jobs/j/review-results', 'workspaces/w/jobs/j/candidates?record_key=001', 'workspaces/w/datasets/d/rows'] as $path) {
                $this->getJson('/api/stage5a/'.$path)->assertStatus(503)->assertJson(['code' => 'workspace_access_disabled']);
            }
        }
    }

    public function test_unauthenticated_reader_is_rejected_before_guard(): void
    {
        auth()->forgetGuards();
        $this->getJson('/api/stage5a/workspaces/w')->assertUnauthorized();
    }

    public function test_deep_pagination_preserves_opaque_keys_and_bounds_payload(): void
    {
        $request = \App\Http\Requests\SharedWorkspaceReadRequest::create('/', 'GET', ['page' => 12000, 'per_page' => 25, 'record_key' => ' 001 ']);
        $action = \App\Http\Controllers\Api\SharedWorkspaceReadController::class.'@review';
        $route = new \Illuminate\Routing\Route('GET', '/', ['uses' => $action, 'controller' => $action]);
        $request->setRouteResolver(fn () => $route);
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), $request->rules());
        $request->withValidator($validator);
        $this->assertTrue($validator->passes(), $validator->errors()->toJson());
        $this->assertSame(' 001 ', $validator->validated()['record_key']);
        $request->merge(['page' => 1000001, 'per_page' => 101, 'status' => 'fake', 'user_id' => 1]);
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), $request->rules());
        $request->withValidator($validator);
        $this->assertTrue($validator->fails());
        foreach (['page', 'per_page', 'status', 'request'] as $field) {
            $this->assertTrue($validator->errors()->has($field));
        }
        $request->replace(['input_province_code' => ['32'], 'input_regency_code' => ['3204']]);
        $validator = \Illuminate\Support\Facades\Validator::make($request->all(), $request->rules());
        $request->withValidator($validator);
        $this->assertTrue($validator->fails());
    }
}
