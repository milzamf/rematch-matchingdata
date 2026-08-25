import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

del_old = """        try {
            $client->deleteIndex($indexUid);
        } catch (\Throwable $e) {
            // ignore if not exists
        }"""
del_new = """        try {
            $task = $client->deleteIndex($indexUid);
            $client->waitForTask($task['taskUid']);
        } catch (\Throwable $e) {
            // ignore if not exists
        }"""
code = code.replace(del_old, del_new)

if 'catch (\Exception' in code:
    code = code.replace('catch (\Exception $e) {', 'catch (\Throwable $e) {')

add_old = """        $index = $client->index($indexUid);
        $task = $index->addDocuments($searchableDocuments);
        $client->waitForTask($task['taskUid']);
        
        $index->updateSearchableAttributes($searchableAttributes);"""
add_new = """        $index = $client->index($indexUid);
        $task = $index->updateSearchableAttributes($searchableAttributes);
        $client->waitForTask($task['taskUid']);
        
        $task = $index->addDocuments($searchableDocuments);
        $client->waitForTask($task['taskUid']);"""
code = code.replace(add_old, add_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED INDEXING PROTOCOL")
