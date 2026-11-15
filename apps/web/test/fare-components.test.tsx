import { SERVICE_ROWS, type Offer, type OfferService } from '@velasia/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FareCard } from '@/features/shopping/fare-card';
import { FareMatrix, type MatrixColumn } from '@/features/shopping/fare-matrix';
import { OfferPriceBreakdown } from '@/features/shopping/offer-price-breakdown';

// The Server Action is a network call in the app; the components only need its identity.
vi.mock('@/features/shopping/actions', () => ({ selectOfferAction: vi.fn() }));

const service = (
  code: OfferService['code'],
  inclusion: OfferService['inclusion'],
  summary: string,
): OfferService => ({
  code,
  inclusion,
  allowance: null,
  fee: null,
  summary,
  detail: `${summary} — full condition`,
});
const services = (overrides: Partial<Record<OfferService['code'], OfferService>> = {}) =>
  SERVICE_ROWS.map(
    (row) => overrides[row.code] ?? service(row.code, 'not-included', 'Not included'),
  );

const price: Offer['price'] = {
  currency: 'PHP',
  totalMinor: 1_810_000,
  perAdultMinor: 873_000,
  totals: { baseFareMinor: 1_381_500, fareFamilyMinor: 268_500, taxesMinor: 160_000 },
  passengers: [
    {
      passengerType: 'adult',
      count: 2,
      baseFareMinor: 614_000,
      fareFamilyMinor: 119_000,
      taxesMinor: 140_000,
      taxes: [
        { code: 'PASSENGER_SERVICE', label: 'Passenger service charge (MNL)', amountMinor: 95_000 },
        { code: 'FUEL_SURCHARGE', label: 'Fuel surcharge', amountMinor: 45_000 },
      ],
      unitTotalMinor: 873_000,
      subtotalMinor: 1_746_000,
    },
    {
      passengerType: 'infant',
      count: 1,
      baseFareMinor: 61_500,
      fareFamilyMinor: 30_500,
      taxesMinor: 0,
      taxes: [],
      unitTotalMinor: 64_000,
      subtotalMinor: 64_000,
    },
  ],
};

describe('FareMatrix', () => {
  const columns: MatrixColumn[] = [
    {
      code: 'LIGHT',
      name: 'Velasia Light',
      shortName: 'Light',
      services: services({ FLIGHT_CHANGE: service('FLIGHT_CHANGE', 'fee', '₱2,500 fee') }),
      totalMinor: 754_000,
      currency: 'PHP',
    },
    {
      code: 'BUSINESS',
      name: 'Velasia Business',
      shortName: 'Business',
      services: services({ LOUNGE: service('LOUNGE', 'included', 'Manila and Cebu') }),
      totalMinor: null,
      currency: 'PHP',
    },
  ];

  it('renders one row per service and one column per family, from data', () => {
    render(<FareMatrix columns={columns} />);
    const table = screen.getByRole('table');
    const head = table.querySelector('thead')! as HTMLElement;
    expect(
      within(head)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Velasia Light₱7,540', 'Velasia BusinessNot available']);
    const rowHeaders = within(table)
      .getAllByRole('rowheader')
      .map((th) => th.textContent);
    expect(rowHeaders).toEqual(SERVICE_ROWS.map((row) => row.label));
    // Grouped by category, so related rows read together.
    expect([...table.querySelectorAll('th[scope="colgroup"]')].map((th) => th.textContent)).toEqual(
      ['Baggage', 'Seats', 'Changes and refunds', 'Airport and on board'],
    );
  });

  it('states inclusion in words, not only colour, and shows each condition', () => {
    render(<FareMatrix columns={columns} />);
    const table = screen.getByRole('table');
    const change = within(table).getByRole('row', { name: /Flight changes/ });
    expect(change).toHaveTextContent('Fee applies: ₱2,500 fee');
    expect(change).toHaveTextContent('₱2,500 fee — full condition');
    expect(within(table).getByRole('row', { name: /Lounge access/ })).toHaveTextContent(
      'Included: Manila and Cebu',
    );
  });
});

describe('FareCard', () => {
  const family = {
    code: 'CLASSIC' as const,
    name: 'Velasia Classic',
    shortName: 'Classic',
    tagline: 'A checked bag and your choice of seat.',
    cabin: 'economy' as const,
  };
  const offer = {
    id: 'off_AbCdEfGhIjKlMnOpQrStUv',
    family: 'CLASSIC',
    services: services({ CHECKED_BAGGAGE: service('CHECKED_BAGGAGE', 'included', '1 × 20 kg') }),
    price,
  } as unknown as Offer;
  const form = { query: 'trip=one-way', direction: 'outbound' as const };

  it('shows the total for the party, highlights, and a select form that carries no price', () => {
    const { container } = render(
      <FareCard
        family={family}
        offer={offer}
        current={null}
        form={form}
        party="2 adults, 1 infant"
      />,
    );
    expect(screen.getByTestId('fare-total')).toHaveTextContent('₱18,100');
    expect(screen.getByText(/Total for 2 adults, 1 infant · ₱8,730 per adult/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Classic includes' })).toHaveTextContent('1 × 20 kg');
    const hidden = [...container.querySelectorAll('input[type="hidden"]')].map(
      (input) => (input as HTMLInputElement).name,
    );
    expect(hidden.sort()).toEqual(['direction', 'offerId', 'query']);
    expect(screen.getByRole('button', { name: /Select Classic/ })).toBeInTheDocument();
  });

  it('shows the difference from the current choice', () => {
    render(
      <FareCard
        family={family}
        offer={offer}
        current={{ family: 'LIGHT', name: 'Velasia Light', totalMinor: 1_500_000 }}
        form={form}
        party={null}
      />,
    );
    expect(screen.getByTestId('fare-difference')).toHaveTextContent(
      '+₱3,100 compared with Velasia Light',
    );
  });

  it('marks the current choice', () => {
    render(
      <FareCard
        family={family}
        offer={offer}
        current={{ family: 'CLASSIC', name: 'Velasia Classic', totalMinor: price.totalMinor }}
        form={form}
        party={null}
      />,
    );
    expect(screen.getByText('Your choice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Classic/ })).toBeInTheDocument();
  });

  it('explains an unavailable family and offers no way to select it', () => {
    render(
      <FareCard
        family={{ ...family, code: 'BUSINESS', name: 'Velasia Business', cabin: 'business' }}
        offer={null}
        unavailableMessage="The Airbus A320neo has no Business cabin."
        current={null}
        form={form}
        party={null}
      />,
    );
    expect(screen.getByTestId('fare-unavailable')).toHaveTextContent('no Business cabin');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OfferPriceBreakdown', () => {
  it('itemises each passenger type and states that included services cost nothing extra', () => {
    render(<OfferPriceBreakdown price={price} familyName="Classic" />);
    const [adults, infant] = screen.getAllByRole('listitem');
    expect(adults).toHaveTextContent('2 Adults₱17,460');
    expect(adults).toHaveTextContent('Flight base fare, each₱6,140');
    expect(adults).toHaveTextContent('Classic fare benefits₱1,190');
    expect(adults).toHaveTextContent('Fuel surcharge₱450');
    expect(infant).toHaveTextContent('Taxes and feesNone (lap infant)');
    expect(screen.getAllByText('No extra charge').length).toBeGreaterThan(0);
    expect(screen.getByText('Total, all travellers').nextSibling).toHaveTextContent('₱18,100');
  });
});
