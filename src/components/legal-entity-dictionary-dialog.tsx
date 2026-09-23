import { useState, useMemo } from "react";
import {
  BookOpen,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  Globe2,
  ShieldCheck,
  Scale,
  Sparkles,
  Info,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  LEGAL_ENTITY_DICTIONARY,
  LegalEntityDefinition,
} from "@/lib/data-normalizer";

interface LegalEntityDictionaryDialogProps {
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function LegalEntityDictionaryDialog({
  trigger,
  defaultOpen = false,
  onOpenChange,
}: LegalEntityDictionaryDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    "all" | "badan_hukum" | "non_badan_hukum" | "asing"
  >("all");

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
      setActiveCategory("all");
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return LEGAL_ENTITY_DICTIONARY.filter((item) => {
      // Category filter
      if (activeCategory === "badan_hukum" && !item.isLegalEntity) return false;
      if (activeCategory === "non_badan_hukum" && item.isLegalEntity) return false;
      if (activeCategory === "asing" && item.category !== "asing") return false;

      // Query filter
      if (!q) return true;

      const inCanonical = item.canonical.toLowerCase().includes(q);
      const inFullName = item.fullName.toLowerCase().includes(q);
      const inLegalBasis = item.legalBasis.toLowerCase().includes(q);
      const inAliases = item.aliases.some((a) => a.toLowerCase().includes(q));

      return inCanonical || inFullName || inLegalBasis || inAliases;
    });
  }, [searchQuery, activeCategory]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 h-9 text-xs font-medium border-border/80 hover:bg-accent/60"
          >
            <BookOpen className="w-3.5 h-3.5 text-brand" />
            <span>Kamus Badan Usaha</span>
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-xl">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border bg-card/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center text-brand">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-bold tracking-tight">
                Kamus Master Referensi Badan Usaha
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Standar normalisasi bentuk badan usaha RI & Internasional (KUHD, UU No. 40/2007, UU Cipta Kerja & Format BPS/AHU)
              </DialogDescription>
            </div>
          </div>

          {/* Quick Explainer Callout */}
          <div className="mt-3.5 p-3 rounded-lg bg-primary/5 border border-primary/15 flex items-start gap-2.5 text-xs text-foreground/90">
            <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-brand">Prinsip Rematch:</span> Perbedaan penulisan seperti{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold text-[11px]">CV</code>,{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold text-[11px]">Commanditaire Vennootschap</code>, dan{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono font-bold text-[11px]">Persekutuan Komanditer</code> secara otomatis diakomodir menjadi bentuk baku yang sama{" "}
              (<Badge variant="secondary" className="px-1 py-0 text-[10px] font-bold">CV</Badge>). Nama inti usaha dibersihkan dari imbuhan sehingga pemadanan menjadi akurat.
            </div>
          </div>

          {/* Search & Category Filter */}
          <div className="mt-4 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari badan usaha, singkatan, kepanjangan (misal: CV, commanditaire, PT, yayasan)..."
                className="pl-8 h-9 text-xs bg-background"
              />
            </div>
            <Tabs
              value={activeCategory}
              onValueChange={(v) => setActiveCategory(v as typeof activeCategory)}
              className="w-full sm:w-auto"
            >
              <TabsList className="h-9 p-0.5 bg-muted/60 text-xs w-full sm:w-auto grid grid-cols-4 sm:flex">
                <TabsTrigger value="all" className="text-xs px-2.5 py-1">
                  Semua ({LEGAL_ENTITY_DICTIONARY.length})
                </TabsTrigger>
                <TabsTrigger value="badan_hukum" className="text-xs px-2.5 py-1">
                  Badan Hukum
                </TabsTrigger>
                <TabsTrigger value="non_badan_hukum" className="text-xs px-2.5 py-1">
                  Bukan BH
                </TabsTrigger>
                <TabsTrigger value="asing" className="text-xs px-2.5 py-1">
                  Asing / PMA
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </DialogHeader>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 divide-y divide-border/40">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Building2 className="w-9 h-9 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm font-medium">Tidak ada entitas yang cocok</p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                Coba gunakan kata kunci pencarian yang lain.
              </p>
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={`${item.no}-${item.canonical}-${item.fullName}`}
                className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="font-mono text-xs font-bold px-2 py-0.5 bg-brand text-brand-foreground hover:bg-brand">
                      {item.canonical}
                    </Badge>
                    {item.subForm && (
                      <Badge variant="outline" className="text-[11px] font-medium text-foreground">
                        {item.subForm}
                      </Badge>
                    )}
                    <span className="font-semibold text-foreground text-sm">
                      {item.fullName}
                    </span>
                    {item.isLegalEntity ? (
                      <Badge
                        variant="secondary"
                        className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold gap-1"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        Badan Hukum
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[10px] font-semibold gap-1"
                      >
                        <AlertCircle className="w-3 h-3" />
                        Bukan Badan Hukum
                      </Badge>
                    )}
                    {item.category === "asing" && (
                      <Badge
                        variant="outline"
                        className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 text-[10px] font-semibold gap-1"
                      >
                        <Globe2 className="w-3 h-3" />
                        Internasional / PMA
                      </Badge>
                    )}
                  </div>

                  {/* Aliases & Variations */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-muted-foreground font-medium">Variasi Penulisan:</span>
                    {item.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="inline-block px-1.5 py-0.5 rounded bg-muted/80 border border-border/60 text-[11px] font-mono text-foreground"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>

                  {/* Legal Basis & Origin */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-0.5">
                    <span className="flex items-center gap-1">
                      <Scale className="w-3 h-3 text-muted-foreground/70" />
                      <span>{item.legalBasis}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Globe2 className="w-3 h-3 text-muted-foreground/70" />
                      <span>Asal: {item.origin}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Info className="w-3 h-3 text-muted-foreground/70" />
                      <span>Posisi: {item.typicalPosition}</span>
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 border-t border-border bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Menampilkan {filteredItems.length} dari {LEGAL_ENTITY_DICTIONARY.length} entitas baku</span>
          <span className="hidden sm:inline">Terhubung otomatis dengan Mesin Matching & Normalizer</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
