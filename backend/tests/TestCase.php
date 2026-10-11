<?php

namespace Tests;

use App\Models\User;
use App\Support\Auth\UserRole;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Laravel\Sanctum\Sanctum;

abstract class TestCase extends BaseTestCase
{
    public function createApplication()
    {
        $app = parent::createApplication();
        // Docker may carry a cached local configuration; test fixtures must stay isolated.
        $app['env'] = 'testing';
        $app['config']->set('app.env', 'testing');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('database.default', 'sqlite');
        $app['config']->set('database.connections.sqlite.database', ':memory:');
        $app['config']->set('queue.default', 'sync');

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();

        try {
            $user = User::factory()->create([
                'role' => UserRole::Admin->value,
            ]);
            $this->actingAs($user);
            Sanctum::actingAs($user, ['*']);
        } catch (\Throwable) {
            // In case database is not available for unit tests
        }
    }
}
