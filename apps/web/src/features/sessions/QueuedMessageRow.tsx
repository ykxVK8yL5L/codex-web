import { useEffect, useState } from "react";
import { GripVertical } from "lucide-react";
import type { QueuedMessage } from "@codex-web/protocol";
import type { TFunction } from "@/features/sessions/utils";

export function QueuedMessageRow({
  item,
  index,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onSave,
  onDelete,
  t,
}: {
  item: QueuedMessage;
  index: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onSave: (prompt: string) => Promise<void>;
  onDelete: () => Promise<void>;
  t: TFunction;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.prompt);

  useEffect(() => {
    setDraft(item.prompt);
  }, [item.prompt]);

  return (
    <div
      className={`queue-item ${dragging ? "dragging" : ""}`}
      draggable={!editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropOn();
      }}
    >
      <span className="queue-index">{index + 1}</span>
      <span className="queue-drag-handle" title={t("action.more")} aria-hidden="true"><GripVertical size={15} /></span>
      {editing ? (
        <textarea name="draft" value={draft} rows={2} onChange={(event) => setDraft(event.target.value)} />
      ) : (
        <div className="queue-text">{item.prompt}</div>
      )}
      <div className="queue-actions">
        {editing ? (
          <button className="ghost-button" type="button" onClick={() => {
            void onSave(draft);
            setEditing(false);
          }}>{t("action.save")}</button>
        ) : (
          <button className="ghost-button" type="button" onClick={() => setEditing(true)}>{t("action.edit")}</button>
        )}
        <button className="ghost-button" type="button" onClick={() => void onDelete()}>{t("action.delete")}</button>
      </div>
    </div>
  );
}
