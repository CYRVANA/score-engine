/**
 * Daily trend chart — line over the 30-day lookback window.
 *
 * Pure SVG. Uses viewBox so it scales fluidly. Sparse axis labels (start,
 * midpoint, end) to keep it readable on mobile widths.
 */

type Point = { date: string; count: number };

export function DailyTrendChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background p-6 text-center">
        <p className="text-sm text-muted">No data in this window.</p>
      </div>
    );
  }

  const W = 800;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 32 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxY = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? plotW / (data.length - 1) : plotW;

  const points = data.map((d, i) => ({
    x: PAD.left + i * stepX,
    y: PAD.top + plotH - (d.count / maxY) * plotH,
    date: d.date,
    count: d.count,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${PAD.left + plotW} ${PAD.top + plotH} L ${PAD.left} ${PAD.top + plotH} Z`;

  const totalCaptures = data.reduce((s, d) => s + d.count, 0);

  // Sparse x-axis labels: first, middle, last.
  const labelIndices = [0, Math.floor(data.length / 2), data.length - 1];

  // Sparse y-axis ticks: 0, midpoint, max.
  const yTicks = [0, Math.ceil(maxY / 2), maxY];

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-muted">Daily lead captures</p>
        <p className="text-xs text-muted">
          <span className="font-semibold text-foreground">{totalCaptures}</span> total
          over {data.length} days
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y-axis gridlines + labels */}
        {yTicks.map((tick) => {
          const y = PAD.top + plotH - (tick / maxY) * plotH;
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                y1={y}
                x2={PAD.left + plotW}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="2 4"
              />
              <text
                x={PAD.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--color-muted)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area under the line */}
        <path d={areaD} fill="var(--color-brand)" fillOpacity="0.1" />

        {/* The line itself */}
        <path d={pathD} fill="none" stroke="var(--color-brand)" strokeWidth="2" />

        {/* Dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="var(--color-brand)"
            stroke="white"
            strokeWidth="1.5"
          />
        ))}

        {/* X-axis labels */}
        {labelIndices.map((i) => {
          if (!points[i]) return null;
          const p = points[i];
          return (
            <text
              key={i}
              x={p.x}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--color-muted)"
            >
              {formatShortDate(p.date)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function formatShortDate(iso: string): string {
  // ISO date "YYYY-MM-DD" → "Mon DD" in local rendering
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
