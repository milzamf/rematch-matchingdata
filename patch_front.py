import re

with open('src/routes/matching.tsx', 'r') as f:
    code = f.read()

# carefully replace some .map and .find with ?.map and ?.find if they are preceded by object properties
code = re.sub(r"(\w+)\.map\(", r"\1?.map(", code)
code = re.sub(r"(\w+)\.find\(", r"\1?.find(", code)
code = re.sub(r"(\w+)\.filter\(", r"\1?.filter(", code)

# fix some that might be wrong like WizardSteps?.map if it's a constant
code = code.replace("wizardSteps?.map", "wizardSteps.map")
code = code.replace("Object?.keys", "Object.keys")
code = code.replace("Object?.values", "Object.values")
code = code.replace("Object?.entries", "Object.entries")

with open('src/routes/matching.tsx', 'w') as f:
    f.write(code)
print("PATCHED FRONTEND OPTIONAL CHAINING")
