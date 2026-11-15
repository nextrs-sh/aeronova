import { z } from 'zod';
import rawCredits from '../../public/images/credits.json';

const imageCreditSchema = z.object({
  file: z.string(),
  subject: z.string(),
  alt: z.string(),
  author: z.string(),
  license: z.string(),
  licenseUrl: z.url().optional().or(z.literal('')),
  sourceUrl: z.url(),
});
export type ImageCredit = z.infer<typeof imageCreditSchema>;

/** Attribution for every photograph shipped in `public/images`. */
export const imageCredits: readonly ImageCredit[] = z.array(imageCreditSchema).parse(rawCredits);

const byFile = new Map(imageCredits.map((credit) => [credit.file, credit]));

/** Local brand photography with its recorded alt text. */
export function brandImage(name: 'hero' | 'window' | 'beach' | 'food' | 'culture') {
  const file = `brand/${name}.jpg`;
  const credit = byFile.get(file);
  if (!credit) throw new Error(`Missing credit for ${file}`);
  return { src: `/images/${file}`, alt: credit.alt };
}
