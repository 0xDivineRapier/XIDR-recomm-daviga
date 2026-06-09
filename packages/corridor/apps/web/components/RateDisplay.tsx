'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Rate {
  sgd_idr: number;
  effective_rate: number;
  spread_pct: number;
  valid_until: string;
  source: string;
}

export function RateDisplay({ onRateChange }: { onRateChange?: (rate: Rate) => void }) {
  const [rate, setRate] = useState<Rate | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [prevRate, setPrevRate] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  const fetchRate = async () => {
    try {
      const r = await api.get('/v1/rates/current');
      if (prevRate && Math.abs(r.effective_rate - prevRate) / prevRate > 0.01) {
        setFlash(true);
        setTimeout(() => setFlash(false), 1500);
      }
      setPrevRate(r.effective_rate);
      setRate(r);
      setSecondsLeft(60);
      onRateChange?.(r);
    } catch {}
  };

  useEffect(() => {
    fetchRate();
    const interval = setInterval(fetchRate, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  if (!rate) return <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />;

  return (
    <div className={`flex items-center gap-3 transition-all ${flash ? 'bg-yellow-50 ring-1 ring-yellow-400' : ''} rounded-lg px-3 py-2`}>
      <span className="text-sm text-gray-500">Live rate</span>
      <span className="text-lg font-semibold text-gray-900">
        1 SGD = <span className="text-emerald-600">IDR {new Intl.NumberFormat('id-ID').format(Math.round(rate.effective_rate))}</span>
      </span>
      <span className="text-xs text-gray-400">refreshes in {secondsLeft}s</span>
      {flash && <span className="text-xs font-medium text-yellow-600">Rate updated</span>}
    </div>
  );
}
