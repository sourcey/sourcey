/**
 * A name as a slug: its letters and digits in lowercase, each run of anything
 * else one hyphen, and no hyphen at either end. A page's address, a tab's
 * path and an HTML id are all written this way.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
