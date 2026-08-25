import re

with open('routes/console.php', 'r') as f:
    code = f.read()

cmd = "Schedule::command('app:clean-temp-datasets')->daily();"
new_cmd = """Schedule::command('app:clean-temp-datasets')->daily();
Schedule::command('queue:prune-failed', ['--hours=168'])->daily();"""

code = code.replace(cmd, new_cmd)

with open('routes/console.php', 'w') as f:
    f.write(code)
print("PATCHED CONSOLE ROUTES")
