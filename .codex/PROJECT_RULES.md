# BatchMatch Project Rules

## 1. Source of Truth

- `PRD.md` adalah sumber utama kebutuhan produk.
- Dokumentasi teknis berada di folder `docs/`.
- Implementasi tidak boleh bertentangan dengan PRD.
- Jika dokumentasi dan implementasi berbeda, laporkan perbedaannya sebelum mengambil keputusan besar.

## 2. Scope Control

- Kerjakan hanya ruang lingkup yang diminta.
- Jangan menambahkan fitur, dependency, abstraction, atau refactor besar yang tidak diperlukan.
- Jangan mengubah UI yang sudah ada kecuali task memang berhubungan dengan UI.
- Jangan menghapus dummy data pada workflow yang belum masuk dalam milestone aktif.

## 3. Existing Project

- Lanjutkan project yang sudah ada.
- Jangan membuat ulang frontend atau backend.
- Periksa struktur dan implementasi yang ada sebelum mengubah file.
- Gunakan pola yang sudah konsisten di project selama tidak bertentangan dengan PRD.

## 4. Architecture

- Frontend menggunakan React, Vite, TypeScript, dan Tailwind.
- Backend utama menggunakan Laravel.
- Database development menggunakan MySQL.
- Komunikasi frontend dan backend dilakukan melalui REST API.
- Matching engine tetap berada di Laravel selama fase MVP.
- Python service hanya boleh ditambahkan setelah ada kebutuhan terukur dan persetujuan eksplisit.

## 5. Implementation Principles

- Gunakan solusi paling sederhana yang memenuhi kebutuhan.
- Controller Laravel harus tipis.
- Business logic ditempatkan pada service yang relevan.
- Gunakan validation request untuk input API.
- Hindari premature abstraction dan premature optimization.
- Jangan menambahkan package baru apabila kemampuan bawaan project sudah cukup.
- Jangan menggunakan `any` di TypeScript tanpa alasan yang jelas.

## 6. Database and API Safety

- Jangan mengubah atau menghapus migration lama secara destruktif tanpa alasan yang jelas.
- Perubahan schema harus menggunakan migration.
- API harus memiliki validation, response yang konsisten, dan error handling.
- Jangan mengekspos stack trace, credential, API key, atau data sensitif.

## 7. Testing and Verification

Sebelum menyatakan task selesai:

- Jalankan test yang relevan.
- Jalankan backend test jika backend berubah.
- Jalankan frontend build jika frontend berubah.
- Periksa route jika endpoint berubah.
- Laporkan test yang gagal atau tidak dapat dijalankan.
- Jangan menyatakan berhasil apabila verifikasi belum dilakukan.

## 8. Documentation Policy

Perbarui dokumentasi hanya jika perubahan memang relevan:

- `docs/API.md` untuk perubahan kontrak API.
- `docs/DATABASE.md` untuk perubahan schema atau relasi.
- `docs/ARCHITECTURE.md` untuk perubahan komponen atau alur sistem.
- `docs/TECH_STACK_DECISION.md` untuk keputusan teknologi penting.
- `docs/ROADMAP.md` untuk perubahan milestone atau prioritas.
- `docs/IMPLEMENTATION_STATUS.md` setelah status fitur berubah.
- `docs/CHANGELOG.md` untuk perubahan yang layak dicatat.

Perubahan styling kecil, typo, atau refactor internal tidak wajib memperbarui seluruh dokumentasi.

## 9. Completion Report

Pada akhir task, laporkan:

1. Ringkasan implementasi.
2. File yang diubah.
3. API atau database yang berubah.
4. Test dan build yang dijalankan.
5. Dokumentasi yang diperbarui.
6. Risiko atau pekerjaan tersisa.
7. Apakah perubahan aman untuk di-commit.
8. Rekomendasi commit message.