<?php

namespace App\Providers;

use App\Services\AI\AiProviderInterface;
use App\Services\AI\AiProviderManager;
use App\Services\AI\Providers\OpenAiProvider;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(OpenAiProvider::class, function () {
            return new OpenAiProvider(config('ai.providers.openai', []));
        });

        $this->app->singleton(AiProviderManager::class, function ($app) {
            return new AiProviderManager(
                config('ai', []),
                $app->make(OpenAiProvider::class),
            );
        });

        $this->app->bind(AiProviderInterface::class, function ($app) {
            return $app->make(AiProviderManager::class)->provider();
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
