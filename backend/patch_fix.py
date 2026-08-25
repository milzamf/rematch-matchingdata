import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

bad = "($mapping['weight'] ?? null) = round((($mapping['weight'] ?? null) / $totalWeight) * 100, 2);"
good = "$mapping['weight'] = round((($mapping['weight'] ?? 1) / $totalWeight) * 100, 2);"
code = code.replace(bad, good)

# also check for $configuration['runOptions']['chunkSize'] or similar
code = code.replace("($configuration['runOptions'] ?? null)['chunkSize']", "($configuration['runOptions']['chunkSize'] ?? 500)")
code = code.replace("($configuration['runOptions'] ?? null)['workerCount']", "($configuration['runOptions']['workerCount'] ?? 1)")

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED ASSIGNMENT")
