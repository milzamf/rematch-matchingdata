<?php

namespace App\Services\Matching\Transactions;

use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;

final class ReviewWriteConflict extends HttpException
{
    public function __construct(public readonly string $reason, public readonly array $details = [], int $status = 409)
    {
        parent::__construct($status, $reason);
    }

    public function render(): JsonResponse
    {
        $message = match ($this->reason) {
            'legacy_workspace_write_disabled' => 'Penyimpanan atau perubahan workspace melalui jalur lama masih dibatasi saat Workspace Sharing aktif. Data belum disimpan.',
            'draft_workspace_only' => 'Workspace ini sudah memiliki proses atau hasil matching. Perubahan draft tidak diizinkan agar hasil dan histori tetap aman.',
            'draft_payload_not_allowed' => 'Penyimpanan draft hanya menerima persiapan data dan konfigurasi, bukan hasil matching atau review.',
            'invalid_workspace_version', 'stale_workspace_version' => 'Versi workspace sudah berubah atau belum tersedia. Muat ulang workspace sebelum menyimpan kembali.',
            'legacy_review_write_disabled' => 'Keputusan review harus disimpan melalui layanan review terbaru. Muat ulang workspace.',
            'review_deployment_frozen', 'review_deployment_busy' => 'Layanan sedang dalam pemeliharaan. Coba kembali setelah pemeliharaan selesai.',
            default => null,
        };
        return response()->json(array_filter([
            'success' => false, 'code' => $this->reason, 'details' => $this->details, 'message' => $message,
        ], static fn ($value) => $value !== null), $this->getStatusCode());
    }
}
