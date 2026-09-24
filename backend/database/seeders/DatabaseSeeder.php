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
            $this->upsertUser('dev', 'dev@re-match.local', 'RE-MATCH Developer', $legacyRole, $legacyPassword);
        }

        $accounts = [
            [
                'username' => 'admin',
                'email' => 'admin@re-match.local',
                'name' => 'Administrator',
                'role' => UserRole::Admin,
                'password' => (string) (env('BATCHMATCH_DEV_ADMIN_PASSWORD') ?: '321'),
            ],
            [
                'username' => 'pimpinan',
                'email' => 'pimpinan@re-match.local',
                'name' => 'Pimpinan',
                'role' => UserRole::Pimpinan,
                'password' => (string) (env('BATCHMATCH_DEV_PIMPINAN_PASSWORD') ?: '321'),
            ],
            [
                'username' => 'user',
                'email' => 'user@re-match.local',
                'name' => 'Operator User',
                'role' => UserRole::User,
                'password' => (string) (env('BATCHMATCH_DEV_USER_PASSWORD') ?: '321'),
            ],
        ];

        foreach ($accounts as $account) {
            if (! is_string($account['password']) || $account['password'] === '') {
                continue;
            }

            $this->upsertUser(
                $account['username'],
                $account['email'],
                $account['name'],
                $account['role'],
                $account['password'],
            );
        }
    }

    private function upsertUser(string $username, string $email, string $name, UserRole $role, string $password): void
    {
        User::updateOrCreate(
            ['username' => $username],
            [
                'email' => $email,
                'name' => $name,
                'role' => $role->value,
                'password' => $password,
            ],
        );
    }
}
