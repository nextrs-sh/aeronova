import { describe, expect, it } from 'vitest';
import {
  ageOn,
  contactInputSchema,
  createTravellersFormSchema,
  seatProblem,
  travellerInputSchema,
  travellerSlots,
  travellerTypeOf,
  type TravellerInput,
} from '../src';

const context = {
  slots: travellerSlots({ adults: 1, children: 1, infants: 1 }),
  firstTravelDate: '2026-12-15',
  lastTravelDate: '2026-12-20',
};
const adult: TravellerInput = {
  id: 'ADT1',
  type: 'adult',
  title: '',
  givenName: 'Amihan',
  middleName: '',
  familyName: 'Dela Cruz',
  dateOfBirth: '1990-04-12',
  nationality: 'PH',
  specialAssistance: '',
  infantOf: '',
};
const child: TravellerInput = { ...adult, id: 'CHD1', type: 'child', dateOfBirth: '2018-06-01' };
const infant: TravellerInput = {
  ...adult,
  id: 'INF1',
  type: 'infant',
  dateOfBirth: '2026-03-10',
  infantOf: 'ADT1',
};
const contact = { email: 'Amihan@Example.com ', phone: '+63 (917) 555-0123' };

describe('traveller slots', () => {
  it('are fixed by the priced party, adults first', () => {
    expect(context.slots.map((slot) => [slot.id, slot.label])).toEqual([
      ['ADT1', 'Adult 1'],
      ['CHD1', 'Child 1'],
      ['INF1', 'Infant 1'],
    ]);
    expect(travellerTypeOf('CHD2')).toBe('child');
    expect(travellerTypeOf('XYZ1')).toBeNull();
  });
});

describe('ageOn', () => {
  it('counts whole years on a date, including leap-day birthdays', () => {
    expect(ageOn('2014-12-15', '2026-12-15')).toBe(12);
    expect(ageOn('2014-12-16', '2026-12-15')).toBe(11);
    expect(ageOn('2020-02-29', '2026-02-28')).toBe(5);
    expect(ageOn('2020-02-29', '2026-03-01')).toBe(6);
  });
});

describe('the traveller form schema', () => {
  const schema = createTravellersFormSchema(context);

  it('accepts a valid party and normalises optional fields, names, email, and phone', () => {
    const result = schema.parse({ passengers: [adult, child, infant], contact });
    expect(result.passengers[0]).toMatchObject({ title: null, middleName: null, infantOf: null });
    expect(result.passengers[2]!.infantOf).toBe('ADT1');
    expect(result.contact).toEqual({ email: 'amihan@example.com', phone: '+639175550123' });
  });

  it('reports each problem on its field', () => {
    const result = schema.safeParse({
      passengers: [
        { ...adult, givenName: ' ', dateOfBirth: '2016-01-01' },
        { ...child, dateOfBirth: '2010-01-01' },
        { ...infant, infantOf: '' },
      ],
      contact: { email: 'nope', phone: '12345' },
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['passengers.0.givenName', 'contact.email', 'contact.phone']),
    );
  });

  it('applies the trip rules once fields are valid', () => {
    const result = schema.safeParse({
      passengers: [
        { ...adult, dateOfBirth: '2016-01-01' },
        { ...child, dateOfBirth: '2010-01-01' },
        { ...infant, infantOf: '' },
      ],
      contact,
    });
    const messages = Object.fromEntries(
      result.error!.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
    expect(messages['passengers.0.dateOfBirth']).toMatch(/Adults must be 12 or older/);
    expect(messages['passengers.1.dateOfBirth']).toMatch(/Children must be 2–11/);
    expect(messages['passengers.2.infantOf']).toMatch(/Choose the adult/);
  });

  it('rejects names with digits or symbols and too-short family names', () => {
    expect(travellerInputSchema.safeParse({ ...adult, givenName: 'J0hn' }).success).toBe(false);
    expect(travellerInputSchema.safeParse({ ...adult, familyName: 'X' }).success).toBe(false);
    expect(travellerInputSchema.safeParse({ ...adult, givenName: 'José María' }).success).toBe(
      true,
    );
    expect(travellerInputSchema.safeParse({ ...adult, familyName: "O'Brien-Lim" }).success).toBe(
      true,
    );
  });

  it('requires a country code on phone numbers', () => {
    expect(contactInputSchema.safeParse({ ...contact, phone: '0917 555 0123' }).success).toBe(
      false,
    );
  });
});

describe('seatProblem', () => {
  const traveller = { seatable: true, exitRowAllowed: true };
  const seat = { status: 'AVAILABLE' as const, cabin: 'economy' as const, restrictions: [] };
  const fareCabin = 'economy' as const;
  it('explains why a traveller can’t have a seat', () => {
    expect(seatProblem(seat, { fareCabin, traveller, takenByOther: false })).toBeNull();
    expect(
      seatProblem({ ...seat, status: 'OCCUPIED' }, { fareCabin, traveller, takenByOther: false }),
    ).toBe('occupied');
    expect(
      seatProblem({ ...seat, cabin: 'business' }, { fareCabin, traveller, takenByOther: false }),
    ).toBe('other-cabin');
    expect(
      seatProblem(
        { ...seat, restrictions: ['EXIT_ROW'] },
        { fareCabin, traveller: { ...traveller, exitRowAllowed: false }, takenByOther: false },
      ),
    ).toBe('exit-row');
    expect(
      seatProblem(seat, {
        fareCabin,
        traveller: { seatable: false, exitRowAllowed: false },
        takenByOther: false,
      }),
    ).toBe('not-seatable');
    expect(seatProblem(seat, { fareCabin, traveller, takenByOther: true })).toBe(
      'taken-by-companion',
    );
  });
});
