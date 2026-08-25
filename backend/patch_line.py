lines = []
with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    lines = f.readlines()

lines[1193] = """                'field' => ($mapping['input_column_name'] ?? null) . " <-> " . ($mapping['reference_column_name'] ?? null),\n"""

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.writelines(lines)
