import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

# Replace $mapping['xyz'] with $mapping['xyz'] ?? null
mapping_keys = ['reference_column_name', 'input_column_name', 'algorithm', 'weight', 'required_match', 'transform', 'parent_input_column', 'parent_reference_column']
for k in mapping_keys:
    code = re.sub(r"\$mapping\['" + k + r"'\](?!\s*\?\?)", f"($mapping['{k}'] ?? null)", code)

# Configuration keys
conf_keys = ['preset', 'strategy', 'thresholds', 'normalization', 'searchOptimization', 'candidateGeneration', 'output', 'weighting', 'rules', 'runOptions']
for k in conf_keys:
    code = re.sub(r"\$configuration\['" + k + r"'\](?!\s*\?\?)", f"($configuration['{k}'] ?? null)", code)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED ENGINE ARRAY ACCESS")
