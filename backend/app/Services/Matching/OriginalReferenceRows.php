<?php

namespace App\Services\Matching;

use App\Models\Dataset;
use App\Services\Datasets\CsvDatasetParser;
use App\Services\Datasets\XlsxDatasetParser;
use Illuminate\Support\Facades\Storage;

/** Bounded-memory reconstruction for historical results which stored only mapped columns. */
final class OriginalReferenceRows
{
    private string $path;
    private ?\PDO $db = null;

    public function __construct(Dataset $dataset)
    {
        $source = null;
        foreach ([Storage::disk('local')->path($dataset->storage_path), storage_path('app/'.$dataset->storage_path), storage_path('app/private/'.$dataset->storage_path)] as $path) {
            if (is_file($path) && is_readable($path)) { $source = $path; break; }
        }
        if (! $source || ($dataset->file_size && filesize($source) !== (int) $dataset->file_size)) throw new \RuntimeException('File acuan asli tidak tersedia atau ukurannya berubah. Ekspor tidak membuat nilai pengganti.');
        $this->path = tempnam(sys_get_temp_dir(), 'rematch-source-');
        $this->db = new \PDO('sqlite:'.$this->path, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
        $this->db->exec('PRAGMA cache_size=-2048; PRAGMA journal_mode=OFF; CREATE TABLE rows (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
        $format = strtolower($dataset->file_format);
        if (! in_array($format, ['csv', 'xlsx'], true)) throw new \RuntimeException('Format sumber acuan tidak dapat direkonstruksi.');
        $parser = $format === 'csv' ? new CsvDatasetParser : new XlsxDatasetParser;
        $insert = $this->db->prepare('INSERT INTO rows VALUES (?, ?)');
        $index = 0;
        foreach ($parser->streamRows($source, ['delimiter' => $dataset->delimiter, 'sheet_name' => $dataset->selected_sheet, 'header_row' => $dataset->header_row ?? 1]) as $row) {
            $insert->execute([(string) ++$index, json_encode($row, JSON_THROW_ON_ERROR)]);
        }
        if ($index !== (int) $dataset->row_count) throw new \RuntimeException('Jumlah baris sumber acuan berubah; ekspor dibatalkan.');
    }

    public function get(string $key, array $snapshot): array
    {
        $query = $this->db->prepare('SELECT payload FROM rows WHERE id = ?');
        $query->execute([$key]);
        $payload = $query->fetchColumn();
        if ($payload === false) throw new \RuntimeException('Key acuan tidak ditemukan pada file sumber.');
        $row = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
        foreach ($snapshot as $column => $value) {
            if (str_starts_with($column, '[Generated]')) continue;
            if (array_key_exists($column, $row) && (string) $row[$column] !== (string) $value) throw new \RuntimeException('File sumber tidak sesuai snapshot matching; ekspor dibatalkan.');
        }
        return $row;
    }

    public function __destruct()
    {
        $this->db = null;
        if (isset($this->path) && is_file($this->path)) unlink($this->path);
    }
}
