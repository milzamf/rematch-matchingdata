# Desain Logo Branding Web: RE-MATCH (BPS)

Dokumentasi identitas visual dan logo vector SVG untuk sistem **RE-MATCH** (Sistem Rekonsiliasi Data Usaha/Perusahaan Konstruksi pada Direktorat Statistik Sumber Daya Mineral & Konstruksi, Badan Pusat Statistik).

---

## 1. Pratinjau Visual Logo

![Pratinjau Desain Logo Branding RE-MATCH (Versi Horizontal & Icon Mark)](/C:/Users/ilzam/.gemini/antigravity/brain/1c6e7964-352c-4c2c-8eda-c1237e77abec/logo_preview.png)

---

## 2. Filosofi & Konsep Desain (Design Rationale)

Mengikuti prinsip **`antislop-ui`** (menolak elemen klise AI seperti bintang *sparkles*, neon berlebihan, atau bentuk abstrak tanpa makna):

1. **Siluet Huruf "R" yang Geometris:**
   - Mewakili identitas nama **RE-MATCH** sekaligus kata *Reconciliation* (Rekonsiliasi).
2. **Pilar Tegak Kiri (Benchmark Master Data):**
   - Batang vertikal dengan aksen garis data presisi melambangkan data acuan master yang kokoh dan berintegritas, yaitu **Sampling Frame Usaha Konstruksi BPS**.
3. **Lengkungan Atas (*Reconcile Arch*):**
   - Lengkungan dinamis yang melingkar masuk melambangkan aliran data transaksi eksternal yang diinputkan (**Data LPSE & SIJK**).
4. **Kaki Diagonal & Titik Temu Hijau (*Precision Match Node*):**
   - Titik temu di persimpangan tengah dengan aksen hijau emerald (`#10B981` / `#059669`) melambangkan keberhasilan pencocokan data (*Exact / High Similarity Match*).
5. **Palet Warna Resmi & Enterprise:**
   - **Deep Sapphire Navy (`#0F172A`, `#1E3A8A`)**: Kredibilitas data institusional pemerintah.
   - **BPS Vibrant Blue (`#2563EB`, `#0284C7`)**: Modernitas, transparansi, dan transformasi digital.
   - **Precision Emerald (`#10B981`)**: Tingkat kepadan/akurasi statistik yang valid.

---

## 3. Berkas yang Telah Dibuat di Proyek `batchmatch`

| Berkas | Tipe | Lokasi | Kegunaan |
| :--- | :--- | :--- | :--- |
| **`logo.svg`** | SVG Vector | [`D:\Ilzam\Latsar\batchmatch\public\logo.svg`](file:///D:/Ilzam/Latsar/batchmatch/public/logo.svg) | Logo branding horizontal lengkap (Emblem + Teks RE-MATCH + Tagline + Badge BPS). Cocok untuk Header, Splash screen, dan Laporan. |
| **`logo-icon.svg`** | SVG Vector | [`D:\Ilzam\Latsar\batchmatch\public\logo-icon.svg`](file:///D:/Ilzam/Latsar/batchmatch/public/logo-icon.svg) | Icon mark rasio 1:1 squircle. Cocok untuk Favicon browser, avatar profil, dan icon launcher. |
| **`logo.tsx`** | React Component | [`D:\Ilzam\Latsar\batchmatch\src\components\ui\logo.tsx`](file:///D:/Ilzam/Latsar/batchmatch/src/components/ui/logo.tsx) | Komponen React siap pakai dengan dukungan dark mode dan varian ukuran (`sm`, `md`, `lg`, `xl`). |

---

## 4. Cara Penggunaan di Komponen React

```tsx
import { Logo, LogoIcon } from "@/components/ui/logo";

// 1. Logo horizontal lengkap pada Topbar / Navbar
export function Topbar() {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b">
      <Logo size="md" showBadge={true} />
    </header>
  );
}

// 2. Icon-only pada Sidebar yang diciutkan (collapsed)
export function CollapsedSidebar() {
  return (
    <aside className="w-16 p-3 flex justify-center">
      <LogoIcon className="w-8 h-8" />
    </aside>
  );
}
```
