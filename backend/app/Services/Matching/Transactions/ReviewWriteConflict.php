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
        return response()->json(['success' => false, 'code' => $this->reason, 'details' => $this->details], $this->getStatusCode());
    }
}
