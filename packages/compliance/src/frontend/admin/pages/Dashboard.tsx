// Admin Dashboard — stats overview
const API_BASE = 'http://localhost:3001';

function StatCard({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  };
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">{label}</p>
      <p className="text-3xl font-bold">{value ?? '—'}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  );
}

function Dashboard({ token }) {
  const [stats, setStats] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    fetch(`${API_BASE}/v1/admin/dashboard-stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      })
      .then((data) => { setStats(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [token]);

  if (loading) return <div className="text-gray-400 py-10 text-center">Loading…</div>;
  if (error) return <div className="text-red-500 py-10 text-center">{error}</div>;

  const ratio = stats.latest_reserve_ratio ? parseFloat(stats.latest_reserve_ratio) : null;
  const ratioColor = ratio === null ? 'gray' : ratio >= 1 ? 'green' : ratio >= 0.95 ? 'yellow' : 'red';

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={stats.total_users} color="gray" />
        <StatCard label="KYC Pending" value={stats.kyc_pending_count} color="yellow" />
        <StatCard label="KYC Approved" value={stats.kyc_approved_count} color="green" />
        <StatCard label="Open AML Alerts" value={stats.open_alerts_count} color={stats.open_alerts_count > 0 ? 'red' : 'green'} />
        <StatCard label="Critical Alerts" value={stats.critical_alerts_count} color={stats.critical_alerts_count > 0 ? 'red' : 'green'} />
        <StatCard
          label="Reserve Ratio"
          value={ratio !== null ? `${(ratio * 100).toFixed(2)}%` : 'N/A'}
          color={ratioColor}
          sub="Latest attestation"
        />
        <StatCard
          label="XIDR Supply"
          value={stats.xidr_total_supply ? Number(stats.xidr_total_supply).toLocaleString('id-ID') : '—'}
          color="blue"
          sub="On-chain (Base)"
        />
      </div>
    </div>
  );
}
