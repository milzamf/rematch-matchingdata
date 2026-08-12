<?php

namespace Database\Seeders;

use App\Models\User;
use App\Support\Auth\UserRole;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $legacyPassword = env('BATCHMATCH_DEV_PASSWORD');
        $legacyRole = UserRole::tryFrom((string) env('BATCHMATCH_DEV_ROLE', UserRole::User->value))
            ?? UserRole::User;

        if (is_string($legacyPassword) && $legacyPassword !== '') {
            $this->upsertUser('dev@re-match.local', 'RE-MATCH Developer', $legacyRole, $legacyPassword);
        }

        $accounts = [
            [
                'email' => 'user@re-match.local',
                'name' => 'RE-MATCH User',
                'role' => UserRole::User,
                'password' => env('BATCHMATCH_DEV_USER_PASSWORD'),
            ],
            [
                'email' => 'admin@re-match.local',
                'name' => 'RE-MATCH Admin',
                'role' => UserRole::Admin,
                'password' => env('BATCHMATCH_DEV_ADMIN_PASSWORD'),
            ],
            [
                'email' => 'pimpinan@re-match.local',
                'name' => 'RE-MATCH Pimpinan',
                'role' => UserRole::Pimpinan,
                'password' => env('BATCHMATCH_DEV_PIMPINAN_PASSWORD'),
            ],
        ];

        foreach ($accounts as $account) {
            if (! is_string($account['password']) || $account['password'] === '') {
                continue;
            }

            $this->upsertUser(
                $account['email'],
                $account['name'],
                $account['role'],
                $account['password'],
            );
        }
    }

    private function upsertUser(string $email, string $name, UserRole $role, string $password): void
    {
        User::updateOrCreate(
            ['email' => $email],
            [
                'name' => $name,
                'role' => $role->value,
                'password' => $password,
            ],
        );
    }
}
