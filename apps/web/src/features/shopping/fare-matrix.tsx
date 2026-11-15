import {
  SERVICE_ROWS,
  serviceFor,
  type FareFamilyCode,
  type OfferService,
  type ServiceCategory,
} from '@velasia/contracts';
import { formatMinor } from '@/lib/format';
import { ServiceValue } from './service-value';

export interface MatrixColumn {
  code: FareFamilyCode;
  name: string;
  shortName: string;
  services: readonly OfferService[];
  /** `null` when the family isn't offered on this flight. */
  totalMinor: number | null;
  currency: string;
}

const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  baggage: 'Baggage',
  seating: 'Seats',
  flexibility: 'Changes and refunds',
  comfort: 'Airport and on board',
};

const groups = (Object.keys(CATEGORY_LABELS) as ServiceCategory[]).map((category) => ({
  category,
  rows: SERVICE_ROWS.filter((row) => row.category === category),
}));

/**
 * The full fare comparison, rendered from data: one row per service, one column per family.
 * A table from the `md` breakpoint; below it, the same data as one list per feature, so phones
 * never scroll sideways.
 */
export function FareMatrix({ columns }: { columns: MatrixColumn[] }) {
  const price = (column: MatrixColumn) =>
    column.totalMinor === null ? 'Not available' : formatMinor(column.totalMinor, column.currency);
  return (
    <div data-testid="fare-matrix">
      <table className="hidden w-full table-fixed border-collapse text-left text-sm md:table">
        <caption className="sr-only">
          Fare features by fare family. Prices are totals for all travellers.
        </caption>
        <thead>
          <tr>
            <td className="w-[20%]" />
            {columns.map((column) => (
              <th key={column.code} scope="col" className="px-3 pb-4 align-bottom">
                <span className="block font-display text-base font-bold text-ink">
                  {column.name}
                </span>
                <span className="block text-sm font-semibold text-ink-muted tabular-nums">
                  {price(column)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map(({ category, rows }) => (
          <tbody key={category}>
            <tr>
              <th
                scope="colgroup"
                colSpan={columns.length + 1}
                className="border-t border-line pt-4 pb-2 text-xs font-bold tracking-[0.12em] text-ink-muted uppercase"
              >
                {CATEGORY_LABELS[category]}
              </th>
            </tr>
            {rows.map((row) => (
              <tr key={row.code} className="border-t border-line/70">
                <th scope="row" className="py-3 pr-3 align-top font-semibold text-ink">
                  {row.label}
                </th>
                {columns.map((column) => (
                  <td key={column.code} className="px-3 py-3 align-top">
                    <ServiceValue service={serviceFor(column.services, row.code)} detailed />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <div className="space-y-6 md:hidden">
        {SERVICE_ROWS.map((row) => (
          <section key={row.code} aria-labelledby={`matrix-${row.code}`}>
            <h4 id={`matrix-${row.code}`} className="font-semibold text-ink">
              {row.label}
            </h4>
            <dl className="mt-2 divide-y divide-line rounded-xl border border-line">
              {columns.map((column) => (
                <div
                  key={column.code}
                  className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 p-3 text-sm"
                >
                  <dt className="font-semibold text-ink-muted">{column.shortName}</dt>
                  <dd className="min-w-0">
                    <ServiceValue service={serviceFor(column.services, row.code)} detailed />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
