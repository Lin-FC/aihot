export function CreatorScore({ label, value }: { label: string; value: number }) {
  const tone = value >= 80 ? "text-ok" : value >= 60 ? "text-accent" : value >= 40 ? "text-amber" : "text-ink-3";
  return (
    <div className="min-w-[82px] rounded-card bg-bg-sunk px-3 py-2 text-center ring-1 ring-line">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className={`num text-[20px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
