<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Support\Auth\PermissionRegistry;
use App\Support\Auth\UserRole;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'role', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function roleEnum(): UserRole
    {
        return UserRole::tryFrom((string) $this->role) ?? UserRole::User;
    }

    /**
     * @return list<string>
     */
    public function permissions(): array
    {
        return PermissionRegistry::forRole($this->roleEnum());
    }

    public function hasPermission(string $permission): bool
    {
        return in_array($permission, $this->permissions(), true);
    }

    public function workspaces(): HasMany
    {
        return $this->hasMany(Workspace::class);
    }

    public function ownedDatasetQuery(): Builder
    {
        return Dataset::query()->where(function (Builder $query) {
            $query
                ->whereIn('id', $this->workspaces()->select('reference_dataset_id')->whereNotNull('reference_dataset_id'))
                ->orWhereIn('id', $this->workspaces()->select('input_dataset_id')->whereNotNull('input_dataset_id'));
        });
    }

    public function ownedMatchingJobQuery(): Builder
    {
        return MatchingJob::query()
            ->whereIn('id', $this->workspaces()->select('matching_job_id')->whereNotNull('matching_job_id'));
    }
}
