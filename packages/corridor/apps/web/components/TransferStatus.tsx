'use client';

const STEPS = [
  { key: 'payment_received', label: 'Payment received', subLabel: 'SGD funds confirmed' },
  { key: 'swapping', label: 'Converting SGD → IDR', subLabel: 'On-chain currency conversion' },
  { key: 'swap_complete', label: 'Conversion complete', subLabel: 'IDR ready for disbursement' },
  { key: 'disbursing', label: 'Sending to bank account', subLabel: 'Indonesian bank transfer in progress' },
  { key: 'completed', label: 'Delivered', subLabel: 'IDR received by recipient' },
];

const STATUS_ORDER = ['pending_payment', 'payment_received', 'swapping', 'swap_complete', 'disbursing', 'completed'];

function stepStatus(stepKey: string, currentStatus: string): 'done' | 'active' | 'pending' {
  const stepIdx = STATUS_ORDER.indexOf(stepKey);
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  if (currentIdx > stepIdx) return 'done';
  if (currentIdx === stepIdx) return 'active';
  return 'pending';
}

export function TransferStatus({ status, idrAmount, recipientName }: { status: string; idrAmount: string; recipientName?: string }) {
  const isFailed = status === 'failed' || status === 'expired' || status === 'refunded';

  return (
    <div className="space-y-4">
      {isFailed ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          Transfer {status === 'expired' ? 'expired — payment window closed' : 'failed'}. Please contact support.
        </div>
      ) : (
        <div className="space-y-3">
          {STEPS.map((step) => {
            const s = stepStatus(step.key, status);
            return (
              <div key={step.key} className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold
                  ${s === 'done' ? 'bg-emerald-500 text-white' : s === 'active' ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-400'}`}>
                  {s === 'done' ? '✓' : s === 'active' ? '⟳' : '○'}
                </div>
                <div>
                  <p className={`text-sm font-medium ${s === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>{step.label}</p>
                  <p className="text-xs text-gray-500">{step.subLabel}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status === 'completed' && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
          <p className="text-emerald-700 font-semibold">IDR {new Intl.NumberFormat('id-ID').format(parseFloat(idrAmount))} sent to {recipientName || 'recipient'}</p>
          <p className="text-xs text-emerald-600 mt-1">Estimated arrival: within 1 business day</p>
        </div>
      )}
    </div>
  );
}
