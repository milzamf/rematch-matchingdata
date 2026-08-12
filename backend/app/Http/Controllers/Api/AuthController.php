<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials)) {
            return response()->json([
                'success' => false,
                'message' => 'Email or password is incorrect',
            ], 401);
        }

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
                'email' => $user->email,
                'role' => $user->roleEnum()->value,
            ],
            'permissions' => $user->permissions(),
        ];
    }
}
