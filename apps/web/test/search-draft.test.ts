import { DEFAULT_SEARCH_DRAFT } from '@velasia/contracts';
import { describe, expect, it } from 'vitest';
import { restoreDraft } from '@/stores/search-draft';

const today = '2026-11-15';
const saved = {
  ...DEFAULT_SEARCH_DRAFT,
  origin: 'MNL',
  destination: 'CEB',
  departDate: '2026-12-01',
  returnDate: '2026-12-05',
};

describe('restoreDraft', () => {
  it('restores a valid saved draft', () => {
    expect(restoreDraft(saved, today)).toEqual(saved);
  });

  it('discards malformed or tampered storage', () => {
    expect(restoreDraft(null, today)).toBeNull();
    expect(restoreDraft({ origin: 42 }, today)).toBeNull();
    expect(restoreDraft({ ...saved, cabin: 'first' }, today)).toBeNull();
  });

  it('drops dates that are now in the past', () => {
    expect(restoreDraft({ ...saved, departDate: '2026-11-01' }, today)).toMatchObject({
      departDate: '',
      returnDate: '',
    });
    expect(restoreDraft({ ...saved, returnDate: 'garbage' }, today)?.returnDate).toBe('');
  });

  it('applies a destination preset and clears a clashing origin', () => {
    expect(restoreDraft(saved, today, 'NRT')).toMatchObject({ origin: 'MNL', destination: 'NRT' });
    expect(restoreDraft(saved, today, 'MNL')).toMatchObject({ origin: '', destination: 'MNL' });
  });
});
