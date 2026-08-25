import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

ms_old = """$client = new \Meilisearch\Client(env('MEILISEARCH_HOST', 'http://127.0.0.1:7700'), env('MEILISEARCH_KEY', ''));"""
ms_new = """$httpClient = new \GuzzleHttp\Client(['timeout' => 300, 'connect_timeout' => 10]);
        $client = new \Meilisearch\Client(env('MEILISEARCH_HOST', 'http://127.0.0.1:7700'), env('MEILISEARCH_KEY', ''), $httpClient);"""

code = code.replace(ms_old, ms_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MEILISEARCH TIMEOUT")
