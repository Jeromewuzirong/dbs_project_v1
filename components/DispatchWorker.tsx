'use client';

import { useEffect } from 'react';

// Invisible component mounted in the root layout.
// Every 2 s it checks localStorage: if Auto Mode is on it fires
// POST /api/dispatch so the kitchen dispatcher keeps running
// regardless of which page the user has open.
export default function DispatchWorker() {
  useEffect(() => {
    const id = setInterval(() => {
      if (localStorage.getItem('kitchen_auto_mode') !== 'true') return;
      fetch('/api/dispatch', { method: 'POST' }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return null;
}
