'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('+65');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendOtp = async () => {
    setLoading(true); setError('');
    try {
      await api.post('/v1/auth/otp/send', { phone_number: phone });
      setStep('otp');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    setLoading(true); setError('');
    try {
      const { access_token, refresh_token } = await api.post('/v1/auth/otp/verify', { phone_number: phone, code: otp });
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      router.push('/send');
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Send money home</h1>
          <p className="text-gray-500 text-sm mt-1">SGD → IDR, straight to their bank</p>
        </div>

        {step === 'phone' ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Singapore mobile number</label>
              <input
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="+6591234567"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={sendOtp} disabled={loading || phone.length < 10}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-emerald-700 transition-colors">
              {loading ? 'Sending code...' : 'Send OTP'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Enter 6-digit code sent to {phone}</label>
              <input
                type="number" value={otp} onChange={e => setOtp(e.target.value)}
                placeholder="123456" maxLength={6}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-2xl text-center tracking-widest focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button onClick={verifyOtp} disabled={loading || otp.length !== 6}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-emerald-700 transition-colors">
              {loading ? 'Verifying...' : 'Verify & continue'}
            </button>
            <button onClick={() => setStep('phone')} className="w-full text-sm text-gray-500 text-center">← Change number</button>
          </>
        )}
      </div>
    </div>
  );
}
