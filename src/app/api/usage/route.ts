import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { usageFor } from '@/lib/billing/usage';
import { getPlan } from '@/lib/billing/plans';

export const runtime = 'nodejs';

/**
 * How much of this month's allowance is left.
 *
 * Its own endpoint so the meter in the sidebar can fetch it rather than being
 * threaded as a prop through every page that renders the shell. Reading it also
 * rolls the billing period forward when it is due — see src/lib/billing/usage.ts
 * — which is why a signed-in user visiting any page is enough to keep the meter
 * honest without a scheduled job.
 */
export async function GET() {
  const userId = await currentUserId();

  // No auth configured: a self-hosted clone has no account to meter, and the
  // sidebar should show nothing rather than a meaningless zero.
  if (!userId) return NextResponse.json({ metered: false });

  const usage = await usageFor(userId);
  if (!usage) return NextResponse.json({ metered: false });

  return NextResponse.json({
    metered: true,
    plan: { id: usage.plan.id, name: usage.plan.name, footageMinutes: usage.plan.footageMinutes },
    minutesUsed: usage.minutesUsed,
    minutesRemaining: usage.minutesRemaining,
    periodEnd: usage.periodEnd,
  });
}
