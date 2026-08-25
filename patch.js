const fs = require('fs');

let code = fs.readFileSync('src/routes/matching.tsx', 'utf8');

// 1. Add handleStopMatching in the main component
// Find the location just before handleInspectFile
const insertIndex = code.indexOf('const handleInspectFile = async');
if (insertIndex !== -1) {
    const fn = 
  const [isStopping, setIsStopping] = useState(false);

  const handleStopMatching = async () => {
    if (!runResult?.job?.id) return;
    if (!window.confirm("Apakah Anda yakin ingin membatalkan proses matching ini? Progres yang sudah berjalan akan disimpan.")) return;
    setIsStopping(true);
    try {
      await stopMatching(runResult.job.id);
      toast.success("Sinyal pembatalan terkirim. Menunggu backend berhenti...");
    } catch (error) {
      toast.error("Gagal menghentikan matching.");
    } finally {
      setIsStopping(false);
    }
  };
    
  ;
    code = code.substring(0, insertIndex) + fn + code.substring(insertIndex);
} else {
    console.log("Could not find handleInspectFile");
}

// 2. Pass onStop to StepRunCard (around line 1309 where onStart is)
code = code.replace(
    'onStart={() => setRunConfirmOpen(true)}',
    'onStart={() => setRunConfirmOpen(true)}\n                      onStop={handleStopMatching}'
);

// 3. Update StepRunCard props
code = code.replace(
    /onProceed:\s*\(\)\s*=>\s*void;\s*canRun:\s*boolean;\s*hasPreviousRun:\s*boolean;\s*}\)/g,
    'onProceed: () => void;\n  canRun: boolean;\n  hasPreviousRun: boolean;\n  onStop?: () => void;\n})'
);
code = code.replace(
    /hasPreviousRun,\n}:\s*\{/g,
    'hasPreviousRun,\n  onStop,\n}: {'
);

// 4. Update StepRunCard render for "running" state
code = code.replace(
    /\{state === "running" && \(\s*<div className="space-y-1\.5">\s*<div className="h-2 w-full overflow-hidden rounded-full bg-secondary">\s*<div\s*className="h-full bg-brand transition-all duration-300 rounded-full"\s*style=\{\{ width: \$\{progress\}% \}\}\s*\/>\s*<\/div>\s*\{result\?\.progress\?\.total \? \(\s*<p className="text-xs text-muted-foreground tabular-nums text-right">\s*\{result\.progress\.processed\.toLocaleString\(\)\} \/ \{result\.progress\.total\.toLocaleString\(\)\} data diproses\s*<\/p>\s*\) : null\}\s*<\/div>\s*\)/g,
    {state === "running" && (
        <div className="space-y-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-brand transition-all duration-300 rounded-full"
              style={{ width: \\%\ }}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            {onStop && (
              <button
                type="button"
                onClick={onStop}
                className="text-xs font-medium text-destructive hover:text-destructive/80"
              >
                Batalkan
              </button>
            )}
            {result?.progress?.total ? (
              <p className="text-xs text-muted-foreground tabular-nums text-right flex-1">
                {result.progress.processed.toLocaleString()} / {result.progress.total.toLocaleString()} data diproses
              </p>
            ) : <div className="flex-1" />}
          </div>
        </div>
      )}
);

// 5. Update pollMatchingJob to handle "cancelled" and "stopped"
code = code.replace(
    /if \(currentStatus === "completed"\) \{/g,
    \if (currentStatus === "completed" || currentStatus === "cancelled" || currentStatus === "stopped") {\
);

fs.writeFileSync('src/routes/matching.tsx', code);
console.log("Patched successfully");
