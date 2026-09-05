export const kpis = [
  { label: "Total Records", value: "1,248,302", delta: "+12% vs last sync", tone: "success" as const },
  { label: "Matched Records", value: "842,091", delta: "67.4% of dataset", tone: "success" as const, progress: 67 },
  { label: "Possible Matches", value: "14,203", delta: "Requires manual review", tone: "warning" as const },
  { label: "Integrity Score", value: "98.4%", delta: "Optimal stability", tone: "success" as const },
];

export const recentJobs = [
  {
    id: "MJ-2481",
    name: "Rekonsiliasi Data Usaha Triwulan I",
    reference: "data_acuan_usaha.xlsx",
    input: "prelist_usaha.csv",
    records: "24,109",
    status: "Completed",
    accuracy: "98.4%",
    date: "2 hours ago",
  },
  {
    id: "MJ-2480",
    name: "Konsolidasi Data Perusahaan",
    reference: "data_perusahaan_acuan.xlsx",
    input: "data_input_perusahaan.dbf",
    records: "8,420",
    status: "Review",
    accuracy: "92.1%",
    date: "5 hours ago",
  },
  {
    id: "MJ-2479",
    name: "Rekonsiliasi Entitas Usaha",
    reference: "direktori_usaha.xlsx",
    input: "hasil_pendataan.csv",
    records: "3,204",
    status: "Running",
    accuracy: "-",
    date: "Today, 09:14",
  },
  {
    id: "MJ-2478",
    name: "Penggabungan Direktori Usaha",
    reference: "direktori_acuan.xlsx",
    input: "dataset_input.xml",
    records: "12,880",
    status: "Completed",
    accuracy: "96.7%",
    date: "Yesterday",
  },
];

export const reviewQueue = [
  {
    id: "RV-9921",
    refName: "PT. Global Tech Solutions",
    refMeta: "Jakarta, ID · +62 21 555 0101",
    inputName: "PT Global Tech Solusi",
    inputMeta: "Jakarta Selatan · 021-555-0101",
    score: 89.4,
  },
  {
    id: "RV-9922",
    refName: "Ananda Putri",
    refMeta: "ananda.p@domain.com",
    inputName: "Annanda Putri",
    inputMeta: "ananda.putri88@gmail.com",
    score: 72.1,
  },
  {
    id: "RV-9945",
    refName: "CV Makmur Abadi",
    refMeta: "NPWP 01.222.333.4-001",
    inputName: "Makmur Abadi, CV",
    inputMeta: "NPWP 012223334001",
    score: 96.2,
  },
  {
    id: "RV-9946",
    refName: "Jl. Merdeka No. 12, Bandung",
    refMeta: "Postal 40111",
    inputName: "Jalan Merdeka 12 Bandung",
    inputMeta: "Postal 40-111",
    score: 84.5,
  },
];

export const qualityBreakdown = [
  { label: "Complete Records", value: 92, color: "success" as const },
  { label: "Standardized Formats", value: 78, color: "accent" as const },
  { label: "Unique Identifiers", value: 88, color: "success" as const },
  { label: "Missing Values", value: 12, color: "warning" as const },
];

export const insights = [
  {
    title: "Enable phonetic search optimization",
    body: "Kolom nama usaha memiliki variasi penulisan. Strategi kandidat fonetik dapat membantu pencarian kandidat",
    action: "Apply suggestion",
  },
  {
    title: "Weight NPWP higher",
    body: "NPWP is 99.8% unique in reference set. Increase weight to 0.9 for stronger deterministic matching.",
    action: "Update rule",
  },
  {
    title: "Address normalization needed",
    body: "42% of addresses use 'Jl.' while reference uses 'Jalan'. Enable Address preset to reduce false negatives.",
    action: "Enable preset",
  },
];

export const wizardSteps = [
  { id: 1, title: "Persiapan Data", desc: "Upload, profil & mapping" },
  { id: 2, title: "Aturan Pencocokan", desc: "Konfigurasi & eksekusi" },
  { id: 3, title: "Review & Hasil", desc: "Evaluasi & ekspor" },
];

export const synchronizationSummary = {
  droppedMatched: "12,482",
  appendedUnmatched: "45",
  updatedReference: "8,736",
  conflictsToReview: "214",
  finalReferenceSize: "186,547",
};

export const columnProfile = [
  { name: "id_usaha", type: "STRING", nulls: "0.0%", unique: "100%", pattern: "US-#####", flag: "Primary key candidate" },
  { name: "company_name", type: "STRING", nulls: "0.2%", unique: "94.1%", pattern: "[Legal Entity] Name", flag: "High signal" },
  { name: "npwp", type: "STRING", nulls: "3.4%", unique: "99.8%", pattern: "##.###.###.#-###", flag: "Strict match" },
  { name: "address", type: "TEXT", nulls: "1.1%", unique: "88.3%", pattern: "Street + City", flag: "Needs normalization" },
  { name: "phone", type: "STRING", nulls: "4.7%", unique: "91.2%", pattern: "+62 / 0##", flag: "Standardize format" },
  { name: "email", type: "STRING", nulls: "8.9%", unique: "96.5%", pattern: "user@domain", flag: "Exact match preferred" },
];

export const matchedRecords = [
  { id: "MR-10021", ref: "PT Global Tech Solutions", input: "PT Global Tech Solutions", score: 100, method: "Exact", date: "10:24 AM" },
  { id: "MR-10022", ref: "Starlight Ventures Ltd.", input: "Starlight Ventures", score: 97.2, method: "Fuzzy", date: "10:24 AM" },
  { id: "MR-10023", ref: "Nakamura Systems Indonesia", input: "Nakamura Systems ID", score: 94.8, method: "Token", date: "10:23 AM" },
  { id: "MR-10024", ref: "CV Sinar Terang", input: "Sinar Terang, CV", score: 98.1, method: "Token", date: "10:23 AM" },
  { id: "MR-10025", ref: "Bank Mandiri Cabang Sudirman", input: "BANK MANDIRI - SUDIRMAN", score: 91.3, method: "Fuzzy", date: "10:22 AM" },
];

export const auditTrail = [
  { time: "10:24 AM", user: "Reviewer", action: "Approved match", target: "MR-10022 (PT Cahaya Nusantara)" },
  { time: "10:21 AM", user: "Reviewer", action: "Changed threshold", target: "0.85 -> 0.88" },
  { time: "10:18 AM", user: "System", action: "Job completed", target: "MJ-2481 (24,109 records)" },
  { time: "10:04 AM", user: "System", action: "Job started", target: "MJ-2481" },
  { time: "09:58 AM", user: "Operator", action: "Uploaded file", target: "prelist_usaha.csv (12.4 MB)" },
];