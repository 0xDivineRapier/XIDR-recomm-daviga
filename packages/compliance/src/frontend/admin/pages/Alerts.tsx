// AML Alerts — expandable table with severity badges and status updates
const API_BASE = 'http://localhost:3001';

const SEVERITY_BADGE = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const STATUS_BADGE = {
  open: 'bg-blue-100 text-blue-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  escalated: 'bg-red-100 text-red-800',
};

function Alerts({ token }) {
  const [rows, setRows] = React.useState([]);
  const [pagination, setPagination] = React.useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(null);
  const [updating, setUpdating] = React.useState(null);
  const [severityFilter, setSeverityFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('open');

  const load = (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 20 });
    if (severityFilter) params.set('severity', severityFilter);
    if (statusFilter) params.set('status', statusFilter);
    fetch(`${API_BASE}/v1/transactions/alerts?${params}`, {
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

  React.useEffect(() => { load(); }, [token, severityFilter, statusFilter]);

  const updateStatus = async (id, status) => {
    setUpdating(id);
    await fetch(`${API_BASE}/v1/transactions/alerts/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setUpdating(null);
    load(pagination.page);
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">AML Alerts</h1>

      <div className="flex gap-3 mb-4">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-10">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Severity</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-gray-300">No alerts</td></tr>
              )}
              {rows.map((alert) => (
                <React.Fragment key={alert.id}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer border-t border-gray-50"
                    onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
                  >
                    <td className="px-5 py-3 font-medium">{alert.alertType}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_BADGE[alert.severity]}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[alert.status]}`}>
                        {alert.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(alert.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-gray-300 text-xs">{expanded === alert.id ? '▲' : '▼'}</td>
                  </tr>
                  {expanded === alert.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={5} className="px-5 py-4">
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs text-gray-400 uppercase mb-1">Chainalysis Data</p>
                            <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto">
                              {JSON.stringify(alert.chainalysisData, null, 2)}
                            </pre>
                          </div>
                          {alert.status !== 'resolved' && (
                            <div className="flex gap-2">
                              {alert.status === 'open' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateStatus(alert.id, 'under_review'); }}
                                  disabled={updating === alert.id}
                                  className="px-3 py-1.5 text-xs bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 disabled:opacity-40"
                                >
                                  Mark Under Review
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); updateStatus(alert.id, 'resolved'); }}
                                disabled={updating === alert.id}
                                className="px-3 py-1.5 text-xs bg-green-100 text-green-800 rounded-lg hover:bg-green-200 disabled:opacity-40"
                              >
                                Mark Resolved
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); updateStatus(alert.id, 'escalated'); }}
                                disabled={updating === alert.id}
                                className="px-3 py-1.5 text-xs bg-red-100 text-red-800 rounded-lg hover:bg-red-200 disabled:opacity-40"
                              >
                                Escalate
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
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
