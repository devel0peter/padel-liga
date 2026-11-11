import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "~/components/ui/chart";
import { formatShortDay } from "~/lib/format";
import type { RoundStatus } from "~/lib/round-status";

// The running round's burn-down (#350 requirement 4): matches left at the
// end of each day, the leading "not fixed yet" line, the ideal line and the
// dashed forecast to the deadline, with the weeks marked on the axis.

// The forecast is red when it falls short of the deadline.
const chartConfig = (behind: boolean) =>
  ({
    remaining: { label: "Hátralévő meccsek", color: "var(--primary)" },
    notFixed: { label: "Még nincs fix időpont", color: "oklch(0.68 0.16 60)" },
    ideal: { label: "Ideális", color: "var(--muted-foreground)" },
    forecast: { label: "Előrejelzés", color: behind ? "var(--destructive)" : "oklch(0.55 0.13 150)" },
  }) satisfies ChartConfig;

export function RoundBurndown({ round }: { round: RoundStatus }) {
  const config = chartConfig(round.verdict === "behind");
  const data = round.series.map((d) => ({ ...d, ideal: Math.round(d.ideal * 10) / 10 }));
  const ticks = [...round.weekMarks.map((w) => w.day), round.deadlineDay];
  const hasForecast = round.series.some((d) => d.forecast !== null);
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label="A kör meccseinek alakulása naponta">
      <LineChart data={data} margin={{ top: 20, right: 28, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" ticks={ticks} tickFormatter={formatShortDay} tickLine={false} axisLine={false} interval={0} minTickGap={4} />
        <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} domain={[0, round.total]} />
        {round.weekMarks.map((w) => (
          <ReferenceLine
            key={w.day}
            x={w.day}
            stroke="var(--border)"
            label={{ value: w.label, position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 11, dy: -18 }}
          />
        ))}
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(day) => formatShortDay(String(day))} />} />
        <ChartLegend itemSorter={null} content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
        <Line dataKey="remaining" type="linear" stroke="var(--color-remaining)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        <Line dataKey="notFixed" type="linear" stroke="var(--color-notFixed)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="ideal" type="linear" stroke="var(--color-ideal)" strokeWidth={1} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
        {hasForecast && (
          <Line
            dataKey="forecast"
            type="linear"
            stroke="var(--color-forecast)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ChartContainer>
  );
}
