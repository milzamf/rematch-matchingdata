import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

# Replace the indexing block
pattern_index = re.compile(r'\$httpClient = new \\GuzzleHttp\\Client.*?\$indexes = \[\'uid\' => \$indexUid, \'client\' => \$client\];', re.DOTALL)

replacement_index = """$httpClient = new \\GuzzleHttp\\Client(['timeout' => 15, 'connect_timeout' => 10]);
        $client = new \\Meilisearch\\Client(env('MEILISEARCH_HOST', 'http://127.0.0.1:7700'), env('MEILISEARCH_KEY', ''), $httpClient);
        $indexUid = 'matching_reference_' . str_replace('-', '_', $reference->id);
        
        $indexReused = false;
        
        $isIndexValid = false;
        try {
            $stats = $client->getIndex($indexUid)->stats();
            if (isset($stats['numberOfDocuments']) && $stats['numberOfDocuments'] === count($referenceRows)) {
                $isIndexValid = true;
            }
        } catch (\\Throwable $e) {
            // Index doesn't exist
        }
        
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
        
        $indexes = ['uid' => $indexUid, 'client' => $client];"""

code = pattern_index.sub(lambda _: replacement_index, code)

# Remove deleteIndex at the end
pattern_delete_end = re.compile(r'if \(isset\(\$indexes\[\'client\'\]\) && isset\(\$indexes\[\'uid\'\]\)\) \{\s*try \{\s*\$indexes\[\'client\'\]->deleteIndex\(\$indexes\[\'uid\'\]\);\s*\} catch \(\\Throwable \$e\) \{\}\s*\}', re.DOTALL)
code = pattern_delete_end.sub('// Persistent index maintained', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED INDEXING LOGIC")
