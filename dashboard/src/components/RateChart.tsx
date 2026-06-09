/**
 * RateChart — 30-day XIDR/USDC price history with ±1% band.
 * Data sourced from The Graph Uniswap subgraph.
 */
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from "recharts";
import { usePoolData, type PoolDayData } from "../hooks/usePoolData";

interface ChartPoint {
  date:     string;
  price:    number;
  upper1pct: number;
  lower1pct: number;
}

function buildChartData(history: PoolDayData[]): ChartPoint[] {
  // history is newest-first from The Graph; reverse for chronological display
  return [...history].reverse().map((d) => {
    // token0Price = XIDR per USDC (IDR/USDC)
    const price = d.token0Price;
    return {
      date:     new Date(d.date * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price:    Math.round(price),
      upper1pct: Math.round(price * 1.01),
      lower1pct: Math.round(price * 0.99),
    };
  });
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
      <p style={{ color: "#e2e8f0", margin: 0 }}>Rate: <strong>{d.price.toLocaleString()} IDR/USDC</strong></p>
      <p style={{ color: "#22c55e", margin: 0, fontSize: 11 }}>+1%: {d.upper1pct.toLocaleString()}</p>
      <p style={{ color: "#ef4444", margin: 0, fontSize: 11 }}>-1%: {d.lower1pct.toLocaleString()}</p>
    </div>
  );
};

export function RateChart() {
  const { history, isLoading, onChain } = usePoolData();
  const data = buildChartData(history);

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>
        XIDR / USDC Rate
        <span style={{ marginLeft: 12, fontSize: 13, color: "#64748b", fontWeight: 400 }}>
          30-day history  {onChain ? `· Live: ${Math.round(onChain.idrPerUsdc).toLocaleString()} IDR` : ""}
        </span>
      </h2>

      {isLoading && <p style={{ color: "#64748b" }}>Loading chart data…</p>}

      {!isLoading && data.length === 0 && (
        <p style={{ color: "#475569" }}>
          No subgraph data available. Set VITE_THEGRAPH_UNISWAP_BASE_URL to enable.
        </p>
      )}

      {data.length > 0 && (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
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
              domain={["auto", "auto"]}
              tickFormatter={(v) => v.toLocaleString()}
            />
            <Tooltip content={customTooltip} />

            {/* ±1% band */}
            <Area
              type="monotone"
              dataKey="upper1pct"
              stroke="none"
              fill="#22c55e"
              fillOpacity={0.08}
              legendType="none"
            />
            <Area
              type="monotone"
              dataKey="lower1pct"
              stroke="none"
              fill="#0f172a"
              fillOpacity={1}
              legendType="none"
            />

            {/* Main price line */}
            <Line
              type="monotone"
              dataKey="price"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#6366f1" }}
            />

            {/* Reference lines for ±1% band edges */}
            <Line
              type="monotone"
              dataKey="upper1pct"
              stroke="#22c55e"
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="lower1pct"
              stroke="#ef4444"
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <p style={{ fontSize: 11, color: "#334155", marginTop: 8 }}>
        Shaded band = ±1% of daily close. Source: The Graph / Uniswap v3 subgraph.
      </p>
    </div>
  );
}
