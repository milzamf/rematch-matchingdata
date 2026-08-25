import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

chunk_old = "$chunkSize = ($configuration['runOptions']['chunkSize'] ?? 500);"
chunk_new = "$chunkSize = max(500, (int) ($configuration['runOptions']['chunkSize'] ?? 500));"
code = code.replace(chunk_old, chunk_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED CHUNK SIZE")
