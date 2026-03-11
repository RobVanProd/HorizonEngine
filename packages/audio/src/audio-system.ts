import type { World, Query } from '@engine/ecs';
import { WorldMatrix, AudioSource, AudioListener } from '@engine/ecs';
import type { FrameContext } from '@engine/scheduler';
import type { AudioEngine } from './audio-engine.js';
import type { AudioHandle } from './types.js';

export const AUDIO_FLAG_PLAYING = 1;
export const AUDIO_FLAG_LOOPING = 2;
export const AUDIO_FLAG_SPATIAL = 4;
export const AUDIO_FLAG_AUTOPLAY = 8;

export interface AudioRegistries {
  clips: Map<number, AudioHandle>;
}

/**
 * Creates an ECS system that synchronizes AudioSource components with the AudioEngine.
 * Runs in Phase.AUDIO each frame.
 */
export function createAudioSystem(
  world: World,
  audioEngine: AudioEngine,
  registries: AudioRegistries,
): { sourceQuery: Query; listenerQuery: Query; update: (ctx: FrameContext) => void } {

  const sourceQuery = world.query(AudioSource, WorldMatrix);
  const listenerQuery = world.query(AudioListener, WorldMatrix);

  function update(_ctx: FrameContext): void {
    if (!audioEngine.isReady) return;

    updateListener();
    updateSources();
  }

  function updateListener(): void {
    listenerQuery.each((arch, count) => {
      if (count === 0) return;

      const m12 = arch.getColumn(WorldMatrix, 'm12');
      const m13 = arch.getColumn(WorldMatrix, 'm13');
      const m14 = arch.getColumn(WorldMatrix, 'm14');
      const m8  = arch.getColumn(WorldMatrix, 'm8');
      const m9  = arch.getColumn(WorldMatrix, 'm9');
      const m10 = arch.getColumn(WorldMatrix, 'm10');
      const m4  = arch.getColumn(WorldMatrix, 'm4');
      const m5  = arch.getColumn(WorldMatrix, 'm5');
      const m6  = arch.getColumn(WorldMatrix, 'm6');

      // Use first listener entity
      const pos: [number, number, number] = [m12[0]!, m13[0]!, m14[0]!];
      const fwd: [number, number, number] = [-m8[0]!, -m9[0]!, -m10[0]!];
      const up: [number, number, number] = [m4[0]!, m5[0]!, m6[0]!];

      audioEngine.setListener({ position: pos, forward: fwd, up });
    });
  }

  function updateSources(): void {
    sourceQuery.each((arch, count) => {
      const clipHandles = arch.getColumn(AudioSource, 'clipHandle') as Uint32Array;
      const soundIds = arch.getColumn(AudioSource, 'soundId') as Uint32Array;
      const volumes = arch.getColumn(AudioSource, 'volume') as Float32Array;
      const refDists = arch.getColumn(AudioSource, 'refDistance') as Float32Array;
      const maxDists = arch.getColumn(AudioSource, 'maxDistance') as Float32Array;
      const rolloffs = arch.getColumn(AudioSource, 'rolloff') as Float32Array;
      const flags = arch.getColumn(AudioSource, 'flags') as Uint32Array;
      const wmM12 = arch.getColumn(WorldMatrix, 'm12') as Float32Array;
      const wmM13 = arch.getColumn(WorldMatrix, 'm13') as Float32Array;
      const wmM14 = arch.getColumn(WorldMatrix, 'm14') as Float32Array;

      for (let i = 0; i < count; i++) {
        const f = flags[i]!;
        const wantPlaying = (f & AUDIO_FLAG_PLAYING) !== 0 || (f & AUDIO_FLAG_AUTOPLAY) !== 0;
        const currentSoundId = soundIds[i]!;
        const isCurrentlyPlaying = currentSoundId !== 0 && audioEngine.isPlaying(currentSoundId);
        const isSpatial = (f & AUDIO_FLAG_SPATIAL) !== 0;

        const posX = wmM12[i]!;
        const posY = wmM13[i]!;
        const posZ = wmM14[i]!;

        if (wantPlaying && !isCurrentlyPlaying) {
          const clipHandle = registries.clips.get(clipHandles[i]!);
          if (clipHandle === undefined) continue;

          const soundId = audioEngine.play(clipHandle, {
            loop: (f & AUDIO_FLAG_LOOPING) !== 0,
            volume: volumes[i]!,
            spatial: isSpatial ? {
              position: [posX, posY, posZ],
              refDistance: refDists[i]! || 1,
              maxDistance: maxDists[i]! || 10000,
              rolloffFactor: rolloffs[i]! || 1,
            } : undefined,
          });

          soundIds[i] = soundId;
          flags[i] = f | AUDIO_FLAG_PLAYING;
        } else if (!wantPlaying && isCurrentlyPlaying) {
          audioEngine.stop(currentSoundId);
          soundIds[i] = 0;
        } else if (isCurrentlyPlaying && isSpatial) {
          audioEngine.setSoundPosition(currentSoundId, [posX, posY, posZ]);
          audioEngine.setSoundVolume(currentSoundId, volumes[i]!);
        }
      }
    });
  }

  return { sourceQuery, listenerQuery, update };
}
