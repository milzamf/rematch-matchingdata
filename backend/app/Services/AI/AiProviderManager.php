<?php

namespace App\Services\AI;

use App\Services\AI\Providers\OpenAiProvider;
use App\Services\AI\Providers\TabiTokenProvider;

class AiProviderManager
{
    /**
     * @param  array<string, mixed>  $config
     */
    public function __construct(
        private readonly array $config,
        private readonly OpenAiProvider $openAiProvider,
        private readonly ?TabiTokenProvider $tabiTokenProvider = null,
    ) {
    }

    public function isEnabled(): bool
    {
        return (bool) ($this->config['enabled'] ?? false);
    }

    public function configuredProvider(): ?string
    {
        $provider = $this->config['provider'] ?? null;

        return is_string($provider) && $provider !== '' ? $provider : null;
    }

    public function isConfigured(): bool
    {
        if (! $this->isEnabled()) {
            return false;
        }

        return $this->resolveProvider() !== null;
    }

    public function provider(): AiProviderInterface
    {
        return $this->resolveProvider() ?? new NullAiProvider(
            $this->configuredProvider() ?? 'none',
            $this->resolveFailure(),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function generateStructured(array $payload): AiResponse
    {
        return $this->provider()->generateStructured($payload);
    }

    private function resolveProvider(): ?AiProviderInterface
    {
        if (! $this->isEnabled()) {
            return null;
        }

        return match ($this->configuredProvider()) {
            'openai' => $this->openAiProvider->isConfigured() ? $this->openAiProvider : null,
            'tabitoken' => $this->resolveTabiTokenProvider(),
            default => null,
        };
    }

    /**
     * @return array{code: string, message: string}
     */
    private function resolveFailure(): array
    {
        if (! $this->isEnabled()) {
            return [
                'code' => 'ai_disabled',
                'message' => 'AI provider is disabled.',
            ];
        }

        $provider = $this->configuredProvider();

        if (! is_string($provider) || $provider === '') {
            return [
                'code' => 'provider_not_configured',
                'message' => 'AI provider is not configured.',
            ];
        }

        if (! in_array($provider, ['openai', 'tabitoken'], true)) {
            return [
                'code' => 'unsupported_provider',
                'message' => sprintf('Unsupported AI provider [%s].', $provider),
            ];
        }

        return [
            'code' => 'provider_misconfigured',
            'message' => 'AI provider configuration is incomplete.',
        ];
    }

    private function resolveTabiTokenProvider(): ?AiProviderInterface
    {
        $provider = $this->tabiTokenProvider ?? new TabiTokenProvider(
            $this->config['providers']['tabitoken'] ?? [],
        );

        return $provider->isConfigured() ? $provider : null;
    }
}
