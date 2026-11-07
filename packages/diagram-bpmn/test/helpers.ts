import { LineIndex } from '@mermaid-js/core/parser-kit';
import type { BpmnModel } from '../src/model.ts';
import { parseBpmn } from '../src/parser.ts';

/**
 * v12's `parseBpmn`: the model, or the first error thrown as v12 wrote it, with the 1-based
 * line and column of its range (`BPMN error at line L, column C: …`). v13 returns diagnostics
 * instead of throwing; this keeps the v12 specs' assertions as they were.
 */
export function parseOrThrow(text: string): BpmnModel {
  const { model, diagnostics } = parseBpmn(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) {
    const { line, column } = new LineIndex(text).position(error.range.start);
    throw new Error(
      `BPMN error at line ${String(line + 1)}, column ${String(column + 1)}: ${error.message}`,
    );
  }
  return model;
}
