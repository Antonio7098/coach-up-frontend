import { redirect } from 'next/navigation';
import { devLog } from './api/lib/observability';

export default function Home() {
  devLog("info", "page: home page accessed, redirecting to coach-min", {
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  });

  redirect('/coach-min');
}
