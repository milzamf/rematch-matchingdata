<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $input = $request->validate([
            'email' => ['nullable', 'string'],
            'username' => ['nullable', 'string'],
            'password' => ['required', 'string'],
        ]);

        $login = trim((string) ($request->input('username') ?? $request->input('email') ?? ''));

        if ($login === '') {
            return response()->json([
                'success' => false,
                'message' => 'Username or email is required',
            ], 422);
        }

        $throttleKey = Str::transliterate(Str::lower($login).'|'.$request->ip());

        if (RateLimiter::tooManyAttempts($throttleKey, 5)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            return response()->json([
                'success' => false,
                'message' => "Too many login attempts. Please try again in {$seconds} seconds.",
            ], 429);
        }

        $user = User::where('username', $login)
            ->orWhere('email', $login)
            ->orWhere('email', $login.'@re-match.local')
            ->orWhere('name', $login)
            ->first();

        if (! $user || ! Auth::attempt(['email' => $user->email, 'password' => $input['password']])) {
            RateLimiter::hit($throttleKey, 60);

            return response()->json([
                'success' => false,
                'message' => 'Email or password is incorrect',
            ], 401);
        }

        RateLimiter::clear($throttleKey);
        $request->session()->regenerate();

        return response()->json([
            'success' => true,
            'data' => $this->userPayload($request->user()),
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->userPayload($request->user()),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'success' => true,
            'data' => [
                'message' => 'Logged out',
            ],
        ]);
    }

    /**
     * @return array{user: array{id: string|int, name: string, email: string, role: string}, permissions: list<string>}
     */
    private function userPayload(?User $user): array
    {
        abort_if(! $user, 401);

        return [
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'username' => $user->username,
                'email' => $user->email,
                'role' => $user->roleEnum()->value,
            ],
            'permissions' => $user->permissions(),
        ];
    }
}
