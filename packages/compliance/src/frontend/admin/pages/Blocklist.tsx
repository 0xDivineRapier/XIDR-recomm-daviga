// Blocklist — view, add, and remove blocked addresses
const API_BASE = 'http://localhost:3001';

function Blocklist({ token }) {
  const [rows, setRows] = React.useState([]);
  const [pagination, setPagination] = React.useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = React.useState(true);
  const [addForm, setAddForm] = React.useState({ wallet_address: '', reason: '' });
  const [removeForm, setRemoveForm] = React.useState({ address: '', reason: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [success, setSuccess] = React.useState(null);

  const load = (page = 1) => {
    setLoading(true);
    fetch(`${API_BASE}/v1/admin/blocklist?page=${page}&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setRows(data.data || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { load(); }, [token]);

  const blockAddress = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/v1/admin/blocklist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to block address');
      const data = await r.json();
      setSuccess(`Blocked. TX: ${data.tx_hash}`);
      setAddForm({ wallet_address: '', reason: '' });
      load(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const unblockAddress = async (e) => {
    e.preventDefault();
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/v1/admin/blocklist/${removeForm.address}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: removeForm.reason }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to unblock address');
      const data = await r.json();
      setSuccess(`Unblocked. TX: ${data.tx_hash}`);
      setRemoveForm({ address: '', reason: '' });
      load(1);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">Blocklist</h1>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-mono break-all">{success}</div>}

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Block form */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Block Address</h2>
          <form onSubmit={blockAddress} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet Address</label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
                placeholder="0x…"
                value={addForm.wallet_address}
                onChange={(e) => setAddForm({ ...addForm, wallet_address: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Reason</label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                placeholder="e.g. OFAC sanctions match"
                value={addForm.reason}
                onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-40"
            >
              {submitting ? 'Processing…' : 'Block Address'}
            </button>
          </form>
        </div>

        {/* Unblock form */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Unblock Address</h2>
          <form onSubmit={unblockAddress} className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Wallet Address</label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
                placeholder="0x…"
                value={removeForm.address}
                onChange={(e) => setRemoveForm({ ...removeForm, address: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Reason</label>
              <input
                type="text"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                placeholder="e.g. False positive — confirmed clean"
                value={removeForm.reason}
                onChange={(e) => setRemoveForm({ ...removeForm, reason: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-40"
            >
              {submitting ? 'Processing…' : 'Unblock Address'}
            </button>
          </form>
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Action Log</h2>
        </div>
        {loading ? (
          <div className="text-center py-8 text-gray-300">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Address</th>
                <th className="text-left px-5 py-3">Action</th>
                <th className="text-left px-5 py-3">Reason</th>
                <th className="text-left px-5 py-3">TX Hash</th>
                <th className="text-left px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-300">No blocklist actions</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-600">{r.walletAddress.slice(0, 12)}…</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r.action === 'block' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{r.reason}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">
                    {r.txHash ? `${r.txHash.slice(0, 12)}…` : '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-xs">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-5 py-3 border-t border-gray-50 flex justify-between text-xs text-gray-400">
          <span>{pagination.total} total</span>
          <div className="flex gap-2">
            <button onClick={() => load(pagination.page - 1)} disabled={pagination.page <= 1} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">← Prev</button>
            <span>Page {pagination.page} / {pagination.pages}</span>
            <button onClick={() => load(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
