<?php

namespace App\Services\AI;

interface AiProviderInterface
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public function generateStructured(array $payload): AiResponse;
}
