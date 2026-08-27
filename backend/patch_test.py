import re

with open('tests/Feature/MatchingEngineTest.php', 'r') as f:
    code = f.read()

code = re.sub(
    r'(\$this->postJson\(\'/api/matching-jobs/\' \. \$job->id \. \'/run\'\)->assertStatus\(200\);)',
    r'''\1
        $job->update(['status' => 'pending']);
        \1''', code)

with open('tests/Feature/MatchingEngineTest.php', 'w') as f:
    f.write(code)
print("PATCHED TEST")
