import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey) => string;

type DialogOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  multiline?: boolean;
  checkboxLabel?: string;
  checkboxDefaultChecked?: boolean;
};

type DialogCheckboxResult = { confirmed: boolean; checked: boolean };

type DialogState =
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & DialogOptions)
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & DialogOptions)
  | ({ kind: "confirm-checkbox"; resolve: (value: DialogCheckboxResult) => void } & DialogOptions);

export function useAppDialog(t?: TFunction) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const prompt = useCallback((options: DialogOptions) => new Promise<string | null>((resolve) => {
    setDialog({ ...options, kind: "prompt", resolve });
  }), []);

  const confirm = useCallback((options: DialogOptions) => new Promise<boolean>((resolve) => {
    setDialog({ ...options, kind: "confirm", resolve });
  }), []);

  const confirmWithCheckbox = useCallback((options: DialogOptions) => new Promise<DialogCheckboxResult>((resolve) => {
    setDialog({ ...options, kind: "confirm-checkbox", resolve });
  }), []);

  const close = useCallback((value: string | boolean | DialogCheckboxResult | null) => {
    setDialog((current) => {
      if (!current) return current;
      if (current.kind === "prompt") current.resolve(typeof value === "string" ? value : null);
      if (current.kind === "confirm") current.resolve(Boolean(value));
      if (current.kind === "confirm-checkbox") current.resolve(typeof value === "object" && value ? value : { confirmed: false, checked: Boolean(current.checkboxDefaultChecked) });
      return null;
    });
  }, []);

  return {
    prompt,
    confirm,
    confirmWithCheckbox,
    node: dialog ? <AppDialog dialog={dialog} onClose={close} t={t} /> : null,
  };
}

function AppDialog({ dialog, onClose, t }: { dialog: DialogState; onClose: (value: string | boolean | DialogCheckboxResult | null) => void; t?: TFunction }) {
  const [value, setValue] = useState(dialog.defaultValue ?? "");
  const [checked, setChecked] = useState(Boolean(dialog.checkboxDefaultChecked));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (dialog.kind === "confirm-checkbox") {
      onClose({ confirmed: true, checked });
      return;
    }
    onClose(dialog.kind === "prompt" ? value : true);
  }

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-backdrop" type="button" aria-label={t?.("action.close") ?? "Close"} onClick={() => onClose(dialog.kind === "prompt" ? null : false)} />
      <form className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <strong id="dialog-title">{dialog.title}</strong>
            {dialog.message && <p>{dialog.message}</p>}
          </div>
          <button className="drawer-close" type="button" onClick={() => onClose(dialog.kind === "prompt" ? null : false)} title={t?.("action.close") ?? "Close"}>
            <X size={16} />
          </button>
        </div>
        {dialog.kind === "prompt" && (
          dialog.multiline ? (
            <textarea name="textarea" ref={(node) => { inputRef.current = node; }} value={value} rows={5} placeholder={dialog.placeholder} onChange={(event) => setValue(event.target.value)} />
          ) : (
            <input name="input" ref={(node) => { inputRef.current = node; }} value={value} placeholder={dialog.placeholder} onChange={(event) => setValue(event.target.value)} />
          )
        )}
        {dialog.kind === "confirm-checkbox" && dialog.checkboxLabel && (
          <label className="dialog-checkbox">
            <input name="checked" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <span>{dialog.checkboxLabel}</span>
          </label>
        )}
        <div className="dialog-actions">
          <button className="ghost-button" type="button" onClick={() => onClose(dialog.kind === "prompt" ? null : false)}>
            {dialog.cancelLabel ?? t?.("dialog.cancel") ?? "Cancel"}
          </button>
          <button className={`dark-button ${dialog.danger ? "danger-solid" : ""}`} type="submit">
            {dialog.confirmLabel ?? (dialog.kind === "prompt" ? t?.("dialog.save") ?? "Save" : t?.("dialog.confirm") ?? "Confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
