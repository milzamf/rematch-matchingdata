<?php

namespace App\Services\AI\Providers;

use App\Services\AI\AiProviderInterface;
use App\Services\AI\AiResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Throwable;

class TabiTokenProvider implements AiProviderInterface
{
    /**
     * @param  array<string, mixed>  $config
     */
    public function __construct(
        private readonly array $config,
    ) {
    }

    public function isConfigured(): bool
    {
        return $this->model() !== null && $this->apiKey() !== null && $this->baseUrl() !== null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function generateStructured(array $payload): AiResponse
    {
        $startedAt = microtime(true);

        if (! $this->isConfigured()) {
            return AiResponse::failure(
                provider: 'tabitoken',
                model: $this->model(),
                errorCode: 'provider_misconfigured',
                errorMessage: 'TabiToken provider configuration is incomplete.',
            );
        }

        try {
            $response = Http::baseUrl($this->baseUrl())
                ->timeout($this->timeout())
                ->acceptJson()
                ->withHeaders([
                    'x-api-key' => $this->apiKey(),
                    'anthropic-version' => '2023-06-01',
                    'Content-Type' => 'application/json',
                ])
                ->post('/messages', $this->buildRequestPayload($payload));
        } catch (ConnectionException $exception) {
            return AiResponse::failure(
                provider: 'tabitoken',
                model: $this->model(),
                errorCode: 'network_error',
                errorMessage: $exception->getMessage(),
                latencyMs: $this->latencyMs($startedAt),
            );
        } catch (Throwable $exception) {
            return AiResponse::failure(
                provider: 'tabitoken',
                model: $this->model(),
                errorCode: 'provider_exception',
                errorMessage: $exception->getMessage(),
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        if ($response->failed()) {
            $error = $response->json('error');

            return AiResponse::failure(
                provider: 'tabitoken',
                model: $this->model(),
                errorCode: is_array($error) ? (string) ($error['type'] ?? $error['code'] ?? 'provider_error') : 'provider_error',
                errorMessage: is_array($error)
                    ? (string) ($error['message'] ?? 'TabiToken request failed.')
                    : 'TabiToken request failed.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        $body = $response->json();

        if (! is_array($body)) {
            return AiResponse::failure(
                provider: 'tabitoken',
                model: $this->model(),
                errorCode: 'invalid_response',
                errorMessage: 'TabiToken response is not a valid JSON object.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        $parsed = $this->extractStructuredData($body);

        if ($parsed === null) {
            return AiResponse::failure(
                provider: 'tabitoken',
                model: (string) ($body['model'] ?? $this->model()),
                errorCode: 'invalid_response',
                errorMessage: 'TabiToken response did not contain valid structured JSON data.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        return AiResponse::success(
            provider: 'tabitoken',
            model: (string) ($body['model'] ?? $this->model()),
            data: $parsed,
            usage: is_array($body['usage'] ?? null) ? $body['usage'] : null,
            latencyMs: $this->latencyMs($startedAt),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function buildRequestPayload(array $payload): array
    {
        $instructions = Arr::get($payload, 'instructions', '');
        $input = Arr::get($payload, 'input', []);
        $schema = Arr::get($payload, 'schema', []);
        $maxTokens = Arr::get($payload, 'max_tokens', 2048);

        return [
            'model' => $this->model(),
            'system' => $this->buildSystemPrompt(
                is_string($instructions) ? $instructions : '',
                is_array($schema) ? $schema : [],
            ),
            'messages' => $this->normalizeMessages($input),
            'max_tokens' => is_numeric($maxTokens) ? max(1, (int) $maxTokens) : 2048,
        ];
    }

    /**
     * @param  array<string, mixed>  $schema
     */
    private function buildSystemPrompt(string $instructions, array $schema): string
    {
        $schemaJson = json_encode($schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return trim($instructions."\n\nReturn only valid JSON matching this schema exactly:\n".$schemaJson);
    }

    /**
     * @param  mixed  $input
     * @return array<int, array<string, mixed>>
     */
    private function normalizeMessages(mixed $input): array
    {
        if (! is_array($input)) {
            return [[
                'role' => 'user',
                'content' => [['type' => 'text', 'text' => (string) $input]],
            ]];
        }

        $messages = [];

        foreach ($input as $entry) {
            if (is_array($entry) && isset($entry['role'], $entry['content'])) {
                $messages[] = [
                    'role' => (string) $entry['role'],
                    'content' => is_array($entry['content']) ? $entry['content'] : [['type' => 'text', 'text' => (string) $entry['content']]],
                ];
                continue;
            }

            if (is_array($entry) && ($entry['type'] ?? null) === 'input_text') {
                $messages[] = [
                    'role' => 'user',
                    'content' => [[
                        'type' => 'text',
                        'text' => (string) ($entry['text'] ?? ''),
                    ]],
                ];
            }
        }

        return $messages !== [] ? $messages : [[
            'role' => 'user',
            'content' => [['type' => 'text', 'text' => '']],
        ]];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>|null
     */
    private function extractStructuredData(array $body): ?array
    {
        $content = $body['content'] ?? null;

        if (! is_array($content)) {
            return null;
        }

        foreach ($content as $item) {
            if (! is_array($item) || ($item['type'] ?? null) !== 'text') {
                continue;
            }

            $text = $item['text'] ?? null;

            if (! is_string($text) || trim($text) === '') {
                continue;
            }

            $decoded = json_decode($text, true);

            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return null;
    }

    private function apiKey(): ?string
    {
        $apiKey = $this->config['api_key'] ?? null;

        return is_string($apiKey) && $apiKey !== '' ? $apiKey : null;
    }

    private function model(): ?string
    {
        $model = $this->config['model'] ?? null;

        return is_string($model) && $model !== '' ? $model : null;
    }

    private function baseUrl(): ?string
    {
        $baseUrl = $this->config['base_url'] ?? null;

        return is_string($baseUrl) && $baseUrl !== '' ? rtrim($baseUrl, '/') : null;
    }

    private function timeout(): int
    {
        $timeout = $this->config['timeout'] ?? 30;

        return is_numeric($timeout) ? max(1, (int) $timeout) : 30;
    }

    private function latencyMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
