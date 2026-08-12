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
        $password = env('BATCHMATCH_DEV_PASSWORD');
        $role = UserRole::tryFrom((string) env('BATCHMATCH_DEV_ROLE', UserRole::User->value))
            ?? UserRole::User;

        if (! is_string($password) || $password === '') {
            return;
        }

        User::updateOrCreate(
            ['email' => 'dev@re-match.local'],
            [
                'name' => 'RE-MATCH Developer',
                'role' => $role->value,
                'password' => $password,
            ],
        );
    }
}
