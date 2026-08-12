<?php

namespace App\Support\Auth;

enum UserRole: string
{
    case Admin = 'admin';
    case User = 'user';
    case Pimpinan = 'pimpinan';

    public static function values(): array
    {
        return array_map(
            static fn (self $role) => $role->value,
            self::cases(),
        );
    }
}
