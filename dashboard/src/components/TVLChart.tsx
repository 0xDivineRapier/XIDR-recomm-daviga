/**
 * TVLChart — 30-day Total Value Locked bar chart.
 * Data sourced from The Graph Uniswap subgraph.
 */
import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { usePoolData, type PoolDayData } from "../hooks/usePoolData";

interface ChartPoint {
  date:     string;
  tvlUSD:   number;
  volUSD:   number;
}

function buildChartData(history: PoolDayData[]): ChartPoint[] {
  return [...history].reverse().map((d) => ({
    date:   new Date(d.date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    tvlUSD: d.tvlUSD,
    volUSD: d.volumeUSD,
  }));
}

function fmtUSD(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

const customTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartPoint;
  return (
    <div style={{
      background: "#1a1a2e",
      border: "1px solid #2d2d4e",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 13,
    }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#6366f1", margin: 0 }}>TVL: <strong>{fmtUSD(d.tvlUSD)}</strong></p>
      <p style={{ color: "#22c55e", margin: 0 }}>Volume: <strong>{fmtUSD(d.volUSD)}</strong></p>
    </div>
  );
};

export function TVLChart() {
  const { history, isLoading, latestTvlUSD } = usePoolData();
  const data = buildChartData(history);

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>
        Pool TVL
        <span style={{ marginLeft: 12, fontSize: 13, color: "#64748b", fontWeight: 400 }}>
          {latestTvlUSD !== undefined ? `Current: ${fmtUSD(latestTvlUSD)}` : "30-day history"}
        </span>
      </h2>

      {isLoading && <p style={{ color: "#64748b" }}>Loading TVL chart…</p>}

      {!isLoading && data.length === 0 && (
        <p style={{ color: "#475569" }}>
          No subgraph data available. Set VITE_THEGRAPH_UNISWAP_BASE_URL to enable.
        </p>
      )}

      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#1e293b" }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmtUSD}
            />
            <Tooltip content={customTooltip} cursor={{ fill: "#1e293b" }} />
            <Bar dataKey="tvlUSD"  fill="#6366f1" radius={[3, 3, 0, 0]} name="TVL"    />
            <Bar dataKey="volUSD"  fill="#22c55e" radius={[3, 3, 0, 0]} name="Volume" />
          </BarChart>
        </ResponsiveContainer>
      )}

      <p style={{ fontSize: 11, color: "#334155", marginTop: 8 }}>
        Purple = TVL · Green = 24h volume. Source: The Graph / Uniswap v3 subgraph.
      </p>
    </div>
  );
}
