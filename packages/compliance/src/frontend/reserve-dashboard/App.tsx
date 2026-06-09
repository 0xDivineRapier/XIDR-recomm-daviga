// Reserve Dashboard — public-facing proof-of-reserves page
// Loaded via Babel standalone (no build step required)

const API_BASE = window.location.origin.includes('localhost:3000')
  ? 'http://localhost:3001'
  : '';

type Attestation = {
  id: string;
  attestedAt: string;
  xidrTotalSupply: string;
  idrReserveAmount: string;
  reserveRatio: string;
  reserveBankName: string;
  attestationHash: string;
  notes?: string;
};

function formatNumber(n: string | number) {
  return Number(n).toLocaleString('id-ID');
}

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function RatioGauge({ ratio }: { ratio: number }) {
  const pct = Math.min(ratio * 100, 150);
  const color =
    ratio >= 1.0 ? 'bg-green-500' : ratio >= 0.95 ? 'bg-yellow-400' : 'bg-red-500';
  const label =
    ratio >= 1.0 ? 'Fully Backed' : ratio >= 0.95 ? 'Near Threshold' : 'Under-Collateralized';
  const labelColor =
    ratio >= 1.0 ? 'text-green-700' : ratio >= 0.95 ? 'text-yellow-700' : 'text-red-700';

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm font-medium">
        <span className={labelColor}>{label}</span>
        <span className="text-gray-700">{(ratio * 100).toFixed(2)}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
        <div
          className={`h-4 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>0%</span>
        <span className="font-semibold">100% (1:1)</span>
        <span>150%</span>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200 transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function App() {
  const [attestation, setAttestation] = React.useState<Attestation | null>(null);
  const [history, setHistory] = React.useState<Attestation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/v1/reserves/latest`).then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('Failed to fetch latest attestation');
        return r.json();
      }),
      fetch(`${API_BASE}/v1/reserves/history?limit=10`).then((r) => {
        if (!r.ok) return { data: [] };
        return r.json();
      }),
    ])
      .then(([latest, hist]) => {
        setAttestation(latest);
        setHistory(hist?.data || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">Loading reserve data…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">X</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">XIDR Proof of Reserves</h1>
        </div>
        <p className="text-gray-500 text-sm">
          Real-time transparency dashboard — every XIDR token is backed 1:1 by Indonesian Rupiah.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!attestation && !error && (
        <div className="text-center py-16 text-gray-400">
          No reserve attestation has been published yet.
        </div>
      )}

      {attestation && (
        <>
          {/* Main stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                XIDR Total Supply
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {formatNumber(attestation.xidrTotalSupply)}
              </p>
              <p className="text-xs text-gray-400 mt-1">XIDR tokens</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                IDR Reserves
              </p>
              <p className="text-2xl font-bold text-gray-900">
                Rp {formatNumber(attestation.idrReserveAmount)}
              </p>
              <p className="text-xs text-gray-400 mt-1">{attestation.reserveBankName}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                Reserve Ratio
              </p>
              <p
                className={`text-2xl font-bold ${
                  parseFloat(attestation.reserveRatio) >= 1
                    ? 'text-green-600'
                    : parseFloat(attestation.reserveRatio) >= 0.95
                    ? 'text-yellow-600'
                    : 'text-red-600'
                }`}
              >
                {(parseFloat(attestation.reserveRatio) * 100).toFixed(2)}%
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Last verified {timeAgo(attestation.attestedAt)}
              </p>
            </div>
          </div>

          {/* Gauge */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Collateralization Ratio</h2>
            <RatioGauge ratio={parseFloat(attestation.reserveRatio)} />
          </div>

          {/* Attestation hash */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Attestation Proof</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs font-mono text-gray-600 break-all">
                {attestation.attestationHash}
              </code>
              <CopyButton text={attestation.attestationHash} />
            </div>
            {attestation.notes && (
              <p className="text-xs text-gray-400 mt-2">{attestation.notes}</p>
            )}
          </div>

          {/* History table */}
          {history.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Attestation History</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide bg-gray-50">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-right px-5 py-3">Supply (XIDR)</th>
                      <th className="text-right px-5 py-3">Reserves (IDR)</th>
                      <th className="text-right px-5 py-3">Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {history.map((h) => (
                      <tr key={h.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-700">
                          {new Date(h.attestedAt).toLocaleDateString('en-GB')}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-700">
                          {formatNumber(h.xidrTotalSupply)}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-700">
                          Rp {formatNumber(h.idrReserveAmount)}
                        </td>
                        <td
                          className={`px-5 py-3 text-right font-semibold ${
                            parseFloat(h.reserveRatio) >= 1
                              ? 'text-green-600'
                              : parseFloat(h.reserveRatio) >= 0.95
                              ? 'text-yellow-600'
                              : 'text-red-600'
                          }`}
                        >
                          {(parseFloat(h.reserveRatio) * 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-center text-xs text-gray-300 mt-10">
        XIDR Compliance Service · Data updated on every reserve attestation
      </p>
    </div>
  );
}
