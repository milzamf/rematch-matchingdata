import re

with open('src/routes/matching.tsx', 'r') as f:
    code = f.read()

code = code.replace('          variant="destructive"\n', '')

with open('src/routes/matching.tsx', 'w') as f:
    f.write(code)
print("REMOVED VARIANT")
