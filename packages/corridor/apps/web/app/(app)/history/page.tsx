'use client';
import { useEffect, useState } from 'react';
import { api, formatIDR } from '../../../lib/api';

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  pending_payment: 'bg-blue-100 text-blue-700',
  payment_received: 'bg-blue-100 text-blue-700',
  swapping: 'bg-yellow-100 text-yellow-700',
  disbursing: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

export default function HistoryPage() {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/v1/transfers').then(r => setTransfers(r.data || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Transfer history</h1>
        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-200 animate-pulse rounded-xl" />)}</div>
        ) : transfers.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No transfers yet</p>
        ) : (
          <div className="space-y-3">
            {transfers.map(t => (
              <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">SGD {parseFloat(t.sgd_amount).toFixed(2)}</p>
                  <p className="text-sm text-gray-500">{new Date(t.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">{formatIDR(parseFloat(t.idr_amount))}</p>
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[t.status] || 'bg-gray-100 text-gray-500'}`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
