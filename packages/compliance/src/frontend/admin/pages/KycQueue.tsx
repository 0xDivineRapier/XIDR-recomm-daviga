// KYC Queue — admin review of pending submissions
const API_BASE = 'http://localhost:3001';

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  needs_review: 'bg-orange-100 text-orange-800',
};

function KycQueue({ token }) {
  const [submissions, setSubmissions] = React.useState([]);
  const [pagination, setPagination] = React.useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [rejectTarget, setRejectTarget] = React.useState(null);

  const load = (page = 1) => {
    setLoading(true);
    fetch(`${API_BASE}/v1/kyc/submissions?page=${page}&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setSubmissions(data.data || []);
        setPagination(data.pagination || { page: 1, pages: 1, total: 0 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { load(); }, [token]);

  const review = async (id, action, rejection_reason) => {
    setActionLoading(id);
    try {
      await fetch(`${API_BASE}/v1/kyc/submissions/${id}/review`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, rejection_reason }),
      });
      load(pagination.page);
    } finally {
      setActionLoading(null);
      setRejectTarget(null);
      setRejectReason('');
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-800 mb-6">KYC Queue</h1>

      {/* Reject modal */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">Reject Submission</h2>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
              rows={3}
              placeholder="Reason for rejection…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => review(rejectTarget, 'reject', rejectReason)}
                disabled={!rejectReason.trim()}
                className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                className="flex-1 bg-gray-100 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-gray-400 text-center py-10">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">User ID</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Persona ID</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {submissions.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-gray-300">No submissions</td></tr>
              )}
              {submissions.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{s.userId?.slice(0, 8)}…</td>
                  <td className="px-5 py-3 capitalize">{s.type}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{s.personaInquiryId}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-600'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-400">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    {s.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => review(s.id, 'approve')}
                          disabled={actionLoading === s.id}
                          className="px-3 py-1 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectTarget(s.id)}
                          className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-400">
            <span>{pagination.total} total</span>
            <div className="flex gap-2">
              <button
                onClick={() => load(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span>Page {pagination.page} / {pagination.pages}</span>
              <button
                onClick={() => load(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
                className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
