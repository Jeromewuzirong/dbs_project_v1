'use client';

import { useRouter } from 'next/navigation';

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="text-gray-500 hover:text-white transition-colors text-sm font-medium cursor-pointer"
    >
      ← Back
    </button>
  );
}
