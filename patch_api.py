import re

with open('src/lib/api.ts', 'r') as f:
    code = f.read()

fetch_old = """  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });"""

fetch_new = """  return fetch(buildApiUrl(path), {
    signal: init.signal ?? (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined),
    ...init,
    headers,
    credentials: "include",
  });"""

code = code.replace(fetch_old, fetch_new)

with open('src/lib/api.ts', 'w') as f:
    f.write(code)
print("PATCHED API TIMEOUT")
