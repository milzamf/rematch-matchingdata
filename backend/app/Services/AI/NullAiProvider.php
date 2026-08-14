<?php

namespace App\Services\AI;

class NullAiProvider implements AiProviderInterface
{
    /**
     * @param  array{code: string, message: string}  $failure
     */
    public function __construct(
        private readonly string $provider,
        private readonly array $failure,
    ) {
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function generateStructured(array $payload): AiResponse
    {
        unset($payload);

        return AiResponse::failure(
            provider: $this->provider,
            model: null,
            errorCode: $this->failure['code'],
            errorMessage: $this->failure['message'],
        );
    }
}
