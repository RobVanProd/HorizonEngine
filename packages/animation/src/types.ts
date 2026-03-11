/** A single joint in a skeleton hierarchy. */
export interface Joint {
  readonly name: string;
  /** Index of parent joint, or -1 for the root. */
  readonly parentIndex: number;
  /** 4x4 column-major inverse bind matrix (16 floats). */
  readonly inverseBindMatrix: Float32Array;
  /** Rest pose translation from the source file's node transform. */
  readonly restTranslation: [number, number, number];
  /** Rest pose rotation (quaternion xyzw) from the source file's node transform. */
  readonly restRotation: [number, number, number, number];
  /** Rest pose scale from the source file's node transform. */
  readonly restScale: [number, number, number];
}

/** Bone hierarchy with inverse-bind pose data. */
export interface Skeleton {
  readonly joints: readonly Joint[];
}

/** Interpolation mode for animation keyframes. */
export type Interpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

/** Which transform property a channel targets. */
export type AnimationPath = 'translation' | 'rotation' | 'scale';

/** A single animation channel targeting one joint's transform property. */
export interface AnimationChannel {
  readonly jointIndex: number;
  readonly path: AnimationPath;
  readonly interpolation: Interpolation;
  /** Keyframe timestamps in seconds. */
  readonly times: Float32Array;
  /** Keyframe values — vec3 for translation/scale, quat for rotation. */
  readonly values: Float32Array;
}

/** A named animation clip with one or more channels. */
export interface AnimationClip {
  readonly name: string;
  /** Total duration in seconds. */
  readonly duration: number;
  readonly channels: readonly AnimationChannel[];
}

/** Runtime playback state for one animation instance. */
export interface AnimationState {
  clip: AnimationClip;
  skeleton: Skeleton;
  time: number;
  speed: number;
  looping: boolean;
  playing: boolean;
  /** Flat array of 4x4 column-major joint matrices (skeleton.joints.length * 16). */
  jointMatrices: Float32Array;
}

/** Per-joint local transform produced by clip sampling. */
export interface JointPose {
  translation: [number, number, number];
  rotation: [number, number, number, number]; // quaternion xyzw
  scale: [number, number, number];
}
