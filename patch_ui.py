import re

with open('src/routes/matching.tsx', 'r') as f:
    code = f.read()

ui_old = """          <div className="flex justify-between items-center mt-2">
            {onStop ? (
              <button
                type="button"
                onClick={onStop}
                className="text-xs font-medium text-destructive hover:text-destructive/80"
              >
                Batalkan Matching
              </button>
            ) : <div />}
            {result?.progress?.total ? ("""

ui_new = """          <div className="flex justify-between items-center mt-2">
            <div className="flex items-center gap-3">
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="text-xs font-medium text-destructive hover:text-destructive/80"
                >
                  Batalkan Matching
                </button>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono hidden sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                  <Sparkles className="w-3 h-3 text-emerald-500"/>
                  Meilisearch Engine: Generating Candidates (MultiSearch Batch Mode)
                </span>
              </div>
            </div>
            {result?.progress?.total ? ("""

code = code.replace(ui_old, ui_new)

with open('src/routes/matching.tsx', 'w') as f:
    f.write(code)
print("PATCHED UI")
