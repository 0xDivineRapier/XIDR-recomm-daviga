import { TransferStatus } from '../../../components/TransferStatus';

async function getTransfer(id: string) {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3002';
  try {
    const res = await fetch(`${base}/v1/transfers/track/${id}`, { next: { revalidate: 10 } });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export default async function TrackPage({ params }: { params: { id: string } }) {
  const transfer = await getTransfer(params.id);

  if (!transfer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Transfer not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-sm mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Transfer Status</h1>
          <p className="text-gray-500 text-sm mt-1">#{params.id.slice(0, 8).toUpperCase()}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">From</span>
            <span className="font-medium">{transfer.sender_first_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">To</span>
            <span className="font-medium">{transfer.recipient_name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Amount</span>
            <span className="font-semibold text-emerald-700">
              IDR {new Intl.NumberFormat('id-ID').format(parseFloat(transfer.idr_amount))}
            </span>
          </div>
          <hr />
          <TransferStatus
            status={transfer.status}
            idrAmount={transfer.idr_amount}
            recipientName={transfer.recipient_name}
          />
          {transfer.completed_at && (
            <p className="text-xs text-gray-500 text-center">
              Completed {new Date(transfer.completed_at).toLocaleString('en-SG')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
