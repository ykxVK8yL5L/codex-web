export function PreviewDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="preview-detail-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}
