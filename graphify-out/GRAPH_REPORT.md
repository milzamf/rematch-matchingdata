# Graph Report - D:\Ilzam\Code\Codex\Latsar\batchmatch  (2026-10-10)

## Corpus Check
- 14 files · ~60,156 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 472 nodes · 973 edges · 23 communities (18 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- api / results
-  / RunMatchingJob
- matching
-  / ReviewResultService
- api
-  / WorkspaceController
- FieldValueExtractor / SimilarityScorer
- api / matching
- api / matching
- api
- EntityNameParser
- MatchingCheckpointManager /
- WilayahDictionaryService
- matching
- api / matching
- matching
- api
- matching
- api
- api
- matching
- api
- matching

## God Nodes (most connected - your core abstractions)
1. `ReviewResultService` - 45 edges
2. `MatchingEngineService` - 41 edges
3. `apiFetch()` - 34 edges
4. `SimilarityScorer` - 25 edges
5. `MatchingPage()` - 22 edges
6. `EntityNameParser` - 17 edges
7. `WorkspaceController` - 16 edges
8. `MatchingCheckpointManager` - 15 edges
9. `WilayahDictionaryService` - 15 edges
10. `StepConfigV2()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `FieldValueExtractor` --references--> `EntityNameParser`  [EXTRACTED]
  backend/app/Services/Matching/FieldValueExtractor.php → backend/app/Services/Matching/EntityNameParser.php
- `MatchingEngineService` --references--> `EntityNameParser`  [EXTRACTED]
  backend/app/Services/Matching/MatchingEngineService.php → backend/app/Services/Matching/EntityNameParser.php
- `MatchingEngineService` --references--> `FieldValueExtractor`  [EXTRACTED]
  backend/app/Services/Matching/MatchingEngineService.php → backend/app/Services/Matching/FieldValueExtractor.php
- `MatchingEngineService` --references--> `MatchingCheckpointManager`  [EXTRACTED]
  backend/app/Services/Matching/MatchingEngineService.php → backend/app/Services/Matching/MatchingCheckpointManager.php
- `MatchingEngineService` --references--> `MatchingConfigResolver`  [EXTRACTED]
  backend/app/Services/Matching/MatchingEngineService.php → backend/app/Services/Matching/MatchingConfigResolver.php

## Import Cycles
- None detected.

## Communities (23 total, 5 thin omitted)

### Community 0 - "api / results"
Cohesion: 0.07
Nodes (60): fetchWorkspace(), listWorkspaces(), ReviewCandidate, ReviewCaseGroup, ReviewDecisionSummary, ReviewItem, ReviewResults, WorkspaceSummary (+52 more)

### Community 1 - " / RunMatchingJob"
Cohesion: 0.09
Nodes (14): App\Models\Dataset, App\Models\MatchingJob, App\Models\MatchingResult, App\Models\User, RunMatchingJob, MatchingEngineService, Dataset, MatchingJob (+6 more)

### Community 2 - "matching"
Cohesion: 0.04
Nodes (21): ALLOWED, CandidateCount, CaseGroupFilter, ColumnMappingDraft, COMPARISON_FAMILY_ALGORITHMS, ComparisonFamily, ConfigFieldV2, ConfigurationField (+13 more)

### Community 3 - " / ReviewResultService"
Cohesion: 0.09
Nodes (5): App\Models\ReviewDecision, ReviewResultService, Collection, MatchingResult, ReviewDecision

### Community 4 - "api"
Cohesion: 0.05
Nodes (40): AdminUserPasswordInput, AdminUserSummary, AdminUserUpsertInput, AiConfigRecommendedField, AiEnvelope, AiMatchingConfigurationSuggestion, AiReviewAnalysis, AiReviewRecommendation (+32 more)

### Community 5 - " / WorkspaceController"
Cohesion: 0.12
Nodes (12): App\Http\Controllers\Controller, App\Http\Requests\WorkspaceRequest, App\Models\Workspace, App\Support\Auth\ResourceOwnership, Dataset, MatchingJob, WorkspaceController, MatchingConfigResolver (+4 more)

### Community 6 - "FieldValueExtractor / SimilarityScorer"
Cohesion: 0.11
Nodes (3): FieldValueExtractor, SimilarityScorer, ValueNormalizer

### Community 7 - "api / matching"
Cohesion: 0.10
Nodes (23): fetchMatchingJobStatus(), inspectDataset(), runMatching(), stopMatching(), buildWorkspaceName(), buildWorkspaceNameFromUploads(), datasetDisplayName(), datasetResultToUpload() (+15 more)

### Community 8 - "api / matching"
Cohesion: 0.13
Nodes (18): fetchAiMatchingConfiguration(), algorithmsForField(), ColumnTypeBadge(), comparisonFamilyForAlgorithm(), comparisonFamilyLabel(), findMappingForSuggestion(), formatAiValue(), isAddressField() (+10 more)

### Community 9 - "api"
Cohesion: 0.12
Nodes (17): apiFetch(), confirmSessionExpired(), createAdminUser(), createReviewRule(), deleteReviewRule(), deleteWorkspace(), fetchCurrentUser(), fetchDatasetRows() (+9 more)

### Community 13 - "matching"
Cohesion: 0.24
Nodes (14): caseConfidenceClass(), caseConfidenceLabel(), caseGroupDisplayLabel(), caseGroupFilterLabel(), caseGroupReason(), caseGroupRecommendation(), CaseGroupsReview(), caseGroupStatusClass() (+6 more)

### Community 14 - "api / matching"
Cohesion: 0.20
Nodes (10): fetchAiReviewAnalysis(), fetchAiReviewRecommendation(), fetchReviewKnowledge(), fetchReviewResults(), saveReviewDecision(), undoReviewDecision(), findDecisionGroupId(), mergeReviewSnapshot() (+2 more)

### Community 15 - "matching"
Cohesion: 0.33
Nodes (7): buildDifferenceSummary(), comparisonBadgeClass(), comparisonLabel(), DifferenceSummaryCell(), FieldComparison(), formatRecordValue(), humanizeFieldLabel()

### Community 16 - "api"
Cohesion: 0.40
Nodes (5): buildApiUrl(), downloadBackendExport(), getClientLocale(), readCookie(), sendApiRequest()

### Community 17 - "matching"
Cohesion: 0.40
Nodes (5): DecisionHistory(), decisionSourceLabel(), reviewDecisionLabel(), reviewFilterLabel(), reviewStatusLabel()

### Community 18 - "api"
Cohesion: 0.67
Nodes (3): createWorkspace(), updateWorkspace(), writeWorkspace()

### Community 19 - "api"
Cohesion: 0.67
Nodes (3): ensureCsrfCookie(), loginWithSession(), logoutSession()

### Community 20 - "matching"
Cohesion: 0.67
Nodes (3): defaultAlgorithmForColumn(), defaultMappingAlgorithm(), StepColumnMapping()

## Knowledge Gaps
- **56 isolated node(s):** `Route`, `tabs`, `TabKey`, `ReviewHistoryView`, `FinalStatusCounts` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MatchingEngineService` connect ` / RunMatchingJob` to `EntityNameParser`, `MatchingCheckpointManager / `, ` / WorkspaceController`, `FieldValueExtractor / SimilarityScorer`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `ReviewResultService` connect ` / ReviewResultService` to ` / RunMatchingJob`, `WilayahDictionaryService`, ` / WorkspaceController`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `SimilarityScorer` connect `FieldValueExtractor / SimilarityScorer` to ` / RunMatchingJob`, ` / WorkspaceController`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `Route`, `tabs`, `TabKey` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api / results` be split into smaller, more focused modules?**
  _Cohesion score 0.0662004662004662 - nodes in this community are weakly interconnected._
- **Should ` / RunMatchingJob` be split into smaller, more focused modules?**
  _Cohesion score 0.08734693877551021 - nodes in this community are weakly interconnected._
- **Should `matching` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._