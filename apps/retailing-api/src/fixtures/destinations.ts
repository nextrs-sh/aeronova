import { destinationSchema, iataCodeSchema, type Destination } from '@velasia/contracts';
import { z } from 'zod';

/**
 * Editorial destination content. Routes and the "from" fare are not authored
 * here: the catalogue derives them from the flight network and indicative
 * pricing, so a destination page can never contradict search results.
 */
export interface DestinationContent extends Omit<Destination, 'routes' | 'illustrativeFare'> {
  /** Departure airport for the destination's "from" fare. */
  fareOrigin?: string;
}

const destinationContentSchema = destinationSchema
  .omit({ routes: true, illustrativeFare: true })
  .extend({ fareOrigin: iataCodeSchema.optional() });

const PH_INFO = {
  timeZone: 'Asia/Manila',
  utcOffset: 'UTC+8',
  currency: 'Philippine peso (PHP)',
  language: 'Filipino and English',
};

const destinations: DestinationContent[] = [
  {
    slug: 'manila',
    name: 'Manila',
    country: 'Philippines',
    countryCode: 'PH',
    region: 'philippines',
    airportCodes: ['MNL'],
    featured: false,
    tagline: 'Old walls, new skylines, and the best sunsets on the bay.',
    summary:
      'The Philippine capital layers Spanish-era Intramuros, a buzzing food scene, and the glittering towers of Makati and BGC.',
    description: [
      'Manila rewards travellers who slow down. Walk the cobbled lanes of Intramuros at golden hour, then cross the river to Binondo, one of the oldest Chinatowns in the world, for dumplings and hopia still warm from the oven.',
      'As AeroNova’s home hub, Manila is also where many journeys begin. Give yourself a day or two on either side of your trip to explore the galleries of the National Museum and the cafés of Poblacion.',
    ],
    image: {
      src: '/images/destinations/manila.jpg',
      alt: 'Manila skyline of white high-rise towers rising behind a marina of moored yachts on calm Manila Bay at dusk, with a waterfront lamp and chain railing in the foreground',
    },
    highlights: [
      {
        title: 'Intramuros',
        description:
          'Explore the walled city by bamboo bike or on foot, from Fort Santiago to San Agustin Church.',
      },
      {
        title: 'Binondo food crawl',
        description:
          'Taste your way through generations-old bakeries, noodle houses, and dumpling counters.',
      },
      {
        title: 'Manila Bay sunset',
        description: 'Join locals along Roxas Boulevard as the sky turns amber over the water.',
      },
    ],
    tags: ['City', 'Food', 'History'],
    travelInfo: { ...PH_INFO, bestTimeToVisit: 'December to April, during the cooler dry season' },
    fareOrigin: 'CEB',
  },
  {
    slug: 'cebu',
    name: 'Cebu',
    country: 'Philippines',
    countryCode: 'PH',
    region: 'philippines',
    airportCodes: ['CEB'],
    featured: true,
    tagline: 'Island-hop from a city that never forgot the sea.',
    summary:
      'The Queen City of the South pairs centuries of history with turquoise waterfalls, whale-shark waters, and white-sand islands a short boat ride away.',
    description: [
      'Cebu is where the Philippines’ story often begins, from Magellan’s Cross to the Basilica del Santo Niño. Beyond the city, the island stretches south to canyoneering at Kawasan Falls and the sardine runs of Moalboal.',
      'Our second hub makes Cebu an easy gateway to the Visayas. Base yourself on Mactan for resort days, or head north to Bantayan and Malapascua for quieter beaches.',
    ],
    image: {
      src: '/images/destinations/cebu.jpg',
      alt: 'Kawasan Falls in Cebu: twin waterfalls pouring into a turquoise jungle pool with a bamboo raft floating in the foreground',
    },
    highlights: [
      {
        title: 'Kawasan Falls',
        description: 'Swim and jump through tiers of milky-blue pools in the forest of Badian.',
      },
      {
        title: 'Island hopping',
        description: 'Snorkel the reefs around Mactan, Nalusuan, and Hilutungan in a single day.',
      },
      {
        title: 'Lechon, done right',
        description:
          'Locals will tell you the island’s roast pig is the best in the country — test the claim.',
      },
    ],
    tags: ['Beach', 'Adventure', 'Food'],
    travelInfo: { ...PH_INFO, bestTimeToVisit: 'January to May, for calm seas and sunny days' },
    fareOrigin: 'MNL',
    promotion: {
      headline: 'Island weekends',
      blurb:
        'Swap the city for clear water. Fly to Cebu on Friday, be on a boat by Saturday morning.',
    },
  },
  {
    slug: 'davao',
    name: 'Davao',
    country: 'Philippines',
    countryCode: 'PH',
    region: 'philippines',
    airportCodes: ['DVO'],
    featured: false,
    tagline: 'Durian, mountain air, and the gateway to Mindanao.',
    summary:
      'A green, easy-going city in the shadow of Mount Apo, with island beaches on Samal just across the gulf.',
    description: [
      'Davao is the Philippines’ fruit basket. Markets overflow with pomelo, mangosteen, and the famously divisive durian, while the slopes of Mount Apo — the country’s highest peak — grow some of its best coffee and cacao.',
      'Take a short ferry to the Island Garden City of Samal for coves and coral, or visit the Philippine Eagle Center to meet the national bird up close.',
    ],
    image: {
      src: '/images/destinations/davao.jpg',
      alt: 'Two coconut palms silhouetted above tropical forest on Samal Island, overlooking the calm Davao Gulf and a long jetty under a blue dusk sky',
    },
    highlights: [
      {
        title: 'Mount Apo',
        description: 'Trek through mossy forest to the summit of the country’s highest mountain.',
      },
      {
        title: 'Samal Island',
        description: 'White-sand coves and snorkel spots, ten minutes from the city by ferry.',
      },
      {
        title: 'Philippine Eagle Center',
        description: 'See one of the world’s rarest raptors and learn how it is being protected.',
      },
    ],
    tags: ['Nature', 'Food', 'Adventure'],
    travelInfo: { ...PH_INFO, bestTimeToVisit: 'Year-round; Davao sits south of the typhoon belt' },
    fareOrigin: 'MNL',
  },
  {
    slug: 'singapore',
    name: 'Singapore',
    country: 'Singapore',
    countryCode: 'SG',
    region: 'southeast-asia',
    airportCodes: ['SIN'],
    featured: true,
    tagline: 'A garden city with a hawker stall on every corner.',
    summary:
      'Futuristic gardens, heritage shophouses, and some of the best-value food in Asia, all connected by a spotless metro.',
    description: [
      'Singapore packs a remarkable amount into a small island. Mornings can start with kaya toast in Tiong Bahru, afternoons in the cloud forest domes at Gardens by the Bay, and evenings on Joo Chiat’s pastel streets.',
      'The city’s hawker centres are a UNESCO-recognised institution. Bring an appetite and an open mind: chicken rice, laksa, and satay rarely cost more than a few dollars.',
    ],
    image: {
      src: '/images/destinations/singapore.jpg',
      alt: 'Singapore’s Marina Bay at blue hour: the illuminated Helix Bridge leads towards the Marina Bay Sands towers and the lotus-shaped ArtScience Museum, reflected in the water',
    },
    highlights: [
      {
        title: 'Gardens by the Bay',
        description: 'Walk beneath the Supertrees and through the misty Cloud Forest dome.',
      },
      {
        title: 'Hawker centres',
        description:
          'From Maxwell to Lau Pa Sat, eat like a local for a fraction of restaurant prices.',
      },
      {
        title: 'Neighbourhood walks',
        description: 'Explore Kampong Glam, Little India, and Katong for colour and culture.',
      },
    ],
    tags: ['City', 'Food', 'Family'],
    travelInfo: {
      timeZone: 'Asia/Singapore',
      utcOffset: 'UTC+8',
      currency: 'Singapore dollar (SGD)',
      language: 'English, Mandarin, Malay, and Tamil',
      bestTimeToVisit: 'February to April, the driest months',
    },
    fareOrigin: 'MNL',
    promotion: {
      headline: 'A long weekend in the Lion City',
      blurb:
        'Three days, twelve hawker stalls, one very good chilli crab. We’ll handle the flight.',
    },
  },
  {
    slug: 'tokyo',
    name: 'Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    region: 'east-asia',
    airportCodes: ['NRT', 'HND'],
    featured: true,
    tagline: 'Neon nights, quiet shrines, and perfect ramen in between.',
    summary:
      'The world’s largest city is also one of its most orderly — a place where centuries-old temples sit beside the bright lights of Shibuya.',
    description: [
      'Tokyo is best understood one neighbourhood at a time. Wander the incense-scented lanes around Senso-ji in Asakusa, browse vintage stores in Shimokitazawa, then lose track of time beneath the lights of Shinjuku.',
      'Spring cherry blossoms and autumn foliage draw the crowds, but winter brings crisp, clear days with views of Mount Fuji from the city’s observation decks.',
    ],
    image: {
      src: '/images/destinations/tokyo.jpg',
      alt: 'Tokyo skyline at golden hour, with the red-and-white Tokyo Tower rising among dense high-rises in Minato City',
    },
    highlights: [
      {
        title: 'Asakusa and Senso-ji',
        description:
          'Tokyo’s oldest temple, approached through the bustling Nakamise shopping street.',
      },
      {
        title: 'Shibuya Crossing',
        description:
          'Watch thousands cross at once from above, then dive into the side streets for izakaya.',
      },
      {
        title: 'Day trip to Hakone',
        description: 'Hot springs, a lake cruise, and — on a clear day — Mount Fuji.',
      },
    ],
    tags: ['City', 'Food', 'Culture'],
    travelInfo: {
      timeZone: 'Asia/Tokyo',
      utcOffset: 'UTC+9',
      currency: 'Japanese yen (JPY)',
      language: 'Japanese',
      bestTimeToVisit: 'March to May and October to November',
    },
    fareOrigin: 'MNL',
    promotion: {
      headline: 'Cherry blossom season',
      blurb: 'Plan early for sakura. Spring in Tokyo is worth every minute of the wait.',
    },
  },
  {
    slug: 'seoul',
    name: 'Seoul',
    country: 'South Korea',
    countryCode: 'KR',
    region: 'east-asia',
    airportCodes: ['ICN'],
    featured: true,
    tagline: 'Palaces by day, barbecue and karaoke by night.',
    summary:
      'A capital that moves fast — royal palaces, mountain trails inside the city limits, and a café culture that rivals anywhere.',
    description: [
      'Seoul blends 600 years of history with an unmistakably modern energy. Rent a hanbok and step into Gyeongbokgung Palace, then walk the hanok alleys of Bukchon on your way to the galleries of Samcheong-dong.',
      'Evenings belong to the markets. Gwangjang Market’s bindaetteok and the street stalls of Myeongdong are a rite of passage, and the city’s night views from Namsan Tower are worth the climb.',
    ],
    image: {
      src: '/images/destinations/seoul.jpg',
      alt: 'Gyeonghoeru, a large two-storey wooden pavilion on stone pillars at Gyeongbokgung Palace in Seoul, reflected in its pond under a clear autumn sky',
    },
    highlights: [
      {
        title: 'Gyeongbokgung Palace',
        description: 'Catch the changing of the guard at the grandest of Seoul’s five palaces.',
      },
      {
        title: 'Bukchon Hanok Village',
        description: 'Hundreds of traditional homes on hillside lanes between two palaces.',
      },
      {
        title: 'Gwangjang Market',
        description: 'Crispy mung-bean pancakes and mayak gimbap at one of Korea’s oldest markets.',
      },
    ],
    tags: ['City', 'Culture', 'Shopping'],
    travelInfo: {
      timeZone: 'Asia/Seoul',
      utcOffset: 'UTC+9',
      currency: 'South Korean won (KRW)',
      language: 'Korean',
      bestTimeToVisit: 'April to June and September to November',
    },
    fareOrigin: 'MNL',
  },
  {
    slug: 'bangkok',
    name: 'Bangkok',
    country: 'Thailand',
    countryCode: 'TH',
    region: 'southeast-asia',
    airportCodes: ['BKK'],
    featured: true,
    tagline: 'Golden temples, river boats, and street food after midnight.',
    summary:
      'Thailand’s capital is a sensory city of gilded temples, floating markets, rooftop bars, and some of the world’s greatest street food.',
    description: [
      'Start where the city started: on the Chao Phraya River. Long-tail boats and river ferries link the Grand Palace, Wat Pho’s reclining Buddha, and Wat Arun’s porcelain-studded spire.',
      'Bangkok’s food scene runs from Michelin-recognised street stalls in Yaowarat to elegant tasting menus. In between, there are night markets, Thai massage, and endless coconut ice cream.',
    ],
    image: {
      src: '/images/destinations/bangkok.jpg',
      alt: 'Wat Arun’s tall central prang and smaller spires rising above the Chao Phraya River in Bangkok, with long-tail boats on the water and flags along the riverbank',
    },
    highlights: [
      {
        title: 'Grand Palace and Wat Pho',
        description: 'Gilded halls and a 46-metre reclining Buddha, side by side on the river.',
      },
      {
        title: 'Yaowarat after dark',
        description: 'Chinatown’s neon-lit main street becomes an open-air food hall at night.',
      },
      {
        title: 'Chatuchak Weekend Market',
        description: 'Thousands of stalls selling everything from ceramics to vintage denim.',
      },
    ],
    tags: ['City', 'Food', 'Culture'],
    travelInfo: {
      timeZone: 'Asia/Bangkok',
      utcOffset: 'UTC+7',
      currency: 'Thai baht (THB)',
      language: 'Thai',
      bestTimeToVisit: 'November to February, during the cool season',
    },
    fareOrigin: 'MNL',
  },
  {
    slug: 'hong-kong',
    name: 'Hong Kong',
    country: 'Hong Kong SAR',
    countryCode: 'HK',
    region: 'east-asia',
    airportCodes: ['HKG'],
    featured: false,
    tagline: 'A harbour skyline, hiking trails, and dim sum all day.',
    summary:
      'Skyscrapers rise from the harbour while mountain trails, outlying islands, and fishing villages wait just beyond the city.',
    description: [
      'Hong Kong is famously vertical, but it’s greener than you might expect — around three quarters of the territory is countryside. The Dragon’s Back trail delivers sea views within an hour of Central.',
      'Back in town, ride the Star Ferry across Victoria Harbour, queue for a table at a dim sum institution, and take the tram up to the Peak for the city’s signature night view.',
    ],
    image: {
      src: '/images/destinations/hong-kong.jpg',
      alt: 'Night panorama from Victoria Peak over Hong Kong’s illuminated skyscrapers and Victoria Harbour, with Kowloon across the water',
    },
    highlights: [
      {
        title: 'Victoria Peak',
        description: 'The classic view of the harbour, best timed for sunset into night.',
      },
      {
        title: 'Star Ferry',
        description: 'A ten-minute harbour crossing that has been running for more than a century.',
      },
      {
        title: 'Lantau Island',
        description: 'The Big Buddha, Tai O fishing village, and long, quiet beaches.',
      },
    ],
    tags: ['City', 'Food', 'Nature'],
    travelInfo: {
      timeZone: 'Asia/Hong_Kong',
      utcOffset: 'UTC+8',
      currency: 'Hong Kong dollar (HKD)',
      language: 'Cantonese and English',
      bestTimeToVisit: 'October to December, for clear skies and cool air',
    },
    fareOrigin: 'MNL',
    promotion: {
      headline: 'Dim sum by lunchtime',
      blurb: 'Leave Manila after breakfast, be at a dim sum table in Hong Kong before noon.',
    },
  },
  {
    slug: 'kuala-lumpur',
    name: 'Kuala Lumpur',
    country: 'Malaysia',
    countryCode: 'MY',
    region: 'southeast-asia',
    airportCodes: ['KUL'],
    featured: false,
    tagline: 'Twin towers, limestone caves, and a breakfast for every culture.',
    summary:
      'Malaysia’s capital is a delicious mix of Malay, Chinese, and Indian traditions, framed by soaring towers and rainforest.',
    description: [
      'Kuala Lumpur wears its diversity on its plate. Breakfast might be nasi lemak, roti canai, or dim sum, and the street food of Jalan Alor keeps going long after dark.',
      'Climb the 272 rainbow steps to the Batu Caves temple, cross the skybridge of the Petronas Twin Towers, and cool off in the city’s leafy Perdana Botanical Gardens.',
    ],
    image: {
      src: '/images/destinations/kuala-lumpur.jpg',
      alt: 'Kuala Lumpur skyline under a blue sky, with the Petronas Twin Towers and KL Tower rising above trees and modern high-rises',
    },
    highlights: [
      {
        title: 'Petronas Twin Towers',
        description: 'Walk the skybridge between the towers, 170 metres above the city.',
      },
      {
        title: 'Batu Caves',
        description: 'A Hindu temple set inside a limestone cave, reached by 272 colourful steps.',
      },
      {
        title: 'Jalan Alor',
        description:
          'An evening of satay, grilled stingray, and fresh fruit along one lively street.',
      },
    ],
    tags: ['City', 'Food', 'Culture'],
    travelInfo: {
      timeZone: 'Asia/Kuala_Lumpur',
      utcOffset: 'UTC+8',
      currency: 'Malaysian ringgit (MYR)',
      language: 'Malay and English',
      bestTimeToVisit: 'May to July, between the monsoon seasons',
    },
    fareOrigin: 'MNL',
  },
  {
    slug: 'taipei',
    name: 'Taipei',
    country: 'Taiwan',
    countryCode: 'TW',
    region: 'east-asia',
    airportCodes: ['TPE'],
    featured: false,
    tagline: 'Night markets, hot springs, and mountains on the metro line.',
    summary:
      'Friendly, walkable, and endlessly snackable, Taipei is a city where a hot spring soak is only a train ride from downtown.',
    description: [
      'Taipei’s night markets are legendary for good reason. Shilin, Raohe, and Ningxia serve up pepper buns, oyster omelettes, and bubble tea, the drink the city gave the world.',
      'By day, ride the metro to the thermal springs of Beitou, hike Elephant Mountain for a postcard view of Taipei 101, or take the gondola to the tea houses of Maokong.',
    ],
    image: {
      src: '/images/destinations/taipei.jpg',
      alt: 'Taipei 101 towering over the Xinyi district skyline on a clear day, seen over green hills with mountains on the horizon',
    },
    highlights: [
      {
        title: 'Night markets',
        description: 'Graze your way through Raohe and Shilin, one stall at a time.',
      },
      {
        title: 'Elephant Mountain',
        description: 'A short, steep climb to the best view of Taipei 101.',
      },
      {
        title: 'Beitou hot springs',
        description: 'Soak in volcanic springs at the end of the metro line.',
      },
    ],
    tags: ['City', 'Food', 'Nature'],
    travelInfo: {
      timeZone: 'Asia/Taipei',
      utcOffset: 'UTC+8',
      currency: 'New Taiwan dollar (TWD)',
      language: 'Mandarin',
      bestTimeToVisit: 'October to December and March to May',
    },
    fareOrigin: 'MNL',
    promotion: {
      headline: 'Snack your way through Taipei',
      blurb: 'Two hours from Manila, a lifetime of night-market bites. Pack stretchy trousers.',
    },
  },
  {
    slug: 'osaka',
    name: 'Osaka',
    country: 'Japan',
    countryCode: 'JP',
    region: 'east-asia',
    airportCodes: ['KIX'],
    featured: true,
    tagline: 'Japan’s kitchen, with Kyoto and Nara a short train ride away.',
    summary:
      'Osaka is loud, warm, and proudly food-obsessed — and the perfect base for exploring the temples of Kyoto and the deer of Nara.',
    description: [
      'Locals have a word for Osaka’s attitude to food: kuidaore, to eat until you drop. Dotonbori’s neon canal is lined with takoyaki and okonomiyaki stalls, and Kuromon Market is a feast before lunch.',
      'Day trips are easy. Kyoto’s shrines and bamboo groves are 30 minutes away by train, and the friendly deer of Nara Park are waiting just beyond.',
    ],
    image: {
      src: '/images/destinations/osaka.jpg',
      alt: 'Osaka Castle’s white Inui-yagura turret on massive stone walls, reflected in the still outer moat, with autumn trees and Osaka Business Park skyscrapers beyond',
    },
    highlights: [
      {
        title: 'Dotonbori',
        description: 'Neon signs, canal-side street food, and the city’s liveliest evenings.',
      },
      {
        title: 'Osaka Castle',
        description: 'A landmark castle surrounded by moats and cherry trees.',
      },
      {
        title: 'Kyoto and Nara',
        description: 'Temples, bamboo groves, and free-roaming deer within an hour.',
      },
    ],
    tags: ['Food', 'Culture', 'Family'],
    travelInfo: {
      timeZone: 'Asia/Tokyo',
      utcOffset: 'UTC+9',
      currency: 'Japanese yen (JPY)',
      language: 'Japanese',
      bestTimeToVisit: 'March to May and October to November',
    },
    fareOrigin: 'MNL',
  },
  {
    slug: 'ho-chi-minh-city',
    name: 'Ho Chi Minh City',
    country: 'Vietnam',
    countryCode: 'VN',
    region: 'southeast-asia',
    airportCodes: ['SGN'],
    featured: false,
    tagline: 'Scooter-filled boulevards and the world’s best breakfast noodles.',
    summary:
      'Vietnam’s biggest city hums with energy: French-colonial landmarks, rooftop cafés, and the waterways of the Mekong Delta nearby.',
    description: [
      'Ho Chi Minh City moves to the rhythm of millions of motorbikes. Find a plastic stool at a street-side café, order a cà phê sữa đá, and watch the city flow past.',
      'See the Saigon Central Post Office and the War Remnants Museum, then take a day trip to the Cu Chi tunnels or the floating markets of the Mekong Delta.',
    ],
    image: {
      src: '/images/destinations/ho-chi-minh-city.jpg',
      alt: 'Ho Chi Minh City at night: Landmark 81 lit in pink and rows of illuminated riverside towers reflected in the Saigon River',
    },
    highlights: [
      {
        title: 'Street food',
        description: 'Phở, bánh mì, and broken rice from vendors who have perfected one dish.',
      },
      {
        title: 'Mekong Delta',
        description: 'Boat through floating markets and coconut groves on a day trip.',
      },
      {
        title: 'District 1 landmarks',
        description: 'The Central Post Office, Notre-Dame Cathedral, and the Opera House.',
      },
    ],
    tags: ['City', 'Food', 'History'],
    travelInfo: {
      timeZone: 'Asia/Ho_Chi_Minh',
      utcOffset: 'UTC+7',
      currency: 'Vietnamese đồng (VND)',
      language: 'Vietnamese',
      bestTimeToVisit: 'December to April, during the dry season',
    },
    fareOrigin: 'MNL',
  },
];

/** Validated once at startup so a bad fixture fails fast, not per request. */
export const DESTINATION_CONTENT: readonly DestinationContent[] = Object.freeze(
  z.array(destinationContentSchema).parse(destinations),
);
