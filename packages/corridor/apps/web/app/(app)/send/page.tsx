'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatIDR } from '../../../lib/api';
import { RateDisplay } from '../../../components/RateDisplay';
import { PayNowQR } from '../../../components/PayNowQR';
import { TransferStatus } from '../../../components/TransferStatus';

type Step = 'amount' | 'payment' | 'processing' | 'complete';

export default function SendPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('amount');
  const [recipients, setRecipients] = useState<any[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [sgdAmount, setSgdAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'paynow' | 'card'>('paynow');
  const [rate, setRate] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [transfer, setTransfer] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/v1/recipients').then(setRecipients).catch(() => router.push('/login'));
  }, []);

  const fetchQuote = async () => {
    if (!sgdAmount || parseFloat(sgdAmount) < 10) return;
    try {
      const q = await api.post('/v1/rates/quote', { sgd_amount: parseFloat(sgdAmount) });
      setQuote(q);
    } catch {}
  };

  useEffect(() => { if (sgdAmount) fetchQuote(); }, [sgdAmount]);

  const handleContinue = async () => {
    if (!sgdAmount || !selectedRecipient) return setError('Please enter amount and select recipient');
    setLoading(true);
    setError('');
    try {
      const t = await api.post('/v1/transfers', {
        recipient_id: selectedRecipient,
        sgd_amount: parseFloat(sgdAmount),
        payment_method: paymentMethod,
      });
      setTransfer(t);
      setStep('payment');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Poll transfer status
  useEffect(() => {
    if (!transfer?.transfer_id || !['payment', 'processing'].includes(step)) return;
    const interval = setInterval(async () => {
      try {
        const t = await api.get(`/v1/transfers/${transfer.transfer_id}`);
        setTransfer((prev: any) => ({ ...prev, ...t }));
        if (t.status === 'payment_received' || t.status === 'swapping') setStep('processing');
        if (t.status === 'completed') setStep('complete');
        if (['failed', 'expired'].includes(t.status)) setStep('processing');
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [transfer?.transfer_id, step]);

  const idrAmount = quote ? quote.idr_amount : (rate && sgdAmount ? Math.round((parseFloat(sgdAmount) - 2.5) * rate.effective_rate) : 0);
  const recipientObj = recipients.find(r => r.id === selectedRecipient);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-lg mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Send money to Indonesia</h1>
          <div className="mt-2"><RateDisplay onRateChange={setRate} /></div>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 mb-6">
          {(['amount', 'payment', 'processing', 'complete'] as Step[]).map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full ${step === s || (['payment', 'processing', 'complete'].indexOf(step) >= ['amount', 'payment', 'processing', 'complete'].indexOf(s)) ? 'bg-emerald-500' : 'bg-gray-200'}`} />
          ))}
        </div>

        {/* Step 1: Amount & Recipient */}
        {step === 'amount' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">You send (SGD)</label>
              <input
                type="number" min="10" max="10000" step="10"
                value={sgdAmount}
                onChange={e => setSgdAmount(e.target.value)}
                className="w-full text-3xl font-bold border-0 border-b-2 border-gray-200 focus:border-emerald-500 outline-none pb-2 bg-transparent"
                placeholder="100"
              />
            </div>

            {quote && (
              <div className="bg-emerald-50 rounded-xl p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Transfer fee</span><span>SGD {quote.sgd_fee}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">You send net</span><span>SGD {quote.sgd_net}</span></div>
                <div className="flex justify-between font-semibold text-emerald-700 text-base border-t border-emerald-200 pt-1 mt-1">
                  <span>Recipient gets</span><span>{formatIDR(quote.idr_amount)}</span>
                </div>
                <p className="text-xs text-gray-500 text-right">Rate locked for 15 min</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
              <select
                value={selectedRecipient}
                onChange={e => setSelectedRecipient(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="">Select recipient...</option>
                {recipients.map(r => (
                  <option key={r.id} value={r.id}>{r.nickname} — {r.full_name} ({r.bank_code || r.payout_type})</option>
                ))}
              </select>
              <button onClick={() => router.push('/recipients')} className="mt-1 text-xs text-emerald-600">+ Add new recipient</button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Payment method</label>
              <div className="grid grid-cols-2 gap-2">
                {(['paynow', 'card'] as const).map(m => (
                  <button key={m} onClick={() => setPaymentMethod(m)}
                    className={`py-2 px-4 rounded-xl border text-sm font-medium transition-colors ${paymentMethod === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'}`}>
                    {m === 'paynow' ? '🏦 PayNow' : '💳 Card'}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button onClick={handleContinue} disabled={loading || !sgdAmount || !selectedRecipient}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-emerald-700 transition-colors">
              {loading ? 'Creating transfer...' : 'Continue →'}
            </button>
          </div>
        )}

        {/* Step 2: Payment */}
        {step === 'payment' && transfer && (
          <div className="space-y-4">
            {paymentMethod === 'paynow' ? (
              <PayNowQR
                qrString={transfer.paynow_qr_string || ''}
                reference={transfer.paynow_reference || ''}
                sgdAmount={transfer.sgd_amount}
                expiresAt={transfer.expires_at}
                onPaid={() => {}}
              />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">
                <p className="text-gray-600 mb-4">Stripe card payment</p>
                <p className="text-2xl font-bold">SGD {transfer.sgd_amount}</p>
                {/* Stripe Elements would be integrated here */}
                <p className="text-sm text-gray-500 mt-4">Stripe Elements integration requires publishable key configuration</p>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Processing */}
        {step === 'processing' && transfer && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Transfer in progress</h2>
            <TransferStatus
              status={transfer.status}
              idrAmount={transfer.idr_amount || transfer.xidr_amount}
              recipientName={recipientObj?.full_name}
            />
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && transfer && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <h2 className="text-xl font-bold text-gray-900">Transfer complete</h2>
            <p className="text-gray-600">
              {formatIDR(parseFloat(transfer.idr_amount))} sent to {recipientObj?.full_name || 'recipient'}
            </p>
            <p className="text-sm text-gray-500">Estimated arrival: within 1 business day</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => router.push('/history')} className="px-4 py-2 border border-gray-300 rounded-xl text-sm text-gray-700">
                View history
              </button>
              <button onClick={() => { setStep('amount'); setSgdAmount(''); setQuote(null); setTransfer(null); }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold">
                Send again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
