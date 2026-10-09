// @ts-check
import { chromium } from 'playwright';
import path from 'path';

const TARGET_DIR = 'D:/AI/Projects/Antigravity/Latsar/Minggu 6/assets';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  // Helper to inject highlight boxes
  const injectHighlightScript = `
    window.addHighlight = function(target, label, options = {}) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) {
        console.warn('Element not found:', target);
        return;
      }
      const rect = el.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'pw-highlight';
      box.style.position = 'absolute';
      box.style.top = (rect.top + window.scrollY - (options.padTop || 4)) + 'px';
      box.style.left = (rect.left + window.scrollX - (options.padLeft || 4)) + 'px';
      box.style.width = (rect.width + (options.padWidth || 8)) + 'px';
      box.style.height = (rect.height + (options.padHeight || 8)) + 'px';
      box.style.border = '3px solid #E11D48';
      box.style.borderRadius = '8px';
      box.style.pointerEvents = 'none';
      box.style.zIndex = '999999';
      box.style.boxSizing = 'border-box';

      if (label) {
        const badge = document.createElement('div');
        badge.style.position = 'absolute';
        badge.style.top = '-26px';
        badge.style.left = '-3px';
        badge.style.background = '#E11D48';
        badge.style.color = '#FFFFFF';
        badge.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = 'bold';
        badge.style.padding = '2px 10px';
        badge.style.borderRadius = '4px 4px 0 0';
        badge.style.whiteSpace = 'nowrap';
        badge.textContent = label;
        box.appendChild(badge);
      }
      document.body.appendChild(box);
    };
    window.clearHighlights = function() {
      document.querySelectorAll('.pw-highlight').forEach(el => el.remove());
    };
  `;

  // 1. Perform UI login
  console.log('Logging in as admin...');
  await page.goto('http://localhost:8090/login', { waitUntil: 'networkidle' });
  const inputs = await page.locator('input').all();
  await inputs[0].fill('admin');
  await inputs[1].fill('321');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);
  console.log('Logged in. Current URL:', page.url());

  // -------------------------------------------------------------------------
  // GAMBAR 5: Konfigurasi Mode Preset (Step 2 Aturan Pencocokan)
  // -------------------------------------------------------------------------
  console.log('Capturing Gambar 5: Konfigurasi Mode Preset...');
  await page.goto('http://localhost:8090/matching?workspace=01a0d36f-2fc1-7108-8b95-bb82621b876f&step=2', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click on "Konstruksi" preset card
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('button'));
    const kCard = cards.find(c => c.textContent?.includes('Konstruksi') && c.textContent?.includes('WLS: Nama Inti 55%'));
    if (kCard) kCard.click();
  });
  await page.waitForTimeout(1000);

  // Scroll to Konfigurasi Matching
  await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h2'));
    const targetH2 = headings.find(h => h.textContent?.includes('Konfigurasi Matching'));
    if (targetH2) {
      targetH2.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  });
  await page.waitForTimeout(500);

  await page.evaluate(injectHighlightScript);
  await page.evaluate(() => {
    window.clearHighlights();
    // 1. Highlight Konstruksi preset card
    const buttons = Array.from(document.querySelectorAll('button'));
    const kCard = buttons.find(b => b.textContent?.includes('Konstruksi') && b.textContent?.includes('WLS: Nama Inti 55%'));
    if (kCard) {
      window.addHighlight(kCard, '1. Preset Teroptimasi Sektor Konstruksi (Aktif)', { padTop: 6, padHeight: 12 });
    }
    // 2. Highlight Field Mandatory & Similarity summary
    const allDivs = Array.from(document.querySelectorAll('div'));
    const summaryBox = allDivs.find(d => d.textContent?.includes('Field Mandatory') && d.textContent?.includes('Field Similarity') && d.textContent?.includes('Field Mandatory diperiksa lebih dulu'));
    if (summaryBox) {
      window.addHighlight(summaryBox, '2. Ringkasan Field Mandatory & Field Similarity', { padTop: 6, padHeight: 12 });
    }
  });

  const sc05Path = path.join(TARGET_DIR, 'sc_05_konfigurasi_preset_highlight.png');
  const mainEl5 = (await page.locator('main').count()) > 0 ? page.locator('main').first() : page.locator('body');
  await mainEl5.screenshot({ path: sc05Path });
  console.log(`✓ Saved Gambar 5 to ${sc05Path}`);

  // -------------------------------------------------------------------------
  // GAMBAR 6: Konfigurasi Kustom (Step 2 Aturan Pencocokan Kustom)
  // -------------------------------------------------------------------------
  console.log('Capturing Gambar 6: Konfigurasi Kustom...');
  await page.evaluate(() => {
    window.clearHighlights();
    const buttons = Array.from(document.querySelectorAll('button'));
    const customCard = buttons.find(b => b.textContent?.includes('Kustom Penuh'));
    if (customCard) customCard.click();
  });
  await page.waitForTimeout(1000);

  // Scroll down to Variabel & Bobot
  await page.evaluate(() => {
    const paras = Array.from(document.querySelectorAll('p'));
    const targetP = paras.find(p => p.textContent?.includes('Variabel & Bobot'));
    if (targetP) {
      targetP.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    window.clearHighlights();
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    // 1. Variabel & Bobot
    const weightsBox = allDivs.find(d => d.textContent?.includes('Variabel & Bobot') && d.textContent?.includes('Total bobot 100%'));
    if (weightsBox) {
      window.addHighlight(weightsBox, '1. Pengaturan Bobot Variabel (Total Bobot 100%)', { padTop: 6, padHeight: 12 });
    }
    
    // 2. Metode Perbandingan
    const methodsBox = allDivs.find(d => d.textContent?.includes('Metode Perbandingan') && d.textContent?.includes('Pilih satu metode yang didukung'));
    if (methodsBox) {
      window.addHighlight(methodsBox, '2. Pemilihan Metode Algoritma Per Variabel', { padTop: 6, padHeight: 12 });
    }
    
    // 3. Aturan Hasil
    const rulesBox = allDivs.find(d => d.textContent?.includes('Aturan Hasil') && d.textContent?.includes('Auto Match'));
    if (rulesBox) {
      window.addHighlight(rulesBox, '3. Ambang Batas & Aturan Verifikasi Guardrails', { padTop: 6, padHeight: 12 });
    }
  });

  const sc06Path = path.join(TARGET_DIR, 'sc_06_konfigurasi_kustom_highlight.png');
  const mainEl6 = (await page.locator('main').count()) > 0 ? page.locator('main').first() : page.locator('body');
  await mainEl6.screenshot({ path: sc06Path });
  console.log(`✓ Saved Gambar 6 to ${sc06Path}`);

  // -------------------------------------------------------------------------
  // GAMBAR 7: Ringkasan Hasil Matching (/results Tab Ringkasan)
  // -------------------------------------------------------------------------
  console.log('Capturing Gambar 7: Ringkasan Hasil Matching...');
  await page.goto('http://localhost:8090/results?workspace=01a0d36f-2fc1-7108-8b95-bb82621b876f', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click on Ringkasan tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const rTab = tabs.find(t => t.textContent?.trim() === 'Ringkasan');
    if (rTab) rTab.click();
  });
  await page.waitForTimeout(1000);

  await page.evaluate(injectHighlightScript);
  await page.evaluate(() => {
    window.clearHighlights();
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    // 1. KPI Cards
    const kpiBox = allDivs.find(d => d.textContent?.includes('Data Input') && d.textContent?.includes('Match') && d.textContent?.includes('Perlu Review') && d.textContent?.includes('Tidak Match') && d.children.length === 4);
    if (kpiBox) {
      window.addHighlight(kpiBox, '1. Metrik Hasil Klasifikasi (4 Status Utama)', { padTop: 6, padHeight: 12 });
    }
    
    // 2. Aksi Berikutnya
    const actionBox = allDivs.find(d => d.textContent?.includes('Aksi Berikutnya') && d.querySelector('a'));
    if (actionBox) {
      window.addHighlight(actionBox, '2. Tindak Lanjut Penelaahan Kasus (Buka Review)', { padTop: 6, padHeight: 12 });
    }
    
    // 3. Pareto Chart
    const paretoBox = allDivs.find(d => d.textContent?.includes('Analisis Pola Masalah (Distribusi Pareto)'));
    if (paretoBox) {
      window.addHighlight(paretoBox, '3. Deteksi Anomali Penurunan Status (Distribusi Pareto)', { padTop: 6, padHeight: 12 });
    }
  });

  const sc07Path = path.join(TARGET_DIR, 'sc_07_ringkasan_hasil_highlight.png');
  const mainEl7 = (await page.locator('main').count()) > 0 ? page.locator('main').first() : page.locator('body');
  await mainEl7.screenshot({ path: sc07Path });
  console.log(`✓ Saved Gambar 7 to ${sc07Path}`);

  // -------------------------------------------------------------------------
  // GAMBAR 8: Komparasi Kasus Berdampingan (/results Tab Komparasi Kasus)
  // -------------------------------------------------------------------------
  console.log('Capturing Gambar 8: Komparasi Kasus Berdampingan...');
  await page.evaluate(() => {
    window.clearHighlights();
    const tabs = Array.from(document.querySelectorAll('button'));
    const kTab = tabs.find(t => t.textContent?.trim() === 'Komparasi Kasus');
    if (kTab) kTab.click();
  });
  await page.waitForTimeout(2000);

  // Select Data #171682
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div, button'));
    const target = cards.find(c => c.textContent?.includes('171682') && c.textContent?.includes('MULTI KARYA UTAMA'));
    if (target) target.click();
  });
  await page.waitForTimeout(1000);

  await page.evaluate(injectHighlightScript);
  await page.evaluate(() => {
    window.clearHighlights();
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    // 1. Side by side input vs reference
    const compareBox = allDivs.find(d => d.textContent?.includes('Dataset Input') && d.textContent?.includes('Dataset Acuan') && d.textContent?.includes('JOGOYUDAN'));
    if (compareBox) {
      window.addHighlight(compareBox, '1. Komparasi Data Berdampingan (Input vs Acuan)', { padTop: 6, padHeight: 12 });
    }
    
    // 2. Kemiripan Kolom
    const simBox = allDivs.find(d => d.textContent?.includes('Kemiripan Kolom') && d.textContent?.includes('95.45%'));
    if (simBox) {
      window.addHighlight(simBox, '2. Rincian Skor Kemiripan Multi-Atribut', { padTop: 6, padHeight: 12 });
    }
    
    // 3. Bukti Verifikasi & Guardrails
    const guardBox = allDivs.find(d => d.textContent?.includes('Bukti Verifikasi & Guardrails'));
    if (guardBox) {
      window.addHighlight(guardBox, '3. Transparansi Penurunan Status (Decision Tree Guardrails)', { padTop: 6, padHeight: 12 });
    }
  });

  const sc08Path = path.join(TARGET_DIR, 'sc_08_komparasi_simetris_highlight.png');
  const mainEl8 = (await page.locator('main').count()) > 0 ? page.locator('main').first() : page.locator('body');
  await mainEl8.screenshot({ path: sc08Path });
  console.log(`✓ Saved Gambar 8 to ${sc08Path}`);

  // -------------------------------------------------------------------------
  // GAMBAR 9: Ekspor Hasil (Step 3 Subtab Ekspor)
  // -------------------------------------------------------------------------
  console.log('Capturing Gambar 9: Ekspor Hasil...');
  await page.goto('http://localhost:8090/matching?workspace=01a0d658-1f0d-72f3-912b-e1c4c25c28da&step=3', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click subtab Ekspor
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const expBtn = buttons.find(b => b.textContent?.trim() === 'Ekspor');
    if (expBtn) expBtn.click();
  });
  await page.waitForTimeout(1500);

  await page.evaluate(injectHighlightScript);
  await page.evaluate(() => {
    window.clearHighlights();
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    // 1. Checkboxes Auto-Enrich & Multi-Sheet
    const checkSection = allDivs.find(d => d.textContent?.includes('Auto-Enrich') && d.textContent?.includes('Multi-Sheet'));
    if (checkSection) {
      window.addHighlight(checkSection, '1. Opsi Pengayaan Data (Auto-Enrich) & Multi-Sheet', { padTop: 6, padHeight: 12 });
    }
    
    // 2. 3 Format Cards
    const cardsSection = allDivs.find(d => d.textContent?.includes('Pemutakhiran Master Data') && d.textContent?.includes('Laporan Audit Lengkap') && d.textContent?.includes('Sisa Perlu Reviu'));
    if (cardsSection) {
      window.addHighlight(cardsSection, '2. Pilihan Format & Cakupan Data yang Diekspor', { padTop: 6, padHeight: 12 });
    }
    
    // 3. Download Buttons
    const dlSection = allDivs.find(d => d.textContent?.includes('Unduh XLSX') && d.textContent?.includes('Unduh CSV'));
    if (dlSection) {
      window.addHighlight(dlSection, '3. Tombol Unduh Berkas Hasil (.xlsx / .csv)', { padTop: 6, padHeight: 12 });
    }
  });

  const sc09Path = path.join(TARGET_DIR, 'sc_09_ekspor_hasil_highlight.png');
  const mainEl9 = (await page.locator('main').count()) > 0 ? page.locator('main').first() : page.locator('body');
  await mainEl9.screenshot({ path: sc09Path });
  console.log(`✓ Saved Gambar 9 to ${sc09Path}`);

  await browser.close();
  console.log('All 5 authentic screenshots successfully captured from localhost:8090!');
}

main().catch(err => {
  console.error('Error during capture:', err);
  process.exit(1);
});
