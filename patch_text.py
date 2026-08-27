import re

with open('src/routes/matching.tsx', 'r') as f:
    code = f.read()

old_text = "Meilisearch Engine: Generating Candidates (MultiSearch Batch Mode)"
new_text = "Engine: Meilisearch MultiSearch Active (Batch Mode)"

code = code.replace(old_text, new_text)

with open('src/routes/matching.tsx', 'w') as f:
    f.write(code)
print("PATCHED TEXT")
