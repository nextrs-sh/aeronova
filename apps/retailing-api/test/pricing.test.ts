import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/inventory/inventory';
import { demandBandFor, priceItinerary, segmentFare } from '../src/pricing/pricing';
import { SEED, TODAY, inventory } from './helpers';

const one = { adults: 1, children: 0, infants: 0 };
const flight = inventory.getInstance('NV501-20261215')!; // MNL→SIN, international
const domestic = inventory.getInstance('NV103-20261215')!; // MNL→CEB

describe('indicative pricing', () => {
  it('uses integer minor units with an explicit currency', () => {
    const price = priceItinerary([flight], 'economy', { adults: 2, children: 1, infants: 1 });
    expect(price.currency).toBe('PHP');
    expect(price.kind).toBe('indicative');
    for (const value of [price.perAdultMinor, price.totalMinor]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    for (const item of price.breakdown) {
      expect(Number.isInteger(item.fareMinor) && Number.isInteger(item.chargesMinor)).toBe(true);
      expect(item.subtotalMinor).toBe(item.count * (item.fareMinor + item.chargesMinor));
      expect(item.chargesMinor).toBe(item.charges.reduce((sum, c) => sum + c.amountMinor, 0));
    }
    expect(price.totalMinor).toBe(
      price.breakdown.reduce((sum, item) => sum + item.subtotalMinor, 0),
    );
  });

  it('includes every mandatory charge in the per-adult figure', () => {
    const price = priceItinerary([flight], 'economy', one);
    const [adult] = price.breakdown;
    expect(price.perAdultMinor).toBe(adult!.fareMinor + adult!.chargesMinor);
    expect(adult!.charges.map((charge) => charge.code)).toEqual([
      'PASSENGER_SERVICE',
      'FUEL_SURCHARGE',
    ]);
  });

  it('adds VAT on domestic flights only', () => {
    const codes = priceItinerary([domestic], 'economy', one).breakdown[0]!.charges.map(
      (c) => c.code,
    );
    expect(codes).toContain('VAT');
    const vat = priceItinerary([domestic], 'economy', one).breakdown[0]!.charges.find(
      (c) => c.code === 'VAT',
    )!;
    expect(vat.amountMinor).toBe(Math.round(segmentFare(domestic, 'economy') * 0.12) * 100);
  });

  it('charges children less than adults and lap infants a tenth with no seat charges', () => {
    const price = priceItinerary([flight], 'economy', { adults: 1, children: 1, infants: 1 });
    const [adult, child, infant] = price.breakdown;
    expect(child!.fareMinor).toBeLessThan(adult!.fareMinor);
    expect(child!.chargesMinor).toBe(adult!.chargesMinor);
    expect(infant!.fareMinor).toBeLessThanOrEqual(adult!.fareMinor * 0.11);
    expect(infant!.chargesMinor).toBe(0);
  });

  it('ranks cabins economy < premium economy < business', () => {
    const fares = (['economy', 'premium-economy', 'business'] as const).map((cabin) =>
      segmentFare(flight, cabin),
    );
    expect(fares[0]).toBeLessThan(fares[1]!);
    expect(fares[1]).toBeLessThan(fares[2]!);
  });

  it('costs more closer to departure', () => {
    // Same flight, seen from two reference dates.
    const early = new Inventory({ referenceDate: '2026-12-01', seed: SEED, horizonDays: 120 });
    const late = new Inventory({ referenceDate: '2027-02-08', seed: SEED, horizonDays: 120 });
    const id = 'NV501-20270210';
    // Compare the advance-purchase effect with demand held equal.
    const lateFlight = { ...late.getInstance(id)!, cabins: early.getInstance(id)!.cabins };
    expect(segmentFare(lateFlight, 'economy')).toBeGreaterThan(
      segmentFare(early.getInstance(id)!, 'economy'),
    );
  });

  it('prices longer routes higher', () => {
    const hkg = inventory.getInstance('NV531-20261215')!; // ~1,150 km
    const nrt = inventory.getInstance('NV551-20261215')!; // ~3,050 km
    expect(segmentFare(nrt, 'economy')).toBeGreaterThan(segmentFare(hkg, 'economy'));
  });

  it('discounts connections below the sum of their legs', () => {
    const first = inventory.getInstance('NV132-20261215')!; // ILO→MNL
    const second = inventory.getInstance('NV503-20261215')!; // MNL→SIN
    const connecting = priceItinerary([first, second], 'economy', one);
    const separate =
      priceItinerary([first], 'economy', one).perAdultMinor +
      priceItinerary([second], 'economy', one).perAdultMinor;
    expect(connecting.perAdultMinor).toBeLessThan(separate);
  });

  it('maps load factors to demand bands', () => {
    expect(demandBandFor(0.4).band).toBe('low');
    expect(demandBandFor(0.7).band).toBe('standard');
    expect(demandBandFor(0.9).band).toBe('high');
    expect(demandBandFor(1.05).band).toBe('peak');
  });

  it('is deterministic', () => {
    const again = new Inventory({ referenceDate: TODAY, seed: SEED, horizonDays: 120 });
    expect(priceItinerary([again.getInstance(flight.id)!], 'business', one)).toEqual(
      priceItinerary([flight], 'business', one),
    );
  });
});
