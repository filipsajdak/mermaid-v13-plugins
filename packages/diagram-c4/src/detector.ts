/**
 * The eager C4 detector (manifest key `detector`). It imports nothing, so loading it costs
 * no more than the regular expression.
 *
 * Unlike v12's `/^\s*C4Context|C4Container|.../`, the alternation is anchored: only the first
 * keyword of the text decides, so a label or description that mentions `C4Container` in
 * another diagram is not taken for C4.
 */
const HEADER = /^\s*(?:C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)(?![\w-])/;

/** Whether `text` (front matter, directives and `%%` comments removed) is a C4 diagram. */
export function detector(text: string): boolean {
  return HEADER.test(text);
}

export default detector;
