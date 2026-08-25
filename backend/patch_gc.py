import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

gc_old = """            $processed += count($chunk);
            unset($batchResults, $searchQueriesToExecute, $recordsToEvaluate, $searchResultsByIndex, $chunk);
        }"""

gc_new = """            $processed += count($chunk);
            unset($batchResults, $searchQueriesToExecute, $recordsToEvaluate, $searchResultsByIndex, $chunk);
            gc_collect_cycles();
        }"""

code = code.replace(gc_old, gc_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED GC")
