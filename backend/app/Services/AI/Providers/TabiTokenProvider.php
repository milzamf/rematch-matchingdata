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
        $schema = Arr::get($payload, 'schema', []);

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

        $parsed = $this->extractStructuredData($body, is_array($schema) ? $schema : []);

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
        $schemaJson = json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return trim($instructions."\nReturn one JSON object only. No markdown fences. No commentary. Schema: ".$schemaJson);
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
    private function extractStructuredData(array $body, array $schema = []): ?array
    {
        $content = $body['content'] ?? null;

        if (! is_array($content)) {
            return null;
        }

        $textBlocks = [];

        foreach ($content as $item) {
            if (! is_array($item) || ($item['type'] ?? null) !== 'text') {
                continue;
            }

            $text = $item['text'] ?? null;

            if (! is_string($text) || trim($text) === '') {
                continue;
            }

            $textBlocks[] = $text;
            $decoded = $this->decodeStructuredPayload($text, $schema);

            if ($decoded !== null) {
                return $decoded;
            }
        }

        if ($textBlocks !== []) {
            return $this->decodeStructuredPayload(implode("\n", $textBlocks), $schema);
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeStructuredPayload(string $text, array $schema = []): ?array
    {
        $trimmed = trim($text);

        if ($trimmed === '') {
            return null;
        }

        $decoded = $this->decodeJsonObject($trimmed, $schema);

        if ($decoded !== null) {
            return $decoded;
        }

        if (preg_match('/```(?:json)?\s*(\{.*\})\s*```/is', $trimmed, $matches) === 1) {
            $decoded = $this->decodeJsonObject($matches[1], $schema);

            if ($decoded !== null) {
                return $decoded;
            }
        }

        $jsonObject = $this->extractFirstJsonObject($trimmed);

        if ($jsonObject === null) {
            return null;
        }

        return $this->decodeJsonObject($jsonObject, $schema);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJsonObject(string $json, array $schema = []): ?array
    {
        $decoded = json_decode(trim($json), true);

        if (! is_array($decoded)) {
            return null;
        }

        return $this->validateStructuredObject($decoded, $schema);
    }

    /**
     * @param  array<string, mixed>  $decoded
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>|null
     */
    private function validateStructuredObject(array $decoded, array $schema): ?array
    {
        $required = is_array($schema['required'] ?? null) ? $schema['required'] : [];
        $properties = is_array($schema['properties'] ?? null) ? $schema['properties'] : [];
        $normalized = [];

        foreach ($required as $field) {
            if (! is_string($field) || ! array_key_exists($field, $decoded)) {
                return null;
            }
        }

        foreach ($properties as $field => $definition) {
            if (! is_string($field) || ! is_array($definition) || ! array_key_exists($field, $decoded)) {
                continue;
            }

            $normalized[$field] = $this->normalizeFieldValue($decoded[$field], $definition);

            if ($normalized[$field] === null) {
                return null;
            }
        }

        foreach ($required as $field) {
            if (! is_string($field)) {
                continue;
            }

            if (! array_key_exists($field, $normalized)) {
                $definition = is_array($properties[$field] ?? null) ? $properties[$field] : null;

                if ($definition === null) {
                    $normalized[$field] = $decoded[$field];
                    continue;
                }

                $normalized[$field] = $this->normalizeFieldValue($decoded[$field], $definition);

                if ($normalized[$field] === null) {
                    return null;
                }
            }
        }

        foreach ($normalized as $field => $value) {
            $definition = is_array($properties[$field] ?? null) ? $properties[$field] : null;

            if ($definition === null) {
                continue;
            }

            if (! $this->passesEnumValidation($value, $definition)) {
                return null;
            }
        }

        return $normalized;
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function normalizeFieldValue(mixed $value, array $definition): mixed
    {
        $type = $definition['type'] ?? null;

        return match ($type) {
            'string' => $this->normalizeStringValue($value),
            'integer' => $this->normalizeIntegerValue($value, $definition),
            'array' => $this->normalizeArrayValue($value, $definition),
            default => $value,
        };
    }

    private function normalizeStringValue(mixed $value): ?string
    {
        if (! is_scalar($value)) {
            return null;
        }

        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function normalizeIntegerValue(mixed $value, array $definition): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $normalized = (int) round((float) $value);
        $minimum = is_numeric($definition['minimum'] ?? null) ? (int) $definition['minimum'] : null;
        $maximum = is_numeric($definition['maximum'] ?? null) ? (int) $definition['maximum'] : null;

        if (($minimum !== null && $normalized < $minimum) || ($maximum !== null && $normalized > $maximum)) {
            return null;
        }

        return $normalized;
    }

    /**
     * @param  array<string, mixed>  $definition
     * @return array<int, string>|null
     */
    private function normalizeArrayValue(mixed $value, array $definition): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        $itemType = $definition['items']['type'] ?? null;

        if ($itemType === 'string') {
            return $this->normalizeStringList($value);
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function passesEnumValidation(mixed $value, array $definition): bool
    {
        $enum = $definition['enum'] ?? null;

        if (! is_array($enum)) {
            return true;
        }

        return in_array($value, $enum, true);
    }

    private function extractFirstJsonObject(string $text): ?string
    {
        $start = strpos($text, '{');

        if ($start === false) {
            return null;
        }

        $depth = 0;
        $inString = false;
        $escaped = false;
        $length = strlen($text);

        for ($index = $start; $index < $length; $index++) {
            $character = $text[$index];

            if ($inString) {
                if ($escaped) {
                    $escaped = false;
                    continue;
                }

                if ($character === '\\') {
                    $escaped = true;
                    continue;
                }

                if ($character === '"') {
                    $inString = false;
                }

                continue;
            }

            if ($character === '"') {
                $inString = true;
                continue;
            }

            if ($character === '{') {
                $depth++;
                continue;
            }

            if ($character === '}') {
                $depth--;

                if ($depth === 0) {
                    return substr($text, $start, $index - $start + 1);
                }
            }
        }

        return null;
    }

    /**
     * @param  array<int, mixed>  $items
     * @return array<int, string>
     */
    private function normalizeStringList(array $items): array
    {
        return array_values(array_filter(array_map(function (mixed $item): ?string {
            if (! is_scalar($item)) {
                return null;
            }

            $value = trim((string) $item);

            return $value !== '' ? $value : null;
        }, $items)));
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
        $timeout = $this->config['timeout'] ?? 15;

        return is_numeric($timeout) ? max(1, (int) $timeout) : 15;
    }

    private function latencyMs(float $startedAt): int
    {
        return (int) round((microtime(true) - $startedAt) * 1000);
    }
}
