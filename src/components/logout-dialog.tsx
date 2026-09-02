import { LogOut, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePreferences } from "@/lib/preferences";

interface LogoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  isLoading?: boolean;
}

export function LogoutDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: LogoutDialogProps) {
  const { language } = usePreferences();
  const isId = language === "id";

  const title = isId ? "Konfirmasi Keluar" : "Confirm Logout";
  const description = isId
    ? "Apakah Anda yakin ingin keluar dari aplikasi? Sesi Anda saat ini akan diakhiri dan Anda perlu masuk kembali untuk mengakses workspace."
    : "Are you sure you want to log out of the application? Your active session will end and you will need to sign in again to access workspaces.";
  const cancelLabel = isId ? "Batal" : "Cancel";
  const confirmLabel = isId ? "Ya, Keluar" : "Log out";
  const loggingOutLabel = isId ? "Mengeluarkan..." : "Logging out...";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-xl border border-border bg-card p-6 shadow-xl animate-in fade-in-0 zoom-in-95">
        <AlertDialogHeader className="space-y-3 sm:text-left">
          <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <LogOut className="size-5" />
          </div>
          <div>
            <AlertDialogTitle className="text-base font-semibold text-foreground">
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
              {description}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialogCancel
            disabled={isLoading}
            className="rounded-lg border border-border bg-background px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer transition-colors"
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground shadow-xs hover:bg-destructive/90 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                <span>{loggingOutLabel}</span>
              </>
            ) : (
              <>
                <LogOut className="size-3.5" />
                <span>{confirmLabel}</span>
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
