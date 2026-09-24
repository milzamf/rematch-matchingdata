<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;

class SimpleZipReader
{
    /**
     * @var resource|null
     */
    private $handle = null;

    /**
     * @var array<string, array{offset: int, method: int, comp_size: int, uncomp_size: int}>
     */
    private array $entries = [];

    public function __construct(private readonly string $path)
    {
        if (! file_exists($this->path) || ! is_readable($this->path)) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $handle = fopen($this->path, 'rb');
        if ($handle === false) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $this->handle = $handle;
        $this->readCentralDirectory();
    }

    public function __destruct()
    {
        $this->close();
    }

    public function close(): void
    {
        if (is_resource($this->handle)) {
            fclose($this->handle);
            $this->handle = null;
        }
    }

    /**
     * @return array<int, string>
     */
    public function getEntryNames(): array
    {
        return array_keys($this->entries);
    }

    public function has(string $name): bool
    {
        return isset($this->entries[$name]);
    }

    public function get(string $name): ?string
    {
        if (! isset($this->entries[$name]) || ! is_resource($this->handle)) {
            return null;
        }

        $entry = $this->entries[$name];
        fseek($this->handle, $entry['offset']);
        $localHeader = fread($this->handle, 30);

        if ($localHeader === false || strlen($localHeader) < 30 || substr($localHeader, 0, 4) !== "\x50\x4b\x03\x04") {
            throw new DatasetParsingException('The XLSX local file header could not be read.');
        }

        $fileNameLength = $this->uint16($localHeader, 26);
        $extraLength = $this->uint16($localHeader, 28);
        $dataOffset = $entry['offset'] + 30 + $fileNameLength + $extraLength;

        fseek($this->handle, $dataOffset);
        $compressed = fread($this->handle, $entry['comp_size']);

        if ($compressed === false || strlen($compressed) !== $entry['comp_size']) {
            throw new DatasetParsingException('The XLSX compressed data could not be read.');
        }

        if ($entry['method'] === 0) {
            return $compressed;
        }

        if ($entry['method'] === 8) {
            $inflated = @gzinflate($compressed);

            if ($inflated === false || strlen($inflated) !== $entry['uncomp_size']) {
                throw new DatasetParsingException('The XLSX compressed data could not be read.');
            }

            return $inflated;
        }

        throw new DatasetParsingException('The XLSX compression method is not supported.');
    }

    /**
     * Extract an entry directly to a destination file on disk with streaming decompression.
     */
    public function extractEntry(string $name, string $destinationPath): bool
    {
        if (! isset($this->entries[$name]) || ! is_resource($this->handle)) {
            return false;
        }

        $entry = $this->entries[$name];
        fseek($this->handle, $entry['offset']);
        $localHeader = fread($this->handle, 30);

        if ($localHeader === false || strlen($localHeader) < 30 || substr($localHeader, 0, 4) !== "\x50\x4b\x03\x04") {
            return false;
        }

        $fileNameLength = $this->uint16($localHeader, 26);
        $extraLength = $this->uint16($localHeader, 28);
        $dataOffset = $entry['offset'] + 30 + $fileNameLength + $extraLength;

        fseek($this->handle, $dataOffset);
        $out = fopen($destinationPath, 'wb');
        if ($out === false) {
            return false;
        }

        if ($entry['method'] === 0) {
            // Stored
            $remaining = $entry['comp_size'];
            while ($remaining > 0 && ! feof($this->handle)) {
                $chunkSize = min(65536, $remaining);
                $buf = fread($this->handle, $chunkSize);
                if ($buf === false) {
                    break;
                }
                fwrite($out, $buf);
                $remaining -= strlen($buf);
            }
            fclose($out);
            return $remaining === 0;
        }

        if ($entry['method'] === 8) {
            if (function_exists('inflate_init')) {
                $inflator = inflate_init(ZLIB_ENCODING_RAW);
                if ($inflator !== false) {
                    $remaining = $entry['comp_size'];
                    while ($remaining > 0 && ! feof($this->handle)) {
                        $chunkSize = min(65536, $remaining);
                        $buf = fread($this->handle, $chunkSize);
                        if ($buf === false) {
                            break;
                        }
                        $decompressed = inflate_add($inflator, $buf, $remaining <= $chunkSize ? ZLIB_FINISH : ZLIB_NO_FLUSH);
                        if ($decompressed !== false) {
                            fwrite($out, $decompressed);
                        }
                        $remaining -= strlen($buf);
                    }
                    fclose($out);
                    return true;
                }
            }

            // Fallback for gzinflate
            $compressed = fread($this->handle, $entry['comp_size']);
            $inflated = @gzinflate($compressed);
            if ($inflated !== false) {
                fwrite($out, $inflated);
                fclose($out);
                return true;
            }
            fclose($out);
            return false;
        }

        fclose($out);
        return false;
    }

    private function readCentralDirectory(): void
    {
        $fileSize = filesize($this->path);
        if ($fileSize === false || $fileSize < 22) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $readSize = min($fileSize, 65557);
        fseek($this->handle, $fileSize - $readSize);
        $tail = fread($this->handle, $readSize);

        if ($tail === false) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $eocdPos = strrpos($tail, "\x50\x4b\x05\x06");
        if ($eocdPos === false) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $entryCount = $this->uint16($tail, $eocdPos + 10);
        $centralDirSize = $this->uint32($tail, $eocdPos + 12);
        $centralDirOffset = $this->uint32($tail, $eocdPos + 16);

        fseek($this->handle, $centralDirOffset);
        $centralDirData = fread($this->handle, $centralDirSize);

        if ($centralDirData === false || strlen($centralDirData) !== $centralDirSize) {
            throw new DatasetParsingException('The XLSX central directory could not be read.');
        }

        $offset = 0;
        for ($i = 0; $i < $entryCount; $i++) {
            if (substr($centralDirData, $offset, 4) !== "\x50\x4b\x01\x02") {
                throw new DatasetParsingException('The XLSX central directory could not be read.');
            }

            $method = $this->uint16($centralDirData, $offset + 10);
            $compSize = $this->uint32($centralDirData, $offset + 20);
            $uncompSize = $this->uint32($centralDirData, $offset + 24);
            $nameLen = $this->uint16($centralDirData, $offset + 28);
            $extraLen = $this->uint16($centralDirData, $offset + 30);
            $commLen = $this->uint16($centralDirData, $offset + 32);
            $localOffset = $this->uint32($centralDirData, $offset + 42);
            $name = substr($centralDirData, $offset + 46, $nameLen);

            $this->entries[$name] = [
                'offset' => $localOffset,
                'method' => $method,
                'comp_size' => $compSize,
                'uncomp_size' => $uncompSize,
            ];

            $offset += 46 + $nameLen + $extraLen + $commLen;
        }
    }

    private function uint16(string $contents, int $offset): int
    {
        return unpack('v', substr($contents, $offset, 2))[1];
    }

    private function uint32(string $contents, int $offset): int
    {
        return unpack('V', substr($contents, $offset, 4))[1];
    }
}
