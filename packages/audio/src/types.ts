/** Opaque handle to a loaded audio buffer. */
export type AudioHandle = number;

export type DistanceModel = 'linear' | 'inverse' | 'exponential';

export interface SpatialParams {
  position: [number, number, number];
  orientation?: [number, number, number];
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  coneInnerAngle?: number;
  coneOuterAngle?: number;
  coneOuterGain?: number;
  distanceModel?: DistanceModel;
}

export interface PlayOptions {
  loop?: boolean;
  volume?: number;
  playbackRate?: number;
  spatial?: SpatialParams;
  /** Start offset in seconds */
  offset?: number;
}

export interface ActiveSound {
  readonly handle: AudioHandle;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly panner: PannerNode | null;
  playing: boolean;
}

export interface ListenerState {
  position: [number, number, number];
  forward: [number, number, number];
  up: [number, number, number];
}
