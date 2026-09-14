import { NextResponse } from 'next/server';
import { capabilities } from '@/lib/config/env';
import { isMusicAvailable } from '@/lib/assets/music';

export const runtime = 'nodejs';

/**
 * What is and isn't switched on. The setup banner and `npm run doctor` both
 * read this, so there is exactly one answer to "why doesn't my video have
 * captions".
 */
export async function GET() {
  const list = capabilities();
  const music = await isMusicAvailable();

  return NextResponse.json({
    capabilities: [
      ...list,
      {
        key: 'music',
        label: 'Music library',
        configured: music,
        fallback: 'Videos render without a music bed.',
        envVars: [],
        signupUrl: undefined,
      },
    ],
    ready: list.filter((c) => c.key === 'asr' || c.key === 'llm').every((c) => c.configured),
  });
}
