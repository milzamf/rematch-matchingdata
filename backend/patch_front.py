import re

with open('../src/routes/matching.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix setProgress(Math.max(10, Math.min(95, pct)));
code = re.sub(
    r'setProgress\(Math\.max\(10, Math\.min\(95, pct\)\)\);',
    r'setProgress(pct);', code)

# Fix setProgress(Math.max(10, result.progress.percentage || 10));
code = re.sub(
    r'setProgress\(Math\.max\(10, result\.progress\.percentage \|\| 10\)\);',
    r'setProgress(result.progress.percentage || 0);', code)

with open('../src/routes/matching.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
print("PATCHED UI PROGRESS BAR")
