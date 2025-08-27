import React from 'react';

interface SkillChartProps {
  data: number[];
  className?: string;
  height?: number;
}

const SkillChart: React.FC<SkillChartProps> = ({
  data,
  className = "",
  height = 120
}) => {
  console.log('[SkillChart] Rendering with data:', data);
  const generateDateLabels = (count: number) => {
    const labels: string[] = [];
    const now = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }));
    }
    return labels;
  };

  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground">No data available</div>;
  }

  const dateLabels = generateDateLabels(data.length);
  const w = 280;
  const h = 80;
  const pad = 8;
  const axisPad = 20;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(1, max - min);

  const pts = data.map((v, i) => {
    const x = axisPad + (i * (w - axisPad * 2)) / Math.max(1, data.length - 1);
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

  // Generate grid lines
  const yGridLines = [0, 25, 50, 75, 100].map(level => {
    const y = pad + (h - pad * 2) * (1 - level / 100);
    return `M${axisPad},${y} L${w - axisPad},${y}`;
  });

  const xGridLines = pts.map((pt, i) => {
    if (i % 3 === 0) { // Every 3rd point for readability
      return `M${pt[0]},${pad} L${pt[0]},${h - pad}`;
    }
    return null;
  }).filter(Boolean);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${w} ${h + 40}`}
        role="img"
        aria-label="skill progress chart"
        style={{ height: height + 40, width: '100%' }}
      >
        {/* Grid lines */}
        <defs>
          <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 0 0 L 0 1 1 1 1 0 Z" fill="none" stroke="hsl(var(--border))" strokeWidth="0.1" opacity="0.3"/>
          </pattern>
        </defs>

        {/* Main axis lines */}
        <line x1={axisPad} y1={pad} x2={axisPad} y2={h - pad} stroke="hsl(var(--foreground))" strokeWidth="1" opacity="0.6" />
        <line x1={axisPad} y1={h - pad} x2={w - axisPad} y2={h - pad} stroke="hsl(var(--foreground))" strokeWidth="1" opacity="0.6" />

        {/* Y-axis grid lines */}
        {yGridLines.map((line, i) => (
          <path key={`y-grid-${i}`} d={line} fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.2" />
        ))}

        {/* X-axis grid lines */}
        {xGridLines.map((line, i) => (
          <path key={`x-grid-${i}`} d={line!} fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.2" />
        ))}

        {/* Chart line */}
        <path d={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points */}
        {pts.map((pt, i) => (
          <circle key={`point-${i}`} cx={pt[0]} cy={pt[1]} r="3" fill="hsl(var(--primary))" />
        ))}

        {/* Y-axis labels */}
        {[0, 25, 50, 75, 100].map(level => {
          const y = pad + (h - pad * 2) * (1 - level / 100);
          return (
            <g key={`y-label-${level}`}>
              <text x={axisPad - 8} y={y + 3} textAnchor="end" className="text-xs fill-current text-muted-foreground" fontSize="10">
                {level}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {pts.map((pt, i) => {
          if (i % 3 === 0 && dateLabels[i]) { // Every 3rd point
            return (
              <g key={`x-label-${i}`}>
                <text x={pt[0]} y={h + 12} textAnchor="middle" className="text-xs fill-current text-muted-foreground" fontSize="9">
                  {dateLabels[i]}
                </text>
              </g>
            );
          }
          return null;
        })}

        {/* Axis labels */}
        <text x={axisPad - 15} y={h / 2} textAnchor="middle" className="text-xs fill-current text-muted-foreground" fontSize="10" transform={`rotate(-90, ${axisPad - 15}, ${h / 2})`}>
          Level (%)
        </text>
        <text x={w / 2} y={h + 35} textAnchor="middle" className="text-xs fill-current text-muted-foreground" fontSize="10">
          Date
        </text>
      </svg>
    </div>
  );
};

export default SkillChart;
