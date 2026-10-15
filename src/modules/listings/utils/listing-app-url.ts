export function listingAppUrl(category: string, id: string): string {
  return `miningmobile://listing/${category}/${encodeURIComponent(id)}`;
}
