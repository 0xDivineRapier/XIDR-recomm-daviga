/**
 * XIDR Liquidity Dashboard
 *
 * Layout
 * ──────
 *   Header  — wallet connection button + network badge
 *   Row 1   — PoolStats  + IncentiveStats
 *   Row 2   — RateChart  + TVLChart
 *   Row 3   — PartnerDashboard (wallet-specific)
 */
import React from "react";
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { PoolStats }         from "./components/PoolStats";
import { IncentiveStats }    from "./components/IncentiveStats";
import { PartnerDashboard }  from "./components/PartnerDashboard";
import { RateChart }         from "./components/RateChart";
import { TVLChart }          from "./components/TVLChart";

// ── Styles ────────────────────────────────────────────────────────────────────
const page: React.CSSProperties = {
  maxWidth: 1200,
  margin: "0 auto",
  padding: "0 24px 48px",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "20px 0 32px",
  borderBottom: "1px solid #1e293b",
  marginBottom: 32,
};

const section: React.CSSProperties = {
  background: "#13131f",
  border: "1px solid #1e293b",
  borderRadius: 16,
  padding: "24px",
  marginBottom: 24,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 24,
  marginBottom: 24,
};

const btnConnect: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 8,
  border: "1px solid #2d2d4e",
  background: "#1a1a2e",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
};

const chainBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 4,
  background: "#1e3a5f",
  color: "#60a5fa",
  marginLeft: 8,
  verticalAlign: "middle",
};

const CHAIN_NAMES: Record<number, string> = {
  8453:  "Base",
  84532: "Base Sepolia",
};

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect }  = useConnect();
  const { disconnect }           = useDisconnect();
  const chainId                  = useChainId();

  if (isConnected) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>
          {address?.slice(0, 6)}…{address?.slice(-4)}
          <span style={chainBadge}>{CHAIN_NAMES[chainId] ?? `Chain ${chainId}`}</span>
        </span>
        <button style={{ ...btnConnect, color: "#ef4444", borderColor: "#3f1515" }} onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  // Show MetaMask / Injected first, then others
  const injected = connectors.find((c) => c.type === "injected");
  const coinbase = connectors.find((c) => c.name.toLowerCase().includes("coinbase"));
  const wc       = connectors.find((c) => c.name.toLowerCase().includes("walletconnect"));

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {injected && (
        <button style={btnConnect} onClick={() => connect({ connector: injected })}>
          MetaMask
        </button>
      )}
      {coinbase && (
        <button style={btnConnect} onClick={() => connect({ connector: coinbase })}>
          Coinbase Wallet
        </button>
      )}
      {wc && (
        <button style={btnConnect} onClick={() => connect({ connector: wc })}>
          WalletConnect
        </button>
      )}
    </div>
  );
}

export function App() {
  return (
    <div style={page}>
      {/* ── Header ── */}
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>
            XIDR Liquidity Dashboard
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#475569" }}>
            Uniswap v3 pool · Float incentive program · Base
          </p>
        </div>
        <WalletButton />
      </header>

      {/* ── Row 1: Pool + Incentive stats ── */}
      <div style={grid2}>
        <div style={section}>
          <PoolStats />
        </div>
        <div style={section}>
          <IncentiveStats />
        </div>
      </div>

      {/* ── Row 2: Charts ── */}
      <div style={grid2}>
        <div style={section}>
          <RateChart />
        </div>
        <div style={section}>
          <TVLChart />
        </div>
      </div>

      {/* ── Row 3: Partner dashboard ── */}
      <div style={section}>
        <PartnerDashboard />
      </div>
    </div>
  );
}
