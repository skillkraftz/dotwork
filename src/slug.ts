/** A name as a file name: lowercase letters and digits joined by dashes. */
export const slug = (name: string, fallback: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
