<?php

namespace App\Services\AI\Providers;

use App\Services\AI\AiProviderInterface;
use App\Services\AI\AiResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Throwable;

class OpenAiProvider implements AiProviderInterface
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
        return $this->model() !== null && $this->apiKey() !== null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function generateStructured(array $payload): AiResponse
    {
        $startedAt = microtime(true);

        if (! $this->isConfigured()) {
            return AiResponse::failure(
                provider: 'openai',
                model: $this->model(),
                errorCode: 'provider_misconfigured',
                errorMessage: 'OpenAI provider configuration is incomplete.',
            );
        }

        try {
            $response = Http::baseUrl($this->baseUrl())
                ->timeout($this->timeout())
                ->acceptJson()
                ->withToken($this->apiKey())
                ->post('/responses', $this->buildRequestPayload($payload));
        } catch (ConnectionException $exception) {
            return AiResponse::failure(
                provider: 'openai',
                model: $this->model(),
                errorCode: 'network_error',
                errorMessage: $exception->getMessage(),
                latencyMs: $this->latencyMs($startedAt),
            );
        } catch (Throwable $exception) {
            return AiResponse::failure(
                provider: 'openai',
                model: $this->model(),
                errorCode: 'provider_exception',
                errorMessage: $exception->getMessage(),
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        if ($response->failed()) {
            $error = $response->json('error');

            return AiResponse::failure(
                provider: 'openai',
                model: $this->model(),
                errorCode: is_array($error) ? (string) ($error['code'] ?? 'provider_error') : 'provider_error',
                errorMessage: is_array($error)
                    ? (string) ($error['message'] ?? 'OpenAI request failed.')
                    : 'OpenAI request failed.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        $body = $response->json();

        if (! is_array($body)) {
            return AiResponse::failure(
                provider: 'openai',
                model: $this->model(),
                errorCode: 'invalid_response',
                errorMessage: 'OpenAI response is not a valid JSON object.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        $parsed = $this->extractStructuredData($body);

        if ($parsed === null) {
            return AiResponse::failure(
                provider: 'openai',
                model: (string) ($body['model'] ?? $this->model()),
                errorCode: 'invalid_response',
                errorMessage: 'OpenAI response did not contain valid structured JSON data.',
                latencyMs: $this->latencyMs($startedAt),
            );
        }

        return AiResponse::success(
            provider: 'openai',
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
        $temperature = Arr::get($payload, 'temperature', 0.1);

        return [
            'model' => $this->model(),
            'instructions' => is_string($instructions) ? $instructions : '',
            'input' => is_array($input) ? $input : [$input],
            'temperature' => is_numeric($temperature) ? (float) $temperature : 0.1,
            'text' => [
                'format' => [
                    'type' => 'json_schema',
                    'name' => (string) Arr::get($payload, 'schema_name', 'rematch_structured_output'),
                    'schema' => is_array($schema) ? $schema : [],
                    'strict' => true,
                ],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>|null
     */
    private function extractStructuredData(array $body): ?array
    {
        $output = $body['output'] ?? null;

        if (! is_array($output)) {
            return null;
        }

        foreach ($output as $item) {
            if (! is_array($item)) {
                continue;
            }

            foreach (($item['content'] ?? []) as $content) {
                if (! is_array($content)) {
                    continue;
                }

                if (($content['type'] ?? null) === 'output_text') {
                    $text = $content['text'] ?? null;

                    if (! is_string($text) || trim($text) === '') {
                        continue;
                    }

                    $decoded = json_decode($text, true);

                    if (is_array($decoded)) {
                        return $decoded;
                    }
                }
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

    private function baseUrl(): string
    {
        $baseUrl = $this->config['base_url'] ?? 'https://api.openai.com/v1';

        return is_string($baseUrl) && $baseUrl !== '' ? rtrim($baseUrl, '/') : 'https://api.openai.com/v1';
    }

    private function timeout(): int
    {
        $timeout = $this->config['timeout'] ?? 15;

        return is_numeric($timeout) ? max(1, (int) $timeout) : 15;
    }

    private function latencyMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
