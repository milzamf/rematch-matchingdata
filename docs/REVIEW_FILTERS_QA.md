# Review groups and filters — verification (2026-10-12)

Verified against completed job `01a12b82-477a-7270-b8fe-566756f87f2f`: 133,524 input records and 306,346 reference records. Browser checks only opened views, changed filters, and read results; they did not save decisions or replace datasets.

## Live behavior

- `system_preset_5_address` (Beda Alamat) returns 1,462 members, 25 per page, with `include_groups=false&include_quality=false`. Page 2 also returns 25 members. An invalid group returns the dedicated 404 message.
- Backfill completed for all primary rows. Options report `ready=true`, 38 provinces and 504 regencies. Existing matching evidence and decisions were preserved.
- Both review views expose sort, input province/regency, similarity range, and reset. Choosing DKI Jakarta restricts the regency choices. In group details, Jakarta Barat with 85–90% yields 28 members; scores are descending and inside the range. Reset returns the original query.
- Group content search `RIAU` returns 98 members; it is not a search of row keys alone.
- Quality charts remain full-job cumulative and are not recomputed by table pagination or filter changes.

## Timing

Sequential browser HTTP measurements after migration/backfill, with warm caches:

| Request | HTTP time | Total records |
| --- | ---: | ---: |
| Beda Alamat detail | 986 ms | 1,462 |
| Similarity descending, all records | 975 ms | 133,524 |
| Similarity ascending, all records | 899 ms | 133,524 |
| Province 31, regency 3174, score >=80, descending | 901 ms | 173 |
| Beda Alamat, content search RIAU, descending | 985 ms | 98 |

Controlled service measurements exclude HTTP/bootstrap: cold group-cache rebuild 19,202 ms during backfill, 11,549 ms after backfill; warm detail 327/201 ms respectively. After backfill, descending/ascending service reads took 517/476 ms. Province 31 with descending sort took 890 ms. These are local observations, not a latency guarantee. Cold construction is still materially slower than warm pagination.

EXPLAIN confirmed:

- Group membership count/page uses `matching_results_job_input_rank_unique`, estimated 1,462 rows, indexed range access. Page ordering uses a filesort over the scalar projection.
- Similarity queries use `review_score_idx` for the primary score/key branch and the existing job/input/rank index for 48 reviewer overrides. The narrow union requires a filesort over about 133,779 estimated rows, without loading all candidate JSON into PHP.
- Province queries use `review_region_idx`, estimated 7,818 rows; the union contains about 3,913 estimated rows. Only paginated records hydrate candidate payloads.

Migration on the existing ~1.2M-result table took about five minutes; the one-time queued region backfill took about five minutes. Table access remains available while region preparation is pending.

## Automated checks

- Review regressions: 10 tests / 121 assertions passed (membership with summaries disabled, pagination/content search, status after unmatched/undo, invalid groups, cross-page score ordering, tied keys, selected reviewer candidate, score bounds, queued MFD backfill, combined filters, invalid province/regency pairing).
- Matching pipeline/row store: 8 tests / 55 assertions passed. Reference-cache regression: 1 test / 5 assertions passed after giving the fixture unique contents, because content-addressed caches survive repeated test runs.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Vite still prints its existing advisory about native tsconfig-path support; build succeeds.
- The database currently disallows null overall scores. Query ordering explicitly puts future null scores last; null field scores remain excluded from column diagnostics.
