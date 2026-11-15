import type { Metadata } from 'next';
import { site } from './site';

interface PageMetadataOptions {
  title: string;
  description: string;
  /** Canonical path, e.g. `/help`. Omit for pages that should not declare one. */
  path?: string;
  /** Social title when it should differ from the document title. */
  socialTitle?: string;
  /** Page-specific social image; defaults to the Velasia social preview card. */
  image?: { url: string; alt: string; width?: number; height?: number };
}

/**
 * Page metadata with matching Open Graph and Twitter tags.
 *
 * Next.js replaces (does not merge) nested `openGraph`/`twitter` objects from parent layouts,
 * so every page builds the full set here to keep the brand's site name and social image.
 */
export function pageMetadata({
  title,
  description,
  path,
  socialTitle,
  image,
}: PageMetadataOptions): Metadata {
  const shareTitle = socialTitle ?? `${title} | ${site.name}`;
  const images = [image ?? site.brand.socialPreview];
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: {
      type: 'website',
      siteName: site.name,
      locale: site.locale,
      title: shareTitle,
      description,
      ...(path ? { url: path } : {}),
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description,
      images,
    },
  };
}
