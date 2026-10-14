# Matching memory and storage verification — 2026-10-12

Changes preserve scoring, candidate limits, source rows, and manual decisions. The first memory-efficiency milestone did not delete historical results. The subsequent user-authorized cleanup is tracked separately below.

## Read-only real-data sample

Run `docker compose exec -T backend php scripts/benchmark_matching_payloads.php` to sample 1,000 existing results, encode/decode losslessly, and assert exact equality. Actual measurement before deployment:

| Measurement | Before | After |
|---|---:|---:|
| Checkpoint payload | 3,589,861 bytes | 591,912 bytes |
| Metadata and evidence | 1,688,370 bytes | 1,456,320 bytes |
| Evidence alone | 760,897 bytes | 548,074 bytes |

Checkpoint encoding took 30.71 ms and decoding 32.68 ms; evidence encoding plus integrity checks took 50.29 ms. Sample-process PHP peak was 26.4 MiB. This is not a full matching-job peak RAM measurement. Payload bytes do not directly predict InnoDB allocated-page size.

## Runtime and regression verification

- 30 relevant backend tests / 234 assertions passed, covering pipeline, guardrails, checkpoint restore, review decisions/undo, filters, reference reuse, and lossless legacy/compact payload compatibility.
- Candidate-search batches merge directly into ID-only lists, avoiding an additional whole-chunk response collection. Processed buffers are released before the next chunk.
- Checkpoint SQLite page cache capped at 8 MiB; temporary operations use disk; restore insert batch reduced from 2,000 to 250 rows.
- Source scores and records stay queryable in SQL. New evidence storage is packed in metadata and decoded by the model; direct SQL evidence consumers need the documented decoder.
- Backend/worker images rebuilt and applied: 11.9 GB -> 1.33 GB each; shared image layers mean these sizes must not be summed. All active images: 16.55 GB -> 5.981 GB.
- Obsolete build cache cleanup reclaimed 12.58 GB. Final build cache: 4.631 GB, no reclaimable bytes. All five containers running; API `/up` and frontend returned HTTP 200.
- No queued/reserved jobs were interrupted. A stale September 24 job remains in historical processing status and was not edited.

## Limits and follow-up

At the initial memory-efficiency milestone, historical storage was unchanged and existing volumes remained 74.81 GB. The subsequent selected-workspace cleanup below changes that storage. A representative full-size before/after matching run is still required for end-to-end throughput and peak RSS guarantees; chunk logs include payload bytes and PHP memory, and job metrics include peak PHP memory. No claim of a measured percentage reduction in full-job RAM is made.

## Selected-workspace cleanup — completed 2026-10-13

The user explicitly selected seven workspaces. All 17 linked jobs, including historical runs, and their 12 datasets are retained. The original manifest records 3,307,263 retained candidates and 1,005,045 unrelated candidates to remove. The 1,308 retained review decisions have an unchanged SHA-256 checksum after deletion. No users or MFD reference data are removed.

- Unrelated jobs/results and 13 unused datasets removed. Thirteen orphan source files reclaimed 1,043,476,238 bytes; one search index associated with a removed dataset was deleted. Each file path was resolved and checked against the dataset storage root.
- Empty SQLite checkpoint pages reclaimed: approximately 1.6 GB and 3.3 GB files became less than 400 KiB each. Remaining checkpoint headers and normalized reference caches are retained. New checkpoint files use incremental auto-vacuum; completion reclaims at most 1,024 pages per call.
- Full field explanations are encoded losslessly in `_field_scores`; SQL continues reading a small column/score projection. Model access returns the original full explanation. Search targets source records, not private packed explanations. Small payloads stay uncompressed when compression would increase size.
- Read-only 1,000-result sample before historical conversion: combined payload 3,196,347 -> 2,476,036 bytes, 22.5% smaller. Encode and integrity checks took 237.24 ms for the sample; PHP peak remained 26.4 MiB. This measures serialized candidate payload, not total allocated MySQL pages or full-job RAM.
- Four redundant prefix indexes removed through a reversible migration. New candidate IDs use UUIDv7; existing result IDs and review references remain unchanged.
- Maintenance conversion uses a bounded 1,000-row staging table and indexed update join. EXPLAIN verifies `eq_ref` on the matching-results primary key rather than scanning all results. Each changed row is verified losslessly before writing; final retained counts are compared with the original manifest. More than 210,000 old candidates were converted before temporarily deferring the remainder because FULL row logging amplified disk use. The script refuses bulk conversion under FULL; new results already use compact storage.
- Seven-day binary-log retention applied, logging enabled. On 2026-10-13 the user explicitly approved MINIMAL row images and background I/O capacity 1,000; applied live and persisted in Compose. Max I/O remains 2,000 and buffer pool 2 GiB. Conversion continues with the regular application account; no root deletion or disabling logging.
- Final targeted regression: 29 tests, 232 assertions passed, including preservation of integral floating-point values.
- Historical conversion completed and retained counts verified: 3,307,263 candidates and all 1,308 decisions unchanged. Packing processed 3,304,535 candidates (new or already compact); 2,728 small payloads remain unchanged. The final pass converted 1,944,659 candidates, verified 1,359,876 already compact candidates, and saved 1,441,506,127 serialized payload bytes in that pass. Peak PHP allocation was 32,579,584 bytes (31.1 MiB); this is maintenance memory, not full matching-job memory.
- Found an additional maintenance bottleneck: repeated DELETE on the private InnoDB staging table accumulated a 3.6 GiB temporary tablespace. Resetting it with TRUNCATE per batch held temporary space at about 12 MiB across hundreds of thousands of further rows; sampled 50-second progress improved from about 20,000 to over 100,000 rows. This interval observation is not a full-job throughput guarantee.
- Both physical table rebuilds completed with MySQL status OK. The matching-results file decreased from approximately 35 GiB to 16,231,956,480 bytes (15.1 GiB); total MySQL directory usage decreased from approximately 62 to 43 GiB, including retained binary logs.
- Offline Docker VHD compaction completed using scoped filesystem TRIM and DiskPart on the detached, exclusively checked data disk. Initial VHD length was 113,084,727,296 bytes; temporary rebuild/conversion growth reached 142,310,637,568 bytes. Compaction reduced it to 62,085,136,384 bytes, reclaiming 80,225,501,184 bytes from that temporary peak. After restart it measured 62,118,690,816 bytes (62.12 GB), approximately 45% below its initial length. Virtual maximum capacity was not resized. Method reference: [Microsoft compact vdisk](https://learn.microsoft.com/windows-server/administration/windows-commands/compact-vdisk).
- Final post-restart verification: all seven workspaces, 17 jobs, 12 datasets, 3,307,263 candidates and 1,308 decisions retained; decision checksum unchanged. All five containers running, backend/frontend HTTP 200, Meilisearch available. Persisted globals confirmed: logging ON, MINIMAL row images, I/O capacity 1,000/max 2,000, buffer pool 2 GiB. No user decisions were created or changed during verification.
