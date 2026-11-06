/**
 * The eager swimlane detector (manifest key `detector`), v12's own expression. It imports
 * nothing, so loading it costs no more than the regular expression.
 */
const HEADER = /^\s*swimlane-beta\b/;

/** Whether `text` (front matter, directives and `%%` comments removed) is a swimlane diagram. */
export function detector(text: string): boolean {
  return HEADER.test(text);
}

export default detector;
