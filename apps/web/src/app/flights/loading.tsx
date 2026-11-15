import { FlightsLoading } from './flights-loading';

// Safe here: /flights never calls notFound(), so an early 200 is always correct.
export default function Loading() {
  return <FlightsLoading />;
}
