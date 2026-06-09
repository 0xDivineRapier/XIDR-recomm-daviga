// Transactions — searchable table with AML status badges
const API_BASE = 'http://localhost:3001';

const AML_BADGE = {
  cleared: 'bg-green-100 text-green-800',
  flagged: 'bg-yellow-100 text-yellow-800',
  blocked: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-600',
};

function Transactions({ token }) {
  const [rows, setRows] = React.useState([]);
  const [pagination, setPagination] = React.useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  const load = (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 20 });
    if (search) params.set('address', search);
    if (statusFilter) params.set('status', statusFilter);
    fetch(`${API_BASE}/v1/transactions?${params}`, {
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

  React.useEffect(() => { load(); }, [token, statusFilter]);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">Transactions</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="Search by address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(1)}
        />
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="cleared">Cleared</option>
          <option value="flagged">Flagged</option>
          <option value="blocked">Blocked</option>
        </select>
        <button
          onClick={() => load(1)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          Search
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-10">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-5 py-3">TX Hash</th>
                  <th className="text-left px-5 py-3">From</th>
                  <th className="text-left px-5 py-3">To</th>
                  <th className="text-right px-5 py-3">Amount</th>
                  <th className="text-left px-5 py-3">AML Status</th>
                  <th className="text-right px-5 py-3">Risk</th>
                  <th className="text-left px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-10 text-gray-300">No transactions</td></tr>
                )}
                {rows.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-blue-600">
                      {tx.txHash.slice(0, 10)}…
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {tx.fromAddress.slice(0, 10)}…
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {tx.toAddress.slice(0, 10)}…
                    </td>
                    <td className="px-5 py-3 text-right font-medium">
                      {Number(tx.amount).toLocaleString('id-ID')}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${AML_BADGE[tx.amlStatus] || 'bg-gray-100 text-gray-600'}`}>
                        {tx.amlStatus}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {tx.riskScore !== null && tx.riskScore !== undefined ? (
                        <span className={`font-semibold ${tx.riskScore > 70 ? 'text-red-600' : 'text-gray-700'}`}>
                          {tx.riskScore}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
            <span>{pagination.total} total</span>
            <div className="flex gap-2">
              <button onClick={() => load(pagination.page - 1)} disabled={pagination.page <= 1} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">← Prev</button>
              <span>Page {pagination.page} / {pagination.pages}</span>
              <button onClick={() => load(pagination.page + 1)} disabled={pagination.page >= pagination.pages} className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30">Next →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
