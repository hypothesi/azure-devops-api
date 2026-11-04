export interface ReferenceSource {
   readonly title: string;
   readonly slug: string;
   readonly url: string;
   readonly default: boolean;
}

/**
 * Marks the source that the page URL asks for as the default.
 *
 * Scalar selects a document from `?api={slug}`, then rewrites the URL to a hash that starts
 * with the slug without its dots, such as `#70/tag/...` for slug `7.0`, and removes `?api`.
 * On a reload of that URL Scalar would open the default document, so a copied link would lose
 * its API version. This reads the version from either form before Scalar starts.
 */
export function selectSource(sources: readonly ReferenceSource[], url: URL): ReferenceSource[] {
   const requested = url.searchParams.get('api') ?? url.hash.replace(/^#/, '').split('/')[0] ?? '',
      match = sources.find((source) => {
         return source.slug === requested || source.slug.replaceAll('.', '') === requested;
      });

   if (!match) {
      return [...sources];
   }

   return sources.map((source) => {
      return { ...source, default: source === match };
   });
}
