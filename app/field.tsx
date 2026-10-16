"use client";

// Football field graphics for live games: a drive chart for the current
// drive (every snap as an arrow, line of scrimmage, line to gain, ball), and
// a mini strip for single plays in the play-by-play feed. The offense always
// attacks to the right.

import type { DriveView, FieldMove } from "@/lib/playbyplay";

const RESULT_COLOR: Record<FieldMove["result"], string> = {
  gain: "var(--color-mint-400)",
  td: "var(--color-hot)",
  loss: "var(--color-rose-300)",
  turnover: "var(--color-rose-400)",
  incomplete: "var(--color-ink-400)",
  kick: "#fde047",
  miss: "var(--color-rose-300)",
  penalty: "#fbbf24",
};
const FIRST_DOWN = "#facc15";
const hex = (c: string | null, fallback: string) => (c ? `#${c}` : fallback);
/** Dark lettering on very light team colors (e.g. white), white otherwise. */
function textOn(c: string | null): string {
  if (!c || !/^[0-9a-f]{6}$/i.test(c)) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 186 ? "#0e1338" : "#ffffff";
}
/** "Own 34" / "SEA 34" / "Goal". */
function spotText(yard: number, defense: string) {
  const y = Math.round(yard);
  if (y >= 100) return "End zone";
  if (y === 50) return "Midfield";
  return y < 50 ? `Own ${y}` : `${defense} ${100 - y}`;
}

// --- Drive chart ---------------------------------------------------------------

const ROW = 46;
const TOP = 44;

const MAX_ROWS = 8;

export function DriveChart({ d }: { d: DriveView }) {
  const x = (yard: number) => 100 + yard * 10;
  // Long drives: show the latest snaps so the chart stays compact.
  const plays = d.plays.slice(-MAX_ROWS);
  const height = TOP + Math.max(4, plays.length) * ROW + 30;
  const offColor = hex(d.offenseColor, "var(--color-ink-600)");
  const defColor = hex(d.defenseColor, "var(--color-ink-600)");
  return (
    <svg
      viewBox={`0 0 1200 ${height}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`${d.offense} drive: ${d.summary}. ${d.situation}.`}
    >
      {/* Turf, 10-yard bands */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect
          key={i}
          x={x(i * 10)}
          y={0}
          width={100}
          height={height}
          className={i % 2 ? "fill-ink-850" : "fill-ink-800"}
        />
      ))}
      {/* End zones in team colors */}
      <rect x={0} y={0} width={100} height={height} fill={offColor} opacity={0.85} />
      <rect x={1100} y={0} width={100} height={height} fill={defColor} opacity={0.85} />
      <text
        x={50}
        y={height / 2}
        transform={`rotate(-90 50 ${height / 2})`}
        textAnchor="middle"
        dominantBaseline="central"
        className="display"
        fill={textOn(d.offenseColor)}
        style={{ fontSize: 52, fontWeight: 900, letterSpacing: 6, opacity: 0.95 }}
      >
        {d.offense}
      </text>
      <text
        x={1150}
        y={height / 2}
        transform={`rotate(90 1150 ${height / 2})`}
        textAnchor="middle"
        dominantBaseline="central"
        className="display"
        fill={textOn(d.defenseColor)}
        style={{ fontSize: 52, fontWeight: 900, letterSpacing: 6, opacity: 0.95 }}
      >
        {d.defense}
      </text>
      {/* Yard lines and numbers */}
      {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((yd) => (
        <line
          key={yd}
          x1={x(yd)}
          x2={x(yd)}
          y1={0}
          y2={height}
          stroke="currentColor"
          className="text-ink-100"
          strokeOpacity={yd % 10 ? 0.06 : 0.16}
          strokeWidth={yd === 50 ? 3 : 2}
        />
      ))}
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => (
        <text
          key={yd}
          x={x(yd)}
          y={30}
          textAnchor="middle"
          className="display fill-ink-400"
          style={{ fontSize: 28, fontWeight: 800 }}
        >
          {yd <= 50 ? yd : 100 - yd}
        </text>
      ))}
      {/* Line to gain and line of scrimmage */}
      {d.firstDown !== null && d.firstDown < 100 && (
        <line x1={x(d.firstDown)} x2={x(d.firstDown)} y1={TOP - 6} y2={height} stroke={FIRST_DOWN} strokeWidth={5} />
      )}
      <line
        x1={x(d.ballOn)}
        x2={x(d.ballOn)}
        y1={TOP - 6}
        y2={height}
        stroke="var(--color-mint-400)"
        strokeWidth={4}
        opacity={0.9}
      />
      <defs>
        {Object.entries(RESULT_COLOR).map(([k, c]) => (
          <marker
            key={k}
            id={`arrow-${k}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="22"
            markerHeight="22"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {/* One row per snap */}
      {plays.map((p, i) => {
        const cy = TOP + i * ROW + ROW / 2;
        const m = p.move;
        const c = RESULT_COLOR[m.result];
        const mine = p.player !== null;
        const x1 = x(m.from);
        const x2 = x(m.to);
        const labelRight = Math.max(x1, x2) < 760;
        // Right of the arrowhead, or (near the far end zone) left of where the play started.
        const point = m.result === "incomplete" || m.result === "turnover";
        const labelX = labelRight ? (point ? x1 : Math.max(x1, x2)) + 30 : (point ? x1 : Math.min(x1, x2)) - 18;
        return (
          <g key={p.key}>
            {m.result === "incomplete" ? (
              <circle cx={x1} cy={cy} r={6} fill="none" stroke={c} strokeWidth={3} strokeDasharray="3 3" />
            ) : m.result === "turnover" ? (
              <path
                d={`M${x1 - 8} ${cy - 8} L${x1 + 8} ${cy + 8} M${x1 + 8} ${cy - 8} L${x1 - 8} ${cy + 8}`}
                stroke={c}
                strokeWidth={4}
              />
            ) : m.result === "kick" || m.result === "miss" ? (
              <path
                d={`M${x1} ${cy} Q ${(x1 + x2) / 2} ${cy - ROW * 0.9} ${x2} ${cy}`}
                fill="none"
                stroke={c}
                strokeWidth={4}
                strokeDasharray="10 6"
                markerEnd={`url(#arrow-${m.result})`}
              />
            ) : (
              <>
                <circle cx={x1} cy={cy} r={7} fill={c} />
                {Math.abs(x2 - x1) > 4 && (
                  <line
                    x1={x1}
                    x2={x2}
                    y1={cy}
                    y2={cy}
                    stroke={c}
                    strokeWidth={mine ? 10 : 6}
                    strokeLinecap="round"
                    markerEnd={`url(#arrow-${m.result})`}
                  />
                )}
              </>
            )}
            <text
              x={labelX}
              y={cy}
              dominantBaseline="central"
              textAnchor={labelRight ? "start" : "end"}
              className={mine ? "display fill-mint-300" : "fill-ink-300"}
              style={{ fontSize: mine ? 32 : 26, fontWeight: mine ? 800 : 600 }}
            >
              {mine ? `${p.player!.name.split(" ").slice(-1)[0]}: ${p.label}` : p.label}
              {mine && p.points !== null && p.points !== 0 ? ` (${p.points > 0 ? "+" : ""}${p.points.toFixed(1)})` : ""}
            </text>
          </g>
        );
      })}
      {/* The ball */}
      <g transform={`translate(${x(Math.min(99, d.ballOn))} ${height - 16})`}>
        <ellipse rx={20} ry={12} fill="#8b4513" stroke="#5a2d0c" strokeWidth={2} />
        <line x1={-6} x2={6} y1={0} y2={0} stroke="white" strokeWidth={2} />
        {[-3, 0, 3].map((t) => (
          <line key={t} x1={t} x2={t} y1={-3} y2={3} stroke="white" strokeWidth={1.5} />
        ))}
      </g>
    </svg>
  );
}

// --- Mini strip for one play ----------------------------------------------------

export function FieldStrip({ m }: { m: FieldMove }) {
  const x = (yard: number) => 10 + yard; // 0..120 with 10-unit end zones
  const c = RESULT_COLOR[m.result];
  const x1 = x(m.from);
  const x2 = x(m.to);
  return (
    <svg
      viewBox="0 0 120 10"
      className="mt-1.5 block h-3 w-full max-w-[260px]"
      role="img"
      aria-label={`${m.down ?? ""} from ${spotText(m.from, m.defense)} to ${spotText(m.to, m.defense)}`}
    >
      <title>{`${m.down ? `${m.down} · ` : ""}${spotText(m.from, m.defense)} → ${spotText(m.to, m.defense)}`}</title>
      <rect x={0} y={0} width={120} height={10} className="fill-ink-800" />
      <rect x={0} y={0} width={10} height={10} className="fill-ink-700" />
      <rect x={110} y={0} width={10} height={10} className="fill-ink-700" />
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => (
        <line
          key={yd}
          x1={x(yd)}
          x2={x(yd)}
          y1={0}
          y2={10}
          stroke="currentColor"
          className="text-ink-100"
          strokeOpacity={yd === 50 ? 0.25 : 0.1}
          strokeWidth={0.5}
        />
      ))}
      {m.firstDown !== null && m.firstDown < 100 && (
        <line x1={x(m.firstDown)} x2={x(m.firstDown)} y1={0} y2={10} stroke={FIRST_DOWN} strokeWidth={0.8} />
      )}
      <line x1={x1} x2={x1} y1={0} y2={10} stroke="var(--color-ink-100)" strokeOpacity={0.6} strokeWidth={0.6} />
      {m.result === "incomplete" || m.result === "turnover" ? (
        <circle cx={x1} cy={5} r={2} fill="none" stroke={c} strokeWidth={0.9} />
      ) : (
        <>
          <line x1={x1} x2={x2} y1={5} y2={5} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={x2} cy={5} r={1.8} fill={c} />
        </>
      )}
    </svg>
  );
}
