import { BookingInfo } from '@/features/home/booking-info';
import { FeaturedDestinations } from '@/features/home/featured-destinations';
import { Hero } from '@/features/home/hero';
import { Inspiration } from '@/features/home/inspiration';
import { PromoFares } from '@/features/home/promo-fares';
import { ServiceHighlights } from '@/features/home/service-highlights';
import { TravelYourWay } from '@/features/home/travel-your-way';

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeaturedDestinations />
      <PromoFares />
      <ServiceHighlights />
      <TravelYourWay />
      <Inspiration />
      <BookingInfo />
    </>
  );
}
