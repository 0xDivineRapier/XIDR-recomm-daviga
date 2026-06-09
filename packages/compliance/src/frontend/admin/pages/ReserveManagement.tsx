// Reserve Management — attest new reserves, view live supply, history
const API_BASE = 'http://localhost:3001';

function ReserveManagement({ token }) {
  const [liveSupply, setLiveSupply] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [histPagination, setHistPagination] = React.useState({ page: 1, pages: 1, total: 0 });
  const [form, setForm] = React.useState({ idr_reserve_amount: '', reserve_bank_name: '', notes: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [success, setSuccess] = React.useState(null);

  const loadLive = () => {
    fetch(`${API_BASE}/v1/reserves/live-supply`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setLiveSupply)
      .catch(() => {});
  };

  const loadHistory = (page = 1) => {
    fetch(`${API_BASE}/v1/reserves/history?page=${page}&limit=10`)
      .then((r) => r.json())
      .then((data) => {
        setHistory(data.data || []);
        setHistPagination(data.pagination || { page: 1, pages: 1, total: 0 });
      })
      .catch(() => {});
  };

  React.useEffect(() => { loadLive(); loadHistory(); }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/v1/reserves/attest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      setSuccess('Attestation submitted successfully.');
      setForm({ idr_reserve_amount: '', reserve_bank_name: '', notes: '' });
      loadHistory(1);
      loadLive();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">Reserve Management</h1>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Live supply */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Live On-Chain Supply</h2>
            <button onClick={loadLive} className="text-xs text-blue-500 hover:underline">Refresh</button>
          </div>
          {liveSupply ? (
            <div className="space-y-2">
              <p className="text-3xl font-bold text-gray-900">
                {Number(liveSupply.total_supply).toLocaleString('id-ID')} <span className="text-base font-normal text-gray-400">XIDR</span>
              </p>
              <p className="text-xs text-gray-400">Block #{liveSupply.block_number}</p>
            </div>
          ) : (
            <p className="text-gray-300">Loading…</p>
          )}
        </div>

        {/* Attest form */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">New Attestation</h2>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          {success && <p className="text-xs text-green-600 mb-2">{success}</p>}
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">IDR Reserve Amount</label>
              <input
                type="number"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="e.g. 1000000000"
                value={form.idr_reserve_amount}
                onChange={(e) => setForm({ ...form, idr_reserve_amount: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Reserve Bank Name</label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="e.g. Bank Central Asia"
                value={form.reserve_bank_name}
                onChange={(e) => setForm({ ...form, reserve_bank_name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Monthly attestation…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
            >
              {submitting ? 'Submitting…' : 'Submit Attestation'}
            </button>
          </form>
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Attestation History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-right px-5 py-3">XIDR Supply</th>
                <th className="text-right px-5 py-3">IDR Reserves</th>
                <th className="text-right px-5 py-3">Ratio</th>
                <th className="text-left px-5 py-3">Bank</th>
                <th className="text-left px-5 py-3">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {history.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-300">No attestations yet</td></tr>
              )}
              {history.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-600">{new Date(h.attestedAt).toLocaleDateString('en-GB')}</td>
                  <td className="px-5 py-3 text-right">{Number(h.xidrTotalSupply).toLocaleString('id-ID')}</td>
                  <td className="px-5 py-3 text-right">Rp {Number(h.idrReserveAmount).toLocaleString('id-ID')}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${parseFloat(h.reserveRatio) >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                    {(parseFloat(h.reserveRatio) * 100).toFixed(2)}%
                  </td>
                  <td className="px-5 py-3 text-gray-500">{h.reserveBankName}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{h.attestationHash.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-gray-50 flex justify-between text-xs text-gray-400">
          <span>{histPagination.total} total</span>
          <div className="flex gap-2">
            <button onClick={() => loadHistory(histPagination.page - 1)} disabled={histPagination.page <= 1} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">← Prev</button>
            <span>Page {histPagination.page} / {histPagination.pages}</span>
            <button onClick={() => loadHistory(histPagination.page + 1)} disabled={histPagination.page >= histPagination.pages} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
