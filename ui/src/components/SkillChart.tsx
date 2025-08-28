import React from 'react';

interface SkillChartProps {
  data: number[];
  className?: string;
  height?: number;
  // visual options
  strokeWidth?: number; // line thickness
  showArea?: boolean; // fill under line
  showAxes?: boolean; // draw axes/grid
  showHover?: boolean; // interactive hover guideline/tooltip
  // axis labels
  xLabel?: string;
  yLabel?: string;
  xTickLabels?: string[]; // custom labels for x-axis ticks
  yTickLabels?: string[]; // custom labels for y-axis ticks
}

const SkillChart: React.FC<SkillChartProps> = ({
  data,
  className = "",
  height = 120,
  strokeWidth = 1.25,
  showArea = false,
  showAxes = true,
  showHover = true,
  xLabel = "Days ago",
  yLabel = "Level",
  xTickLabels,
  yTickLabels,
}) => {
  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground">No data available</div>;
  }

  const w = 280;
  const h = 80;
  const pad = 8; // inner padding
  const axisPad = 24; // left/right padding for nicer breathing room with labels
  const labelPad = 16; // additional padding for axis labels

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);

  const pts = data.map((v, i) => {
    const x = axisPad + (i * (w - axisPad * 2)) / Math.max(1, data.length - 1);
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  // Catmull-Rom to Bezier smoothing
  const smoothPath = (points: ReadonlyArray<readonly [number, number]>) => {
    if (points.length < 2) return '';
    const p = points as [number, number][];
    let d = `M${p[0][0].toFixed(2)},${p[0][1].toFixed(2)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(p.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };

  const pathD = smoothPath(pts);
  const bottom = h - pad;
  const areaD = `${pathD} L${pts[pts.length - 1][0].toFixed(2)},${bottom} L${pts[0][0].toFixed(2)},${bottom} Z`;

  // Simple y-ticks at min, mid, max
  const yTicks = showAxes ? [min, min + (span / 2), max] : [];
  const yToSvg = (v: number) => pad + (h - pad * 2) * (1 - (v - min) / span);

  // Generate tick labels if not provided
  const defaultXTickLabels = xTickLabels || (data.length >= 3 ? [
    `${Math.floor(data.length * 2 / 3)} days ago`,
    `${Math.floor(data.length / 3)} days ago`,
    'Today'
  ] : ['Start', 'Mid', 'End']);

  const defaultYTickLabels = yTickLabels || (yTicks.length === 3 ? [
    '1',
    '5',
    '10'
  ] : yTicks.map(v => Math.round(v).toString()));

  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const handleMove = showHover ? (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const svgX = (relX / rect.width) * w;
    // Find nearest point by x
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = Math.abs(svgX - pts[i][0]);
      if (dx < best) { best = dx; nearest = i; }
    }
    setHoverIdx(nearest);
  } : () => {};
  const handleLeave = showHover ? () => setHoverIdx(null) : () => {};

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${w} ${h + labelPad + 18}`}
        role="img"
        aria-label="skill progress chart"
        style={{ height, width: '100%' }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <defs>
          <linearGradient id="cu-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
          </linearGradient>
          <linearGradient id="cu-area" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Axes and grid */}
        {showAxes && (
          <>
            {/* X-axis baseline */}
            <line x1={axisPad} y1={bottom} x2={w - axisPad} y2={bottom} stroke="#888" strokeWidth="1" opacity="1" />
            {/* Y-axis at left */}
            <line x1={axisPad} y1={pad} x2={axisPad} y2={bottom} stroke="#888" strokeWidth="1" opacity="1" />
            {/* Horizontal grid lines */}
            {yTicks.map((v, i) => (
              <line key={i} x1={axisPad} x2={w - axisPad} y1={yToSvg(v)} y2={yToSvg(v)} stroke="#888" strokeWidth={i === 0 || i === yTicks.length - 1 ? 1 : 0.5} opacity="0.6" />
            ))}
            {/* Y-axis tick marks */}
            {yTicks.map((v, i) => (
              <line key={`tick-${i}`} x1={axisPad - 2} x2={axisPad + 2} y1={yToSvg(v)} y2={yToSvg(v)} stroke="#888" strokeWidth="1" opacity="1" />
            ))}
            {/* Y-axis tick labels */}
            {yTicks.map((v, i) => (
              <text key={`ylabel-${i}`} x={axisPad - 6} y={yToSvg(v) + 3} textAnchor="end" fontSize="8" fill="#666" opacity="0.8">
                {defaultYTickLabels[i]}
              </text>
            ))}
            {/* X-axis tick marks and labels */}
            {data.length >= 3 && (
              <>
                {[0, Math.floor(data.length / 3), Math.floor(data.length * 2 / 3), data.length - 1].map((idx, i) => {
                  if (idx >= pts.length) return null;
                  const x = pts[idx][0];
                  return (
                    <g key={`xtick-${i}`}>
                      <line x1={x} y1={bottom} x2={x} y2={bottom + 3} stroke="#888" strokeWidth="1" opacity="1" />
                      <text x={x} y={bottom + 12} textAnchor="middle" fontSize="8" fill="#666" opacity="0.8">
                        {defaultXTickLabels[Math.min(i, defaultXTickLabels.length - 1)]}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
            {/* Axis labels */}
            <text x={w / 2} y={h + labelPad} textAnchor="middle" fontSize="9" fill="#666" opacity="0.9" fontWeight="500">
              {xLabel}
            </text>
            <text x={axisPad - labelPad} y={h / 2} textAnchor="middle" fontSize="9" fill="#666" opacity="0.9" fontWeight="500" transform={`rotate(-90, ${axisPad - labelPad}, ${h / 2})`}>
              {yLabel}
            </text>
          </>
        )}

        {/* Area fill (optional) */}
        {showArea && <path d={areaD} fill="url(#cu-area)" stroke="none" />}

        {/* Line */}
        <path d={pathD} fill="none" stroke="url(#cu-line)" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />

        {/* Hover hairline + tooltip (optional) */}
        {showHover && hoverIdx !== null && (
          <>
            <line x1={pts[hoverIdx][0]} y1={pad} x2={pts[hoverIdx][0]} y2={bottom} stroke="hsl(var(--foreground))" strokeWidth="1" opacity="0.2" />
            {/* tiny marker for clarity */}
            <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r="2" fill="hsl(var(--primary))" />
            {/* tooltip */}
            {(() => {
              const x = pts[hoverIdx][0];
              const y = pts[hoverIdx][1] - 10;
              const val = data[hoverIdx];
              const boxW = 34;
              const boxH = 16;
              const bx = Math.min(Math.max(x - boxW / 2, 2), w - boxW - 2);
              const by = Math.max(y - boxH, 2);
              return (
                <g>
                  <rect x={bx} y={by} rx={3} ry={3} width={boxW} height={boxH} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.95" />
                  <text x={bx + boxW / 2} y={by + boxH / 2 + 3} textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">{val}</text>
                </g>
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
};

export default SkillChart;
