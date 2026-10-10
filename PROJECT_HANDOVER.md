# RE-MATCH: Comprehensive Project Handover & Knowledge State
*Dokumen ini dibuat sebagai referensi lengkap status arsitektur, progres pembangunan, dan konteks terkini sistem RE-MATCH untuk AI Assistant (Codex / ChatGPT).*

---

## 1. Identitas & Lingkungan Proyek
* **Nama Proyek:** RE-MATCH (Sistem Rekonsiliasi & Pencocokan Data Entitas Usaha / Wilayah)
* **Branch Git Utama:** `feat/backend-foundation` (Sinkron dengan `origin/feat/backend-foundation`, commit terbaru: `55848b5`)
* **Repositori:** `https://github.com/milzamf/rematch-matchingdata.git`
* **Docker Environment:**
  - `rematch-backend`: PHP 8.2+ Laravel 11 (`0.0.0.0:8000`)
  - `rematch-frontend`: React 19 + TanStack Router / TanStack Start + Vite (`0.0.0.0:5173` & `8090`)
  - `rematch-db`: MySQL 8.0 (`0.0.0.0:3306`, tuned InnoDB buffer pool 2GB & fast I/O)
  - `rematch-meilisearch`: Meilisearch v1.16 (`0.0.0.0:7700`)
  - `rematch-queue-worker`: Laravel Queue Worker background daemon

---

## 2. Status Terakhir vs. Konteks Masa Lalu ("Run A")
| Aspek | Konteks Lama ("Run A" di ingatan Anda) | Status Terkini (Sudah Selesai & Teruji) |
|---|---|---|
| **Git / Commit** | Belum ada commit, uncommitted working tree | Seluruh modul ter-commit rapi di branch `feat/backend-foundation` |
| **Backend Tests** | Sebagian gagal karena proteksi auth 401 | **100% PASS** (65 tests passed, 476 assertions, 0 failure) via `docker exec rematch-backend php artisan test` |
| **Frontend Build** | Masih ada kendala linter & types | **100% Clean Build** (`npm run build` / Nitro SSR build lolos tanpa error) |
| **Indexing Engine** | Sering macet/stuck di Tahap 2 saat index Meilisearch | Sudah otomatis mendeteksi index yang ada, skip re-index jika sudah 306k dokumen, dan transisi instan ke Tahap 3 |
| **Pemrosesan Data Besar** | Rawan crash / memory leak / timeout | Dukungan streaming CSV/XLSX, SQLite checkpoint & resume, optimasi fork sequential (<=10k rows) vs parallel (>10k rows) |
| **Kamus Wilayah (MFD)** | Format kaku, rawan miss pada beda format (misal `[11] ACEH` vs `11` vs `Aceh`, `Gunung Kidul` vs `Gunungkidul`) | Normalisasi MFD canggih: bracket stripping (`[11]`), spaceless matching, alias resmi kabupaten/kota (Toba vs Toba Samosir, dsb.) |
| **Sinkronisasi UI Matching** | Terkadang menampilkan `0/0/0` karena cache usang | `hydrateWorkspace` memprioritaskan database riil `matching_job`, auto-save diproteksi dari menimpa status `completed` |

---

## 3. Alur Arsitektur Sistem 3-Tahap (3-Step Pipeline)

### Tahap 1: Unggah & Pemetaan Data (Upload & Mapping)
* **File Upload:** Upload file acuan (Reference) dan file yang ingin dicocokkan (Input). Format didukung: `.xlsx`, `.xls`, `.csv`, `.tsv` (hingga jutaan baris via chunk streaming).
* **Column Profiling:** Profiling tipe data otomatis, deteksi null percentage, kardinalitas, dan sample data.
* **Synthetic Virtual Columns:**
  - `[Generated] Badan Usaha`: Ekstraksi legal form (PT, CV, UD, Fa, Koperasi, dsb.) menggunakan kamus baku badan usaha (`EntityNameParser`).
  - `[Generated] Nama Inti`: Pembersihan nama usaha dari bentuk hukum dan simbol untuk akurasi pencocokan nama.
* **Standardized Preview:** Pratinjau tabel hasil normalisasi ejaan dan ekstraksi sebelum eksekusi matching.

### Tahap 2: Konfigurasi & Mesin Matching (Configuration & Execution)
* **Preset:** Preset Default, Custom, dan **Konstruksi L-UB**.
* **4-Phase Matching Architecture:**
  1. *Phase 1 Normalization:* Pembersihan spasi, simbol, huruf besar/kecil, pemetaan kode wilayah MFD, pemisahan entitas.
  2. *Phase 2 Mandatory Exact Match:* Bypass instan untuk pasangan yang identik 100% pada kunci wajib (menghemat beban komputasi).
  3. *Phase 3 Candidate Generation:* Menggunakan Meilisearch dengan metadata ramping (hanya menyimpan field terpetakan untuk mencegah lonjakan database 20GB).
  4. *Phase 4 Guardrails & Composite Scoring:*
     - Kombinasi algoritma: WLS (Weighted Levenshtein Similarity), Jaro-Winkler, Token Set Ratio, Token Sort Ratio, Damerau-Levenshtein.
     - Deteksi anomali: Konflik Bentuk Usaha (PT vs CV), Konflik Identitas (NIB/NPWP beda), Konflik Wilayah (Provinsi/Kabupaten beda).
* **Klasifikasi Hasil:**
  - `matched` (Cocok Otomatis: skor di atas ambang batas tinggi, misal >= 90%).
  - `possible_match` (Perlu Review: skor di rentang ambang review, misal 70% - 89%).
  - `unmatched` (Tidak Cocok: skor di bawah ambang batas no-match).
* **Progress Streaming:** SSE (Server-Sent Events) terintegrasi dengan polling fallback, mendukung pause, stop, dan resume via SQLite checkpoint.

### Tahap 3: Review & Hasil (Review & Decisions)
* **Kelompok Kasus (Case Groups):** Mengelompokkan data perlu review berdasarkan pola anomali (Preset 1-6 semantik: Konflik Identitas, Wilayah Beda tapi Nama Cocok, Badan Usaha Beda, dsb.).
* **Aksi Massal Aman (Bulk Action with Safety Guardrails):** Operator dapat menerima/menolak kelompok kasus sekaligus, dengan pengecualian otomatis bagi record yang melanggar batasan keamanan.
* **Audit Trail & Undo:** Riwayat keputusan operator tercatat dengan nama reviewer dan dapat dibatalkan (undo) sewaktu-waktu.
* **Ekspor Fleksibel:** Ekspor Master Update (hanya data terpilih) atau Full Audit Log dalam format `.xlsx` dan `.csv`.

---

## 4. File-File Kunci dalam Codebase

### Backend (`backend/app/`):
* `Services/Matching/MatchingEngineService.php`: Inti mesin matching, pengatur 4 tahap, Meilisearch indexing, scoring, dan checkpointing.
* `Services/Datasets/DatasetInspectionService.php`: Streaming parser CSV/XLSX, virtual columns generator, standardized preview.
* `Services/Review/ReviewResultService.php`: Mesin kelompok kasus, filtering record review, bulk decision validation.
* `Services/Normalization/EntityNameParser.php`: Ekstraksi bentuk hukum PT/CV/dll dan nama inti usaha.
* `Services/Normalization/RegionalCodeNormalizer.php`: Normalisasi wilayah MFD, bracket parsing, spaceless, dan alias wilayah.
* `Http/Controllers/Api/WorkspaceController.php`: Manajemen state workspace, sinkronisasi state UI, proteksi overwriting data.
* `Http/Controllers/Api/MatchingRunController.php`: API endpoint eksekusi matching.

### Frontend (`src/`):
* `routes/matching.tsx`: Komponen utama 3-Step Wizard Matching (Upload, Konfigurasi/Run, Review).
* `routes/workspaces.tsx`: Daftar dan manajemen workspace proyek.
* `routes/results.tsx`: Tampilan hasil pencocokan, filter, analitik keputusan, dan panel ekspor.
* `components/review-diagnostic-charts.tsx`: Visualisasi Pareto Chart anomali review dan breakdown konflik.
* `lib/api.ts`: Klien API TypeScript terpusat dengan penanganan error dan parsing data.

---

## 5. Cara Menjalankan & Memverifikasi
```bash
# Menjalankan container Docker
docker compose up -d

# Menjalankan seluruh test backend (65 test / 476 assertions)
docker exec rematch-backend php artisan test

# Build frontend (Vite & SSR)
npm run build
```
Semua komponen saat ini dalam kondisi hijau (**Green / Passing**).
