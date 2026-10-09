# Rules: Engine Rekonsiliasi Data & Matching Skala Besar

## 1. Pemisahan Mutlak Antara Mandatory Key dan Verification Rules
1. **Definisi Mandatory Key:** Kolom mandatory adalah pengenal unik deterministik (*hard identifier*, misal: `idsbr`, `npwp`, `nib`, `id_perusahaan`).
2. **Prioritas Eksekusi (Tier 1 Fast-Path):** Kolom mandatory wajib dievaluasi pertama kali menggunakan hash map $O(1)$ di memori. Record yang cocok langsung ditetapkan sebagai **Auto Match (100%)** dan dibypass dari seluruh perhitungan kemiripan string (*fuzzy scoring*).
3. **Eksklusi dari Tahap Verifikasi (Phase 4 Guardrails):** Kolom mandatory **TIDAK BOLEH** dimasukkan ke dalam daftar aturan verifikasi guardrails. Data yang lolos ke tahap fuzzy adalah data yang memang tidak memiliki ID yang sama; menguji ulang ID di tahap verifikasi akan menyebabkan *false negative* (kandidat nama dan alamat yang sah ditolak atau diturunkan statusnya secara keliru).

## 2. Hirarki Pencocokan Berlapis (Multi-Tier Waterfall)
Untuk dataset menengah hingga besar (>10.000 record), pipeline pencocokan wajib mengikuti hirarki efisiensi:
1. **Tier 1 (Mandatory Key Exact):** Hash lookup $O(1)$ pada ID unik. Selesai dalam hitungan detik tanpa fuzzy matching.
2. **Tier 2 (Composite Exact / "Gelondongan"):** Hash lookup $O(1)$ pada gabungan seluruh atribut entitas non-mandatory (misal: Bentuk Usaha + Nama Inti + Alamat + Wilayah terstandarisasi). Menangkap 20–40% duplikasi identik tanpa komputasi jarak leksikal berulang.
3. **Tier 3 (Candidate Blocking & Fuzzy Scoring):** Hanya sisa record yang memiliki variasi teks yang dikirimkan ke mesin pencarian kandidat berindeks (Meilisearch) dengan batas kandidat efisien (top 3–5) dan pembobotan fuzzy (Jaro-Winkler, Token Set Ratio, Levenshtein).

## 3. Skalabilitas Antarmuka Review (Server-Side Pagination Mandate)
1. **Dilarang Keras Hardcoding Limit:** Dilarang membatasi total data hasil pencocokan secara sepihak (seperti `limit 1000`) di frontend maupun backend tanpa menyediakan kontrol paginasi server.
2. **Server-Side Pagination & Filtering:** Endpoint review wajib selalu memproses parameter `page`, `per_page`, `status`, dan `search` di level basis data menggunakan SQL `LIMIT/OFFSET` terindeks.
3. **Integritas Angka Ringkasan:** Seluruh badge indikator (Need Review, Auto Matched, Unmatched, Semua) wajib merefleksikan total kuantitas sebenarnya dari database, bukan panjang irisan data di halaman aktif.
