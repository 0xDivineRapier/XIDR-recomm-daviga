'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  qrString: string;
  reference: string;
  sgdAmount: number;
  expiresAt: string;
  onPaid?: () => void;
}

export function PayNowQR({ qrString, reference, sgdAmount, expiresAt, onPaid }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isExpired = secondsLeft === 0;

  const copyRef = () => {
    navigator.clipboard.writeText(reference);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-2xl border border-gray-200 shadow-sm max-w-sm mx-auto">
      <h3 className="text-lg font-semibold text-gray-900">PayNow Payment</h3>
      <p className="text-3xl font-bold text-emerald-600">SGD {sgdAmount.toFixed(2)}</p>

      {isExpired ? (
        <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded-xl">
          <p className="text-gray-500 text-sm text-center">Payment window expired</p>
        </div>
      ) : (
        <div className="p-3 bg-white border-2 border-gray-100 rounded-xl">
          <QRCodeSVG value={qrString} size={240} level="M" />
        </div>
      )}

      <div className="text-center">
        <p className="text-xs text-gray-500 mb-1">Reference number (must include)</p>
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <span className="font-mono text-sm font-semibold tracking-wider">{reference}</span>
          <button onClick={copyRef} className="text-xs text-emerald-600 hover:text-emerald-700">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {!isExpired && (
        <div className="text-center">
          <p className="text-xs text-gray-500">Complete payment within</p>
          <p className={`text-2xl font-mono font-bold ${secondsLeft < 300 ? 'text-red-500' : 'text-gray-900'}`}>
            {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
          </p>
        </div>
      )}

      <a
        href="paynow://"
        className="w-full text-center py-3 px-4 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 transition-colors"
      >
        Open PayNow App
      </a>

      {onPaid && (
        <button onClick={onPaid} className="text-sm text-gray-500 underline">
          I&apos;ve paid — check status
        </button>
      )}
    </div>
  );
}
