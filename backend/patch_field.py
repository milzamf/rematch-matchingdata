import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

bad = """'field' => "{($mapping['input_column_name'] ?? null)} ? {($mapping['reference_column_name'] ?? null)}","""
good = """'field' => ($mapping['input_column_name'] ?? null) . " ? " . ($mapping['reference_column_name'] ?? null),"""
code = code.replace(bad, good)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED FIELD")
