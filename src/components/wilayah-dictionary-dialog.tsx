import { useState, useMemo } from "react";
import {
  MapPin,
  Search,
  Building2,
  Compass,
  CheckCircle2,
  ArrowRight,
  Filter,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  WILAYAH_PROVINCES_LIST,
  WILAYAH_REGENCIES_LIST,
  RegencyItem,
  resolveRegency,
} from "@/lib/wilayah-normalizer";

interface WilayahDictionaryDialogProps {
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function WilayahDictionaryDialog({
  trigger,
  defaultOpen = false,
  onOpenChange,
}: WilayahDictionaryDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProv, setSelectedProv] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<"all" | "KABUPATEN" | "KOTA">("all");

  // Interactive Simulator state
  const [testProvInput, setTestProvInput] = useState("35");
  const [testKabInput, setTestKabInput] = useState("15");

  const simulationResult = useMemo(() => {
    return resolveRegency(testKabInput, testProvInput);
  }, [testProvInput, testKabInput]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
      setSelectedProv("all");
      setSelectedType("all");
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return WILAYAH_REGENCIES_LIST.filter((item: RegencyItem) => {
      // Province filter
      if (selectedProv !== "all" && item.kd_prov !== selectedProv) {
        return false;
      }

      // Type filter
      if (selectedType !== "all" && item.tipe !== selectedType) {
        return false;
      }

      // Query filter
      if (!q) return true;

      const inCode = item.id_kab.includes(q) || item.kd_kab.includes(q) || item.kd_prov.includes(q);
      const inName = item.nm_kab.toLowerCase().includes(q) || item.full_name.toLowerCase().includes(q);
      const inProvName = item.nm_prov.toLowerCase().includes(q);

      return inCode || inName || inProvName;
    });
  }, [searchQuery, selectedProv, selectedType]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span>Kamus Wilayah (MFD)</span>
            <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
              514 Kab/Kota
            </Badge>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden sm:rounded-xl">
        <DialogHeader className="p-5 pb-3 border-b border-border/70 bg-secondary/15">
          <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
            <Compass className="h-4 w-4" />
            <span>Master File Desa (MFD BPS 2025 Semester 2)</span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground flex items-center justify-between">
            <span>Kamus Standardisasi Kode Wilayah BPS</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Standarisasi kode numerik dan nama wilayah BPS (38 Provinsi, 514 Kabupaten/Kota, 7.288 Kecamatan, 84.291 Desa).
            Sistem secara otomatis menghubungkan kode 2-digit, kode 4-digit (IDKAB), serta teks nama kabupaten/kota.
          </DialogDescription>

          {/* Quick Interactive Resolver Sandbox */}
          <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs">
            <div className="font-semibold text-foreground flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <span>Simulasi Resolusi Kode Wilayah Otomatis</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Kode Prov:</span>
                <Input
                  value={testProvInput}
                  onChange={(e) => setTestProvInput(e.target.value)}
                  placeholder="35"
                  className="h-7 w-16 text-xs text-center font-mono"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Kode / Nama Kab:</span>
                <Input
                  value={testKabInput}
                  onChange={(e) => setTestKabInput(e.target.value)}
                  placeholder="15 / Sidoarjo"
                  className="h-7 w-28 text-xs font-mono"
                />
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="flex items-center gap-1.5 font-medium">
                {simulationResult ? (
                  <span className="rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-1 font-semibold">
                    [{simulationResult.id_kab}] {simulationResult.full_name} ({simulationResult.nm_prov})
                  </span>
                ) : (
                  <span className="rounded bg-destructive/15 text-destructive px-2 py-1">
                    Wilayah Tidak Ditemukan
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Filter & Search Bar */}
        <div className="p-4 border-b border-border/70 flex flex-wrap items-center gap-3 bg-background">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode (misal 3515, 35) atau nama wilayah (Sidoarjo, Surabaya)..."
              className="pl-8 h-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={selectedProv}
              onChange={(e) => setSelectedProv(e.target.value)}
              className="h-9 text-xs border border-border rounded-md px-2 bg-background focus:ring-1 focus:ring-primary"
            >
              <option value="all">Semua Provinsi (38)</option>
              {WILAYAH_PROVINCES_LIST.map((prov) => (
                <option key={prov.kd_prov} value={prov.kd_prov}>
                  [{prov.kd_prov}] {prov.nm_prov}
                </option>
              ))}
            </select>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as "all" | "KABUPATEN" | "KOTA")}
              className="h-9 text-xs border border-border rounded-md px-2 bg-background focus:ring-1 focus:ring-primary"
            >
              <option value="all">Semua Tipe</option>
              <option value="KABUPATEN">Kabupaten</option>
              <option value="KOTA">Kota</option>
            </select>
          </div>
        </div>

        {/* List of Regencies */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Tidak ada wilayah yang cocok dengan pencarian "{searchQuery}".
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredItems.slice(0, 100).map((item) => (
                <div
                  key={item.id_kab}
                  className="rounded-lg border border-border/80 bg-card p-3 hover:border-primary/50 transition-colors flex items-start justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {item.id_kab}
                      </span>
                      <span className="font-semibold text-xs text-foreground">
                        {item.full_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                      <span>Provinsi: {item.nm_prov} ({item.kd_prov})</span>
                      <span>•</span>
                      <span>Kd Kab: {item.kd_kab}</span>
                    </div>
                  </div>

                  <Badge
                    variant={item.tipe === "KOTA" ? "default" : "secondary"}
                    className="text-[10px] shrink-0"
                  >
                    {item.tipe}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {filteredItems.length > 100 && (
            <div className="text-center py-2 text-xs text-muted-foreground">
              Menampilkan 100 dari {filteredItems.length} wilayah. Persempit pencarian untuk hasil lebih spesifik.
            </div>
          )}
        </div>

        <div className="p-3 border-t border-border/70 bg-secondary/10 flex items-center justify-between text-xs text-muted-foreground">
          <span>Total Referensi MFD BPS: 38 Provinsi, 514 Kab/Kota</span>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)} className="h-7 text-xs">
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
