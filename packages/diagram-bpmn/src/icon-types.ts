/**
 * The shape of the generated icon data (`icons.ts`): Iconify bodies turned into allow-listed
 * SVG, path data as absolute `M`, `L`, `C`, `A` and `Z` commands.
 */
export interface IconAttrs {
  readonly fill?: string;
  readonly stroke?: string;
  readonly 'stroke-width'?: number;
  readonly 'stroke-linecap'?: string;
  readonly 'stroke-linejoin'?: string;
  readonly opacity?: number;
  readonly class?: string;
}

/** One path command: its letter, then its numbers (arc flags as 0 or 1). */
export type PathCommand = readonly (string | number)[];

export type IconElement =
  | {
      readonly tag: 'path';
      readonly d: readonly PathCommand[];
      readonly attrs: IconAttrs;
    }
  | {
      readonly tag: 'circle';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly attrs: IconAttrs;
    };
