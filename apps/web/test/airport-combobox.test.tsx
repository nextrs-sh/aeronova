import type { Airport } from '@velasia/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AirportCombobox, type AirportComboboxProps } from '@/features/search/airport-combobox';

const airports: Airport[] = [
  {
    code: 'MNL',
    name: 'Ninoy Aquino International Airport',
    city: 'Manila',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: true,
  },
  {
    code: 'CEB',
    name: 'Mactan–Cebu International Airport',
    city: 'Cebu',
    country: 'Philippines',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
    hub: true,
  },
  {
    code: 'NRT',
    name: 'Narita International Airport',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    hub: false,
  },
  {
    code: 'HND',
    name: 'Haneda Airport',
    city: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    timeZone: 'Asia/Tokyo',
    hub: false,
  },
];

function Harness(props: Partial<AirportComboboxProps> & { onValue?: (code: string) => void }) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <AirportCombobox
      id="origin"
      label="From"
      placeholder="City or airport"
      airports={airports}
      status="ready"
      onRetry={() => {}}
      {...props}
      value={value}
      onChange={(code) => {
        setValue(code);
        props.onValue?.(code);
      }}
    />
  );
}

describe('AirportCombobox', () => {
  it('exposes combobox semantics and suggests hubs first on focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'From' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('CEB'),
      expect.stringContaining('MNL'),
      expect.stringContaining('HND'),
      expect.stringContaining('NRT'),
    ]);
  });

  it('filters as the user types and selects with the keyboard', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = screen.getByRole('combobox', { name: 'From' });

    await user.type(input, 'tok');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant');
    expect(document.getElementById(active!)).toHaveTextContent('NRT');

    await user.keyboard('{Enter}');
    expect(onValue).toHaveBeenLastCalledWith('NRT');
    expect(input).toHaveValue('Tokyo (NRT)');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects an option by click', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getByRole('combobox', { name: 'From' }));
    await user.click(screen.getByRole('option', { name: /Manila/ }));
    expect(onValue).toHaveBeenLastCalledWith('MNL');
  });

  it('accepts an exact airport code typed then blurred', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    await user.type(screen.getByRole('combobox', { name: 'From' }), 'hnd');
    await user.tab();
    expect(onValue).toHaveBeenLastCalledWith('HND');
  });

  it('restores the previous selection on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness value="CEB" />);
    const input = screen.getByRole('combobox', { name: 'From' });
    expect(input).toHaveValue('Cebu (CEB)');
    await user.click(input);
    await user.keyboard('zzz');
    expect(screen.getByText(/No airports match/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(input).toHaveValue('Cebu (CEB)');
  });

  it('hides the airport chosen for the other end of the trip', async () => {
    const user = userEvent.setup();
    render(<Harness excludeCode="MNL" />);
    await user.click(screen.getByRole('combobox', { name: 'From' }));
    expect(screen.queryByRole('option', { name: /Manila/ })).not.toBeInTheDocument();
  });

  it('shows loading and retryable error states', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<Harness status="loading" airports={[]} />);
    await user.click(screen.getByRole('combobox', { name: 'From' }));
    expect(screen.getByText('Loading airports…')).toBeInTheDocument();

    rerender(<Harness status="error" airports={[]} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('links its error message for assistive technology', () => {
    render(<Harness error="Choose where you are flying from." />);
    const input = screen.getByRole('combobox', { name: 'From' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Choose where you are flying from.');
  });
});
