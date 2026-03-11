/**
 * Engine update phases, executed in strict order each frame.
 */
export const enum Phase {
  INPUT = 0,
  SIMULATE = 1,
  TRANSFORM = 2,
  ANIMATE = 3,
  VISIBILITY = 4,
  RENDER = 5,
  AUDIO = 6,
  DIAGNOSTICS = 7,
}

export const PHASE_NAMES: readonly string[] = [
  'Input',
  'Simulate',
  'Transform',
  'Animate',
  'Visibility',
  'Render',
  'Audio',
  'Diagnostics',
];

export const PHASE_COUNT = 8;

export interface SystemFn {
  (ctx: FrameContext): void;
}

export interface FrameContext {
  readonly deltaTime: number;
  readonly elapsedTime: number;
  readonly frameNumber: number;
  readonly fixedDeltaTime: number;
  readonly timestamp: number;
}
