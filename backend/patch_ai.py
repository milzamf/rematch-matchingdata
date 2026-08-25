import re

for file in ['app/Services/AI/Providers/OpenAiProvider.php', 'app/Services/AI/Providers/TabiTokenProvider.php']:
    with open(file, 'r') as f:
        code = f.read()
    
    code = code.replace("?? 30;", "?? 15;")
    code = code.replace("30;", "15;")
    
    with open(file, 'w') as f:
        f.write(code)
print("PATCHED AI TIMEOUTS")
