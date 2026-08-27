import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

# 1. Initialize tracking variables at the start of executePipeline
code = re.sub(
    r'(private function executePipeline\([\s\S]*?\): array\s*\{)',
    r'''\1
        $totalWallClockStart = microtime(true);
        $metrics = [
            'INDEX_REUSED' => false,
            'index_initialization_ms' => 0.0,
            'multisearch_ms' => 0.0,
            'scoring_ms' => 0.0,
            'db_write_ms' => 0.0,
            'total_wall_clock_ms' => 0.0,
        ];
''', code)

# 2. Replace Indexing logic with Persistent + Atomic Lock
pattern_index = re.compile(r'\$httpClient = new \\GuzzleHttp\\Client.*?\$indexes = \[\'uid\' => \$indexUid, \'client\' => \$client\];', re.DOTALL)
replacement_index = """$indexInitStart = microtime(true);
        $httpClient = new \\GuzzleHttp\\Client(['timeout' => 15, 'connect_timeout' => 10]);
        $client = new \\Meilisearch\\Client(env('MEILISEARCH_HOST', 'http://127.0.0.1:7700'), env('MEILISEARCH_KEY', ''), $httpClient);
        $indexUid = 'matching_reference_' . str_replace('-', '_', $reference->id);
        
        $indexReused = false;
        $isIndexValid = false;
        try {
            $stats = $client->getIndex($indexUid)->stats();
            if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                $isIndexValid = true;
            }
        } catch (\\Throwable $e) {}
        
        if ($isIndexValid) {
            $indexReused = true;
        } else {
            $lockKey = 'build_index_' . $indexUid;
            $lock = \\Illuminate\\Support\\Facades\\Cache::lock($lockKey, 120);
            try {
                $lock->block(60); 
                try {
                    $stats = $client->getIndex($indexUid)->stats();
                    if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                        $indexReused = true;
                    }
                } catch (\\Throwable $e) {}
                
                if (!$indexReused) {
                    try {
                        $client->deleteIndex($indexUid);
                    } catch (\\Throwable $e) {}
                    
                    $searchableDocuments = [];
                    $searchableAttributes = [];
                    foreach ($mappings as $mapping) {
                        $colName = $mapping['reference_column_name'] ?? '';
                        if ($colName !== '') {
                            $searchableAttributes[] = 'col_' . md5($colName);
                        }
                    }
                    
                    foreach ($referenceRows as $refRecord) {
                        $doc = ['id' => $refRecord['key']];
                        foreach ($mappings as $mapping) {
                            $colName = $mapping['reference_column_name'] ?? '';
                            if ($colName !== '') {
                                $doc['col_' . md5($colName)] = $refRecord['normalized'][$colName] ?? '';
                            }
                        }
                        $searchableDocuments[] = $doc;
                    }

                    $index = $client->index($indexUid);
                    $task = $index->updateSearchableAttributes($searchableAttributes);
                    $client->waitForTask($task['taskUid']);
                    
                    if (count($searchableDocuments) > 0) {
                        foreach(array_chunk($searchableDocuments, 10000) as $chunkDocs) {
                            $task = $index->addDocuments($chunkDocs);
                            $client->waitForTask($task['taskUid']);
                        }
                    }
                }
            } finally {
                $lock?->release();
            }
        }
        $indexes = ['uid' => $indexUid, 'client' => $client];
        $metrics['INDEX_REUSED'] = $indexReused;
        $metrics['index_initialization_ms'] = (microtime(true) - $indexInitStart) * 1000;"""
code = pattern_index.sub(lambda _: replacement_index, code)

# 3. Track multisearch_ms
code = re.sub(
    r'(\$multiResults = \$indexes\[\'client\'\]->multiSearch\(\$queries\)\[\'results\'\] \?\? \[\];)',
    r'''$msStart = microtime(true);
                    \1
                    $metrics['multisearch_ms'] += (microtime(true) - $msStart) * 1000;''', code)

# 4. Track scoring_ms (Before multisearch try-catch until DB write)
code = re.sub(
    r'(try \{\s*\$multiResults = \$indexes\[\'client\'\]->multiSearch)',
    r'''$scoringStart = microtime(true);
                \1''', code)
code = re.sub(
    r'(DB::transaction\(function \(\) use \(\$batchResults, \$job, \$processed, \$chunk, \$summary\))',
    r'''$metrics['scoring_ms'] += (microtime(true) - $scoringStart) * 1000;
            $dbStart = microtime(true);
            \1''', code)

# 5. Track db_write_ms
code = re.sub(
    r'(\$job->update\(\[\s*\'processed_count\' => \$processed \+ count\(\$chunk\),\s*\'record_counts\' => \$summary,\s*\]\);\s*\}\);)',
    r'''\1
            $metrics['db_write_ms'] += (microtime(true) - $dbStart) * 1000;''', code)

# 6. Remove deleteIndex and add final log
pattern_delete_end = re.compile(r'if \(isset\(\$indexes\[\'client\'\]\) && isset\(\$indexes\[\'uid\'\]\)\) \{\s*try \{\s*\$indexes\[\'client\'\]->deleteIndex\(\$indexes\[\'uid\'\]\);\s*\} catch \(\\Throwable \$e\) \{\}\s*\}', re.DOTALL)
final_log = """$metrics['total_wall_clock_ms'] = (microtime(true) - $totalWallClockStart) * 1000;
        \\Illuminate\\Support\\Facades\\Log::info('MATCHING_METRICS', $metrics);"""
code = pattern_delete_end.sub(lambda _: final_log, code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("FULLY PATCHED PIPELINE")
