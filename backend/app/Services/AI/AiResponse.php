<?php

namespace App\Services\AI;

class AiResponse
{
    /**
     * @param  array<string, mixed>|null  $data
     * @param  array<string, mixed>|null  $usage
     */
    public function __construct(
        public readonly bool $success,
        public readonly string $provider,
        public readonly ?string $model,
        public readonly ?array $data = null,
        public readonly ?array $usage = null,
        public readonly ?int $latencyMs = null,
        public readonly ?string $errorCode = null,
        public readonly ?string $errorMessage = null,
    ) {
    }

    /**
     * @param  array<string, mixed>|null  $data
     * @param  array<string, mixed>|null  $usage
     */
    public static function success(
        string $provider,
        ?string $model,
        ?array $data,
        ?array $usage = null,
        ?int $latencyMs = null,
    ): self {
        return new self(
            success: true,
            provider: $provider,
            model: $model,
            data: $data,
            usage: $usage,
            latencyMs: $latencyMs,
        );
    }

    public static function failure(
        string $provider,
        ?string $model,
        string $errorCode,
        string $errorMessage,
        ?int $latencyMs = null,
    ): self {
        return new self(
            success: false,
            provider: $provider,
            model: $model,
            data: null,
            usage: null,
            latencyMs: $latencyMs,
            errorCode: $errorCode,
            errorMessage: $errorMessage,
        );
    }

    /**
     * @return array{
     *   success: bool,
     *   provider: string,
     *   model: string|null,
     *   data: array<string, mixed>|null,
     *   usage: array<string, mixed>|null,
     *   latency_ms: int|null,
     *   error: array{code: string|null, message: string|null}
     * }
     */
    public function toArray(): array
    {
        return [
            'success' => $this->success,
            'provider' => $this->provider,
            'model' => $this->model,
            'data' => $this->data,
            'usage' => $this->usage,
            'latency_ms' => $this->latencyMs,
            'error' => [
                'code' => $this->errorCode,
                'message' => $this->errorMessage,
            ],
        ];
    }
}
