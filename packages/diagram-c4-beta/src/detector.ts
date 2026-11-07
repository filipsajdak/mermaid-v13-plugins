/**
 * The eager c4-beta detector (manifest key `detector`), v12's own expression. It imports
 * nothing, so loading it costs no more than the regular expression.
 */
const HEADER = /^\s*c4-beta(?![\w-])/;

/** Whether `text` (front matter, directives and `%%` comments removed) is a c4-beta diagram. */
export function detector(text: string): boolean {
  return HEADER.test(text);
}

export default detector;
