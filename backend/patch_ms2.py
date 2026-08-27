import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

code = re.sub(
    r'(\$multiResults = \$indexes\[\'client\'\]->multiSearch\(\$queries\)\[\'results\'\] \?\? \[\];)',
    r'''\\Log::info("MULTISEARCH_START");
                    $msStart = microtime(true);
                    \1
                    \\Log::info("MULTISEARCH_END");
                    \\Log::info("MULTISEARCH_DURATION_MS", ['duration' => (microtime(true) - $msStart) * 1000, 'query_count' => count($queries)]);
''', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MULTISEARCH")
