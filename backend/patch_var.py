import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

# Replace missing variables and fix logic
code = re.sub(
    r'(foreach \(array_chunk\(\$inputRows, \$chunkSize\) as \$chunkIndex => \$chunk\) \{)',
    r'''\1
            $scoringStart = microtime(true);''', code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("FIXED UNDEFINED VARIABLE")
