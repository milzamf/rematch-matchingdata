<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiHealthTest extends TestCase
{
    public function test_health_endpoint_returns_batchmatch_status(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJson([
                'success' => true,
                'data' => [
                    'service' => 'BatchMatch API',
                    'status' => 'healthy',
                    'version' => '0.1.0',
                ],
            ]);
    }
}
