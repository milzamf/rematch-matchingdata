<?php

namespace App\Services\Datasets;

use App\Exceptions\DatasetParsingException;

class SimpleZipReader
{
    /**
     * @return array<string, string>
     */
    private array $entries;

    public function __construct(private readonly string $path)
    {
        $this->entries = $this->readEntries();
    }

    public function get(string $name): ?string
    {
        return $this->entries[$name] ?? null;
    }

    /**
     * @return array<string, string>
     */
    private function readEntries(): array
    {
        $contents = file_get_contents($this->path);

        if ($contents === false) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $endOfCentralDirectory = strrpos($contents, "\x50\x4b\x05\x06");

        if ($endOfCentralDirectory === false) {
            throw new DatasetParsingException('The XLSX file is corrupted or cannot be opened.');
        }

        $entryCount = $this->uint16($contents, $endOfCentralDirectory + 10);
        $centralDirectoryOffset = $this->uint32($contents, $endOfCentralDirectory + 16);
        $entries = [];
        $offset = $centralDirectoryOffset;

        for ($i = 0; $i < $entryCount; $i++) {
            if (substr($contents, $offset, 4) !== "\x50\x4b\x01\x02") {
                throw new DatasetParsingException('The XLSX central directory could not be read.');
            }

            $method = $this->uint16($contents, $offset + 10);
            $compressedSize = $this->uint32($contents, $offset + 20);
            $uncompressedSize = $this->uint32($contents, $offset + 24);
            $fileNameLength = $this->uint16($contents, $offset + 28);
            $extraLength = $this->uint16($contents, $offset + 30);
            $commentLength = $this->uint16($contents, $offset + 32);
            $localHeaderOffset = $this->uint32($contents, $offset + 42);
            $name = substr($contents, $offset + 46, $fileNameLength);
            $entries[$name] = $this->readLocalEntry(
                $contents,
                $localHeaderOffset,
                $method,
                $compressedSize,
                $uncompressedSize,
            );
            $offset += 46 + $fileNameLength + $extraLength + $commentLength;
        }

        return $entries;
    }

    private function readLocalEntry(
        string $contents,
        int $offset,
        int $method,
        int $compressedSize,
        int $uncompressedSize,
    ): string {
        if (substr($contents, $offset, 4) !== "\x50\x4b\x03\x04") {
            throw new DatasetParsingException('The XLSX local file header could not be read.');
        }

        $fileNameLength = $this->uint16($contents, $offset + 26);
        $extraLength = $this->uint16($contents, $offset + 28);
        $dataOffset = $offset + 30 + $fileNameLength + $extraLength;
        $compressed = substr($contents, $dataOffset, $compressedSize);

        if ($method === 0) {
            return $compressed;
        }

        if ($method === 8) {
            $inflated = gzinflate($compressed);

            if ($inflated === false || strlen($inflated) !== $uncompressedSize) {
                throw new DatasetParsingException('The XLSX compressed data could not be read.');
            }

            return $inflated;
        }

        throw new DatasetParsingException('The XLSX compression method is not supported.');
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
