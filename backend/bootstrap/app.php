<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Opaque record/idempotency identities must reach the isolated service unchanged.
        $middleware->trimStrings(except: [fn (Request $request) => $request->is('api/stage5a/*')]);
        $middleware->statefulApi();
        $middleware->append(\App\Http\Middleware\ReviewDeploymentFence::class);
        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/login');
        $middleware->alias([
            'permission' => \App\Http\Middleware\EnsurePermission::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
