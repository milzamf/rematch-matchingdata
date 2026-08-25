import re

with open('app/Services/Matching/MatchingEngineService.php', 'r') as f:
    code = f.read()

loop_end_old = """            });

            $processed += count($chunk);
        }

        if (isset($indexes['client']) && isset($indexes['uid'])) {"""

loop_end_new = """            });

            $processed += count($chunk);
            unset($batchResults, $searchQueriesToExecute, $recordsToEvaluate, $searchResultsByIndex, $chunk);
        }

        if (isset($indexes['client']) && isset($indexes['uid'])) {"""

code = code.replace(loop_end_old, loop_end_new)

with open('app/Services/Matching/MatchingEngineService.php', 'w') as f:
    f.write(code)
print("PATCHED ENGINE UNSETS")
