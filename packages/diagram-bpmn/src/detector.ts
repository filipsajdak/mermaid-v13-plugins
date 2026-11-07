/**
 * The eager bpmn-beta detector (manifest key `detector`), v12's own expression. It imports
 * nothing, so loading it costs no more than the regular expression.
 */
const HEADER = /^\s*bpmn-beta\b/;

/** Whether `text` (front matter, directives and `%%` comments removed) is a BPMN diagram. */
export function detector(text: string): boolean {
  return HEADER.test(text);
}

export default detector;
