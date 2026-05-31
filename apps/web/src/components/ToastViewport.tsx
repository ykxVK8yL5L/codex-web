import { X } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

type ToastTone = "info" | "success" | "error";
type ToastState = { id: number; message: string; tone: ToastTone };
type TFunction = (key: TranslationKey) => string;

export function ToastViewport({ toast, onClose, t }: { toast: ToastState | null; onClose: () => void; t: TFunction }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button type="button" aria-label={t("action.close")} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
