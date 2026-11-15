import type { FareFamiliesResponse, FareFamilyCode } from '@velasia/contracts';
import type { ContentResult } from '@/lib/content';

const SHORT: Record<FareFamilyCode, string> = {
  LIGHT: 'Light',
  CLASSIC: 'Classic',
  FLEX: 'Flex',
  BUSINESS: 'Business',
};

/** Display names from the fare family catalogue, with a plain fallback if it can't load. */
export function familyNamer(catalogue: ContentResult<FareFamiliesResponse>) {
  const byCode = new Map((catalogue.ok ? catalogue.data.data : []).map((f) => [f.code, f]));
  return (code: FareFamilyCode) => ({
    name: byCode.get(code)?.name ?? `Velasia ${SHORT[code]}`,
    shortName: byCode.get(code)?.shortName ?? SHORT[code],
  });
}
