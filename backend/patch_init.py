import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

code = code.replace('public array $metrics = [];', "public array $metrics = ['jaro_calls' => 0, 'jaro_time' => 0.0, 'lev_calls' => 0, 'lev_time' => 0.0, 'cand_time' => 0.0];")

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED INITIALIZATION")
