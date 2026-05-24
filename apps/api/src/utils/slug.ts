export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "company";
}

export function addSlugSuffix(slug: string, suffix: string): string {
  return `${slug}-${suffix.toLowerCase()}`;
}
