import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

ms_timeout_old = """$httpClient = new \GuzzleHttp\Client(['timeout' => 300, 'connect_timeout' => 10]);"""
ms_timeout_new = """$httpClient = new \GuzzleHttp\Client(['timeout' => 15, 'connect_timeout' => 10]);"""
code = code.replace(ms_timeout_old, ms_timeout_new)

ms_catch_old = """} catch (\Exception $e) {
                    \Illuminate\Support\Facades\Log::error('Meilisearch MultiSearch Error: ' . $e->getMessage());
                }"""
ms_catch_new = """} catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::error('Meilisearch MultiSearch Error: ' . $e->getMessage());
                }"""
code = code.replace(ms_catch_old, ms_catch_new)

del_catch_old = """} catch (\Exception $e) {}"""
del_catch_new = """} catch (\Throwable $e) {}"""
code = code.replace(del_catch_old, del_catch_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED MEILISEARCH TIMEOUT & THROWABLE")
