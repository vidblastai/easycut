import { describe, expect, it } from 'vitest';
import { splitLabelled } from '../remotion/components/MotionGraphics';

/**
 * The bar chart's labels come out of a language model as free text, so the
 * parser has to survive every reasonable way of writing "this label, that
 * number". Getting it wrong does not throw — it draws a chart where the bars
 * are all the same height, which looks deliberate and is a lie.
 */
describe('reading a bar out of what the director wrote', () => {
  it('takes a plain number', () => {
    expect(splitLabelled('Before 20')).toMatchObject({ label: 'Before', value: 20, unit: '' });
  });

  it('honours a magnitude suffix, and keeps how it was written', () => {
    // The bar's height needs the real magnitude; its readout needs "63K".
    expect(splitLabelled('This quarter 63K')).toMatchObject({
      label: 'This quarter', value: 63_000, scale: 1e3, unit: 'K',
    });
    expect(splitLabelled('Valuation 1.4M')).toMatchObject({
      label: 'Valuation', value: 1_400_000, scale: 1e6, unit: 'M',
    });
  });

  it('ignores a currency mark and thousands separators', () => {
    expect(splitLabelled('Revenue: $1,250')).toMatchObject({ label: 'Revenue', value: 1250 });
  });

  it('reads a percentage as its number and keeps the sign', () => {
    expect(splitLabelled('Churn 8%')).toMatchObject({ label: 'Churn', value: 8, unit: '%' });
  });

  it('keeps the whole string as the label when there is no number', () => {
    expect(splitLabelled('Just words')).toMatchObject({ label: 'Just words', value: 1 });
  });

  it('takes the last number when the label contains one', () => {
    expect(splitLabelled('Q1 2024 42')).toMatchObject({ label: 'Q1 2024', value: 42 });
  });

  it('scales two bars against each other correctly despite mixed units', () => {
    const a = splitLabelled('Last quarter 12K');
    const b = splitLabelled('This quarter 63K');
    expect(b.value / a.value).toBeCloseTo(5.25);
  });
});
