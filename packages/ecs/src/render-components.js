import { FieldType } from '@engine/memory';
import { defineComponent } from './component.js';
/** Reference to a GPUMesh in the engine's mesh registry. */
export const MeshRef = defineComponent('MeshRef', {
    handle: FieldType.U32,
});
/** Reference to a PBRMaterial in the engine's material registry. */
export const MaterialRef = defineComponent('MaterialRef', {
    handle: FieldType.U32,
});
/** Reference to a WaterMaterial for water surfaces (waves, Fresnel, reflection). */
export const WaterRef = defineComponent('WaterRef', {
    handle: FieldType.U32,
});
/** Reference to a GrassMaterial for stylized dense foliage rendering. */
export const GrassRef = defineComponent('GrassRef', {
    handle: FieldType.U32,
});
/** Tag component — only entities with Visible are drawn. */
export const Visible = defineComponent('Visible', {
    _tag: FieldType.U8,
});
/** Reference to a Skeleton in the engine's skeleton registry. */
export const SkeletonRef = defineComponent('SkeletonRef', {
    handle: FieldType.U32,
});
/**
 * Animation playback state per entity.
 *   clipHandle — index into a clip registry
 *   time       — current playback time (seconds)
 *   speed      — playback rate multiplier
 *   flags      — bit 0: playing, bit 1: looping
 */
export const AnimationPlayer = defineComponent('AnimationPlayer', {
    clipHandle: FieldType.U32,
    time: FieldType.F32,
    speed: FieldType.F32,
    flags: FieldType.U32,
});
/**
 * Spatial audio source attached to an entity.
 *   clipHandle   — index into the audio clip registry
 *   soundId      — runtime sound ID from AudioEngine.play() (0 = not playing)
 *   volume       — gain multiplier [0..1+]
 *   refDistance   — distance at which volume is 100%
 *   maxDistance   — beyond this distance, volume is 0 (linear) or minimal
 *   rolloff      — rolloff factor for distance attenuation
 *   flags        — bit 0: playing, bit 1: looping, bit 2: spatial (3D), bit 3: autoplay
 */
export const AudioSource = defineComponent('AudioSource', {
    clipHandle: FieldType.U32,
    soundId: FieldType.U32,
    volume: FieldType.F32,
    refDistance: FieldType.F32,
    maxDistance: FieldType.F32,
    rolloff: FieldType.F32,
    flags: FieldType.U32,
});
/** Tag for the entity whose WorldMatrix drives the audio listener position. */
export const AudioListener = defineComponent('AudioListener', {
    _tag: FieldType.U8,
});
//# sourceMappingURL=render-components.js.map
