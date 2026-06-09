/**
 * PoolStats — shows live Uniswap v3 pool metrics:
 * TVL, 24h volume, current price, active liquidity.
 */
import React from "react";
import { usePoolData } from "../hooks/usePoolData";

const card: React.CSSProperties = {
  background: "#1a1a2e",
  border: "1px solid #2d2d4e",
  borderRadius: 12,
  padding: "20px 24px",
};

const label: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

const value: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: "#e2e8f0",
};

const subvalue: React.CSSProperties = {
  fontSize: 14,
  color: "#64748b",
  marginTop: 4,
};

function fmt(n: number | undefined, decimals = 2, prefix = ""): string {
  if (n === undefined || isNaN(n)) return "—";
  return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function PoolStats() {
  const { onChain, latestTvlUSD, latestVolumeUSD, isLoading, poolAddress } = usePoolData();

  return (
    <div>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, color: "#94a3b8" }}>
        Pool Stats
        <span style={{ marginLeft: 12, fontSize: 11, color: "#475569", fontWeight: 400 }}>
          {poolAddress.slice(0, 10)}…
        </span>
      </h2>

      {isLoading && <p style={{ color: "#64748b" }}>Loading…</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
        <div style={card}>
          <p style={label}>TVL</p>
          <p style={value}>{fmt(latestTvlUSD, 0, "$")}</p>
          <p style={subvalue}>Total Value Locked</p>
        </div>

        <div style={card}>
          <p style={label}>24h Volume</p>
          <p style={value}>{fmt(latestVolumeUSD, 0, "$")}</p>
          <p style={subvalue}>From subgraph</p>
        </div>

        <div style={card}>
          <p style={label}>IDR per USDC</p>
          <p style={value}>{fmt(onChain?.idrPerUsdc, 0)}</p>
          <p style={subvalue}>Live on-chain price</p>
        </div>

        <div style={card}>
          <p style={label}>Active Liquidity</p>
          <p style={{ ...value, fontSize: 20 }}>
            {onChain ? Number(onChain.liquidity).toLocaleString() : "—"}
          </p>
          <p style={subvalue}>Tick: {onChain?.tick ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
