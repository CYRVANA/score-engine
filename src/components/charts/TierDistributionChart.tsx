/**
 * Tier distribution chart — horizontal bars, one per tier.
 *
 * Pure SVG, no library. The bar widths are normalized against the max count
 * so the longest bar fills the available width; shorter bars proportional.
 */

type ChartBucket = {
  label: string;
  range: string;
  count: number;
  color_hint: "brand" | "muted" | "amber";
};

const COLOR_BY_HINT: Record<ChartBucket["color_hint"], string> = {
  brand: "var(--color-brand)",
  muted: "var(--color-muted)",
  amber: "#d97706",
};

export function TierDistributionChart({ buckets }: { buckets: ChartBucket[] }) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  if (total === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background p-6 text-center">
        <p className="text-sm text-muted">No completions yet in this window.</p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {buckets.map((b, idx) => {
        const widthPct = (b.count / maxCount) * 100;
        const sharePct = total > 0 ? (b.count / total) * 100 : 0;
        return (
          <li key={idx}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">
                {b.label}
                <span className="ml-2 text-xs font-normal text-muted">
                  ({b.range})
                </span>
              </span>
              <span className="text-xs text-muted">
                <span className="font-semibold text-foreground">{b.count}</span> ·{" "}
                {sharePct.toFixed(1)}%
              </span>
            </div>
            <div className="relative h-7 overflow-hidden rounded-md bg-border/30">
              <div
                className="absolute inset-y-0 left-0 rounded-md"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: COLOR_BY_HINT[b.color_hint],
                }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
