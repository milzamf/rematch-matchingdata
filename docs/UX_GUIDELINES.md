# BatchMatch UX Guidelines

Version: 1.0

---

# Purpose

Dokumen ini menjadi standar UX/UI untuk seluruh pengembangan BatchMatch.

Semua halaman baru maupun perubahan UI harus mengikuti pedoman ini.

PRD menjelaskan **apa** yang harus dibuat.

UX Guidelines menjelaskan **bagaimana** pengalaman pengguna harus dirancang.

---

# Target Users

BatchMatch ditujukan untuk:

- Analis Statistik
- Pegawai BPS
- Pengguna bisnis
- Data Analyst

BatchMatch **bukan** ditujukan untuk software engineer atau data scientist.

Gunakan istilah yang mudah dipahami.

Hindari istilah teknis apabila ada padanan yang lebih sederhana.

---

# Core Principles

## 1. Simple by Default

Pengguna baru harus dapat menyelesaikan proses matching tanpa memahami algoritma.

Konfigurasi default harus cukup baik untuk mayoritas kasus.

---

## 2. Powerful When Needed

Pengguna tingkat lanjut tetap dapat mengakses konfigurasi lengkap.

Semua pengaturan lanjutan harus disembunyikan hingga benar-benar diperlukan.

Gunakan:

Advanced Settings

untuk seluruh konfigurasi teknis.

---

## 3. Progressive Disclosure

Jangan tampilkan semua opsi sekaligus.

Tampilkan hanya informasi yang dibutuhkan pada langkah tersebut.

Contoh:

Mapping

↓

hanya memilih pasangan kolom

Configure

↓

mengatur cara pencocokan

Review

↓

memeriksa hasil

---

## 4. One Decision at a Time

Setiap halaman hanya boleh meminta satu jenis keputusan.

Contoh:

Upload

↓

memilih dataset

Mapping

↓

memasangkan kolom

Configure

↓

mengatur aturan matching

Review

↓

memutuskan hasil matching

---

## 5. Business Language

Gunakan istilah bisnis.

Contoh:

"Harus Sama Persis"

lebih baik daripada

"Exact Matching"

Jika istilah teknis diperlukan,

gunakan tooltip atau deskripsi singkat.

---

# Workflow

Workflow utama BatchMatch:

Upload

↓

Profiling

↓

Mapping

↓

Configure

↓

Run

↓

Review

↓

Sync

↓

Export

Setiap halaman hanya bertanggung jawab pada satu langkah workflow.

Jangan mencampurkan tanggung jawab antar halaman.

---

# Configure Page

Configure menggunakan dua mode.

## Quick Setup

Mode default.

Menampilkan empat preset:

- Balanced (Recommended)
- Strict
- Exploratory
- Custom

Mayoritas pengguna cukup memilih salah satu preset.

---

## Advanced Settings

Seluruh konfigurasi teknis berada di sini.

Misalnya:

- Matching Strategy
- Matching Algorithm
- Threshold
- Candidate Generation
- Data Normalization
- Candidate Filtering

Advanced Settings harus dalam keadaan collapsed secara default.

## Conditional Configure Flow

Quick Setup harus tetap sederhana.

Balanced, Strict, dan Exploratory langsung memakai default dan menampilkan ringkasan.

Custom membuka pilihan strategi:

- Exact Match
- Fuzzy Match
- Composite / Hybrid
- Rule-Based

Tampilkan hanya pengaturan yang relevan:

- Exact Match: field selection dan normalisasi bila perlu; tanpa threshold, Top N, bobot, atau formula.
- Fuzzy Match: algoritma per field, threshold, jumlah kandidat, dan normalisasi; tanpa bobot field.
- Composite / Hybrid: algoritma, threshold, kandidat, normalisasi, dan bobot otomatis; bobot manual hanya muncul jika dipilih.
- Rule-Based: rule builder; toleransi angka/tanggal hanya muncul jika field Number/Date aktif; skor gabungan opsional.

Algoritma utama ditampilkan lebih dulu.

Algoritma lanjutan hanya muncul melalui More Algorithms / Algoritma Lainnya.

---

# Mapping Page

Mapping hanya bertugas memasangkan kolom.

Jangan menampilkan:

- Matching Algorithm
- Threshold
- Weight

Semua dipindahkan ke Configure.

---

# Presets

Preset harus mengatur konfigurasi otomatis.

Balanced

→ konfigurasi umum

Strict

→ meminimalkan false positive

Exploratory

→ mencari kandidat sebanyak mungkin

Custom

→ pengguna mengatur semuanya sendiri

---

# Forms

Gunakan:

- Dropdown
- Radio Button
- Toggle
- Slider

Hindari textbox apabila pilihan sudah diketahui.

---

# Tables

Gunakan tabel hanya jika benar-benar diperlukan.

Apabila jumlah konfigurasi sedikit,

lebih baik gunakan card.

---

# Advanced Options

Semua opsi lanjutan harus berada di:

Advanced Settings

Jangan memenuhi halaman utama.

---

# Validation

Validasi harus muncul sedini mungkin.

Jangan menunggu sampai pengguna menekan tombol Run.

---

# Feedback

Setiap aksi penting harus memiliki feedback.

Contoh:

Loading

Success

Warning

Error

Empty State

---

# UI Writing

Gunakan teks yang sederhana, natural, profesional, dan ringkas.

Jangan gunakan sapaan buatan, nama user dummy, angka dummy, persentase dummy, growth indicator dummy, atau klaim marketing.

Judul, subtitle, helper text, status description, empty state, tooltip, dan keterangan singkat tidak memakai titik di akhir.

Dashboard harus menjawab pekerjaan yang sedang berjalan, hal yang perlu perhatian, dan cara melanjutkan pekerjaan.

Jangan menampilkan analytics, score, insight, atau rekomendasi jika belum berasal dari data nyata.

---

# Responsive

BatchMatch harus nyaman digunakan pada:

Desktop

Laptop

Tablet

Tidak perlu mengoptimalkan Mobile pada tahap MVP.

---

# Consistency

Gunakan istilah yang konsisten.

Contoh:

Selalu gunakan:

Reference Dataset

Input Dataset

Matching

Review

Configure

Jangan menggunakan sinonim berbeda pada halaman lain.

---

# Future Features

Workspace

Authentication

AI

tidak boleh memengaruhi UX MVP.

Semua fitur baru harus mengikuti prinsip pada dokumen ini.

---

# Rule

Jika terdapat konflik antara implementasi dan UX Guidelines,

gunakan UX Guidelines sebagai acuan desain,

kecuali PRD menyatakan sebaliknya.
