// Stable public aliases preserve the stored event and existing agent credentials.
const aliases: Record<string, string> = {
  "sf-meetup": "sf-meetup-c3569568a48345609823ed4e",
};

export function storedEventSlug(slug: string) {
  return Object.hasOwn(aliases, slug) ? aliases[slug] : slug;
}

export function publicEventSlug(slug: string) {
  return (
    Object.entries(aliases).find(([, stored]) => stored === slug)?.[0] ?? slug
  );
}
