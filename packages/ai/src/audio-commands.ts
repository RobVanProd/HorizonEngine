import type { Engine } from '@engine/core';
import type { CommandRouter } from './command-router.js';

/**
 * Registers audio-related commands onto a CommandRouter.
 */
export function registerAudioCommands(router: CommandRouter, engine: Engine): void {
  const audio = engine.audio;

  // ─── audio.play ───────────────────────────────────────────────────
  router.register(
    {
      action: 'audio.play',
      description: 'Play an audio clip by its engine handle. Returns a sound ID for later control.',
      params: {
        clipHandle: { type: 'number', required: true, description: 'Engine audio clip handle (from engine.audioClips)' },
        loop: { type: 'boolean', description: 'Loop playback', default: false },
        volume: { type: 'number', description: 'Volume 0-1', default: 1.0 },
        playbackRate: { type: 'number', description: 'Playback speed multiplier', default: 1.0 },
        position: { type: 'array', description: 'Spatial position [x, y, z] for 3D audio', items: { type: 'number' } },
        refDistance: { type: 'number', description: 'Reference distance for spatial falloff', default: 1 },
        maxDistance: { type: 'number', description: 'Max audible distance', default: 10000 },
        rolloffFactor: { type: 'number', description: 'Rolloff factor', default: 1 },
      },
    },
    (params) => {
      const clipHandle = params['clipHandle'] as number;
      const audioHandle = engine.audioClips.get(clipHandle);
      if (audioHandle === undefined) return { ok: false, error: `Audio clip ${clipHandle} not found` };

      const spatial = params['position']
        ? {
            position: params['position'] as [number, number, number],
            refDistance: (params['refDistance'] as number) ?? 1,
            maxDistance: (params['maxDistance'] as number) ?? 10000,
            rolloffFactor: (params['rolloffFactor'] as number) ?? 1,
          }
        : undefined;

      const soundId = audio.play(audioHandle, {
        loop: (params['loop'] as boolean) ?? false,
        volume: (params['volume'] as number) ?? 1.0,
        playbackRate: (params['playbackRate'] as number) ?? 1.0,
        spatial,
      });

      return { ok: true, data: { soundId } };
    },
  );

  // ─── audio.stop ───────────────────────────────────────────────────
  router.register(
    {
      action: 'audio.stop',
      description: 'Stop a playing sound by its sound ID, or stop all sounds',
      params: {
        soundId: { type: 'number', description: 'Sound ID to stop (omit to stop all)' },
      },
    },
    (params) => {
      const soundId = params['soundId'] as number | undefined;
      if (soundId !== undefined) {
        audio.stop(soundId);
        return { ok: true, data: { stopped: soundId } };
      }
      audio.stopAll();
      return { ok: true, data: { stopped: 'all' } };
    },
  );

  // ─── audio.setVolume ──────────────────────────────────────────────
  router.register(
    {
      action: 'audio.setVolume',
      description: 'Set volume for a playing sound or the master volume',
      params: {
        soundId: { type: 'number', description: 'Sound ID (omit for master volume)' },
        volume: { type: 'number', required: true, description: 'Volume level 0-1' },
      },
    },
    (params) => {
      const volume = params['volume'] as number;
      const soundId = params['soundId'] as number | undefined;
      if (soundId !== undefined) {
        audio.setSoundVolume(soundId, volume);
        return { ok: true, data: { soundId, volume } };
      }
      audio.setMasterVolume(volume);
      return { ok: true, data: { master: true, volume } };
    },
  );

  // ─── audio.setListener ────────────────────────────────────────────
  router.register(
    {
      action: 'audio.setListener',
      description: 'Set the audio listener position and orientation (typically matches the camera)',
      params: {
        position: { type: 'array', required: true, description: 'Listener position [x, y, z]', items: { type: 'number' } },
        forward: { type: 'array', description: 'Forward direction [x, y, z]', items: { type: 'number' } },
        up: { type: 'array', description: 'Up direction [x, y, z]', items: { type: 'number' } },
      },
    },
    (params) => {
      const position = params['position'] as [number, number, number];
      const forward = (params['forward'] as [number, number, number]) ?? [0, 0, -1];
      const up = (params['up'] as [number, number, number]) ?? [0, 1, 0];
      audio.setListener({ position, forward, up });
      return { ok: true, data: { position, forward, up } };
    },
  );

  // ─── audio.status ─────────────────────────────────────────────────
  router.register(
    {
      action: 'audio.status',
      description: 'Get audio engine status (active sounds, master volume, clip count)',
      params: {},
    },
    () => {
      return {
        ok: true,
        data: {
          ready: audio.isReady,
          activeSounds: audio.activeSoundCount,
          masterVolume: audio.getMasterVolume(),
          clipCount: engine.audioClips.size,
        },
      };
    },
  );
}
