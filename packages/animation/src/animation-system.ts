import type { World, Query } from '@engine/ecs';
import { AnimationPlayer, SkeletonRef } from '@engine/ecs';
import type { FrameContext } from '@engine/scheduler';
import type { AnimationState, Skeleton, AnimationClip } from './types.js';
import { sampleClip, computeSkinMatrices } from './evaluate.js';

const FLAG_PLAYING = 1;
const FLAG_LOOPING = 2;

export interface AnimationRegistries {
  skeletons: Map<number, Skeleton>;
  clips: Map<number, AnimationClip>;
  /** Per-entity joint matrix arrays (keyed by entity id). */
  jointBuffers: Map<number, Float32Array>;
}

/**
 * Create the animation system. Returns the system function and query.
 *
 * Each frame the system:
 *  1. Queries all entities with AnimationPlayer + SkeletonRef
 *  2. Advances playback time by deltaTime * speed
 *  3. Samples the clip and computes skin matrices
 *  4. Stores the results in jointBuffers for the render system to upload
 */
export function createAnimationSystem(
  world: World,
  registries: AnimationRegistries,
): { query: Query; update: (ctx: FrameContext) => void } {
  const query = world.query(AnimationPlayer, SkeletonRef);

  function update(ctx: FrameContext): void {
    query.each((arch, count) => {
      const clipHandles = arch.getColumn(AnimationPlayer, 'clipHandle');
      const times = arch.getColumn(AnimationPlayer, 'time') as Float32Array;
      const speeds = arch.getColumn(AnimationPlayer, 'speed') as Float32Array;
      const flags = arch.getColumn(AnimationPlayer, 'flags') as Uint32Array;
      const skelHandles = arch.getColumn(SkeletonRef, 'handle');
      const entityIds = arch.entities.data as Uint32Array;

      for (let i = 0; i < count; i++) {
        const f = flags[i]!;
        if (!(f & FLAG_PLAYING)) continue;

        const clip = registries.clips.get(clipHandles[i]!);
        const skeleton = registries.skeletons.get(skelHandles[i]!);
        if (!clip || !skeleton) continue;

        let t = times[i]! + ctx.deltaTime * speeds[i]!;
        if (f & FLAG_LOOPING) {
          t = t % clip.duration;
          if (t < 0) t += clip.duration;
        } else {
          t = Math.min(t, clip.duration);
          if (t >= clip.duration) flags[i] = f & ~FLAG_PLAYING;
        }
        times[i] = t;

        const poses = sampleClip(clip, t, skeleton);

        const eid = entityIds[i]!;
        let buf = registries.jointBuffers.get(eid);
        if (!buf || buf.length !== skeleton.joints.length * 16) {
          buf = new Float32Array(skeleton.joints.length * 16);
          registries.jointBuffers.set(eid, buf);
        }

        computeSkinMatrices(skeleton, poses, buf);
      }
    });
  }

  return { query, update };
}
