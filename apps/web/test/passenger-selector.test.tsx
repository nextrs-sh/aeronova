import type { PassengerCounts } from '@velasia/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PassengerSelector } from '@/features/search/passenger-selector';

function Harness({ initial }: { initial: PassengerCounts }) {
  const [value, setValue] = useState(initial);
  return <PassengerSelector id="pax" value={value} onChange={setValue} />;
}

async function open(initial: PassengerCounts) {
  const user = userEvent.setup();
  render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: /Passengers/ }));
  return user;
}

describe('PassengerSelector', () => {
  it('summarises the selection on its trigger', () => {
    render(<Harness initial={{ adults: 2, children: 1, infants: 0 }} />);
    expect(
      screen.getByRole('button', { name: 'Passengers: 2 Adults, 1 Child' }),
    ).toBeInTheDocument();
  });

  it('never allows fewer than one adult', async () => {
    await open({ adults: 1, children: 0, infants: 0 });
    expect(screen.getByRole('button', { name: 'Remove one adult' })).toBeDisabled();
  });

  it('limits infants to one per adult, and protects adults with lap infants', async () => {
    const user = await open({ adults: 1, children: 0, infants: 0 });
    await user.click(screen.getByRole('button', { name: 'Add one infant' }));
    expect(screen.getByRole('button', { name: 'Add one infant' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add one adult' }));
    await user.click(screen.getByRole('button', { name: 'Add one infant' }));
    expect(screen.getByRole('button', { name: 'Remove one adult' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Passengers: 2 Adults, 2 Infants/ }),
    ).toBeInTheDocument();
  });

  it('caps seated passengers at nine', async () => {
    const user = await open({ adults: 8, children: 0, infants: 0 });
    await user.click(screen.getByRole('button', { name: 'Add one child' }));
    expect(screen.getByRole('button', { name: 'Add one adult' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one child' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add one infant' })).toBeEnabled();
  });
});
