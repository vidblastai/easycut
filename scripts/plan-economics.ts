import { PLANS, PAID_PLANS, planEconomics, videosFor } from '@/lib/billing/plans';
const rows = [PLANS.free, ...PAID_PLANS];
console.log('plan      price    minutes  ≈shorts ≈long   pipeline storage  stripe   total    profit   margin  $/min');
for (const p of rows) {
  const e = planEconomics(p); const v = videosFor(p);
  console.log(
    p.name.padEnd(9),
    ('$' + p.priceUsd.toFixed(2)).padStart(7),
    String(p.footageMinutes).padStart(8),
    String(v.shorts).padStart(7), String(v.long).padStart(6),
    ('$' + e.pipelineUsd.toFixed(2)).padStart(9),
    ('$' + e.storageUsd.toFixed(2)).padStart(8),
    ('$' + e.paymentFeeUsd.toFixed(2)).padStart(8),
    ('$' + e.totalCostUsd.toFixed(2)).padStart(8),
    ('$' + e.grossProfitUsd.toFixed(2)).padStart(8),
    ((e.grossMargin * 100).toFixed(1) + '%').padStart(7),
    ('$' + e.pricePerMinuteUsd.toFixed(3)).padStart(7),
  );
}
console.log('\nretention:');
for (const p of rows) console.log(' ', p.name.padEnd(9), 'source', String(p.sourceRetentionDays).padStart(3), 'days   video', p.renderRetentionDays === null ? 'while subscribed' : p.renderRetentionDays + ' days');
