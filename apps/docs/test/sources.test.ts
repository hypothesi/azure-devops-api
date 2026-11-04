import { describe, expect, it } from 'vite-plus/test';
import { type ReferenceSource, selectSource } from '../src/sources';

const SOURCES: readonly ReferenceSource[] = [
   { title: '7.1', slug: '7.1', url: 'openapi/7.1.json', default: true },
   { title: '7.0', slug: '7.0', url: 'openapi/7.0.json', default: false },
];

function getDefaultSlug(href: string): string | undefined {
   return selectSource(SOURCES, new URL(href)).find((source) => {
      return source.default;
   })?.slug;
}

describe('selectSource', () => {
   it.each([
      ['the hash that Scalar writes', 'https://example.com/reference.html#70/tag/work-items/GET/x', '7.0'],
      ['the api query parameter', 'https://example.com/reference.html?api=7.0', '7.0'],
      ['the 7.1 hash', 'https://example.com/reference.html#71/description/introduction', '7.1'],
      ['no version in the URL', 'https://example.com/reference.html', '7.1'],
      ['an unknown version', 'https://example.com/reference.html#99/description/introduction', '7.1'],
   ])('selects the default from %s', (_name, href, expected) => {
      const slug = getDefaultSlug(href);

      expect(slug).toBe(expected);
   });
});
