import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ExtractionModal({
  isOpen,
  onClose,
  onConfirm,
  referenceColumns,
  inputColumns,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: any) => void;
  referenceColumns: { id: string; name: string }[];
  inputColumns: { id: string; name: string }[];
}) {
  const [extractLegalForm, setExtractLegalForm] = useState(true);
  const [extractCoreName, setExtractCoreName] = useState(true);
  const [applyTo, setApplyTo] = useState<"both" | "reference" | "input">("both");
  const [refSourceId, setRefSourceId] = useState("");
  const [inpSourceId, setInpSourceId] = useState("");

  const handleConfirm = () => {
    onConfirm({
      extractLegalForm,
      extractCoreName,
      applyTo,
      refSourceId,
      inpSourceId,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ekstrak Entitas & Nama Inti</DialogTitle>
          <DialogDescription>
            Ekstrak Badan Usaha (PT/CV) dan Nama Inti secara otomatis dari kolom nama perusahaan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <Label>Ekstrak Badan Usaha</Label>
            <Switch checked={extractLegalForm} onCheckedChange={setExtractLegalForm} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Ekstrak Nama Inti</Label>
            <Switch checked={extractCoreName} onCheckedChange={setExtractCoreName} />
          </div>

          <div className="space-y-2 pt-2">
            <Label>Terapkan Pada</Label>
            <Select value={applyTo} onValueChange={(v: any) => setApplyTo(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Keduanya (Reference & Input)</SelectItem>
                <SelectItem value="reference">Hanya Reference Dataset</SelectItem>
                <SelectItem value="input">Hanya Input Dataset</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(applyTo === "both" || applyTo === "reference") && (
            <div className="space-y-2">
              <Label>Kolom Sumber (Reference)</Label>
              <Select value={refSourceId} onValueChange={setRefSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Kolom..." />
                </SelectTrigger>
                <SelectContent>
                  {referenceColumns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(applyTo === "both" || applyTo === "input") && (
            <div className="space-y-2">
              <Label>Kolom Sumber (Input)</Label>
              <Select value={inpSourceId} onValueChange={setInpSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Kolom..." />
                </SelectTrigger>
                <SelectContent>
                  {inputColumns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleConfirm} disabled={(applyTo !== "input" && !refSourceId) || (applyTo !== "reference" && !inpSourceId) || (!extractLegalForm && !extractCoreName)}>
            Terapkan Ekstraksi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
