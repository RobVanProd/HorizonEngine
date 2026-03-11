import { describe, it, expect } from 'vitest';
import { FixedTimestep } from './fixed-step.js';

describe('FixedTimestep', () => {
  it('should step once for exactly one fixedDt', () => {
    const fs = new FixedTimestep(1 / 60);
    fs.accumulate(1 / 60);
    let steps = 0;
    while (fs.shouldStep()) steps++;
    expect(steps).toBe(1);
  });

  it('should step multiple times for large dt', () => {
    const fs = new FixedTimestep(1 / 60, 10);
    fs.accumulate(3 / 60);
    let steps = 0;
    while (fs.shouldStep()) steps++;
    expect(steps).toBe(3);
  });

  it('should clamp to maxStepsPerFrame', () => {
    const fs = new FixedTimestep(1 / 60, 4);
    fs.accumulate(1.0);
    let steps = 0;
    while (fs.shouldStep()) steps++;
    expect(steps).toBeLessThanOrEqual(4);
  });

  it('should produce alpha between 0 and 1', () => {
    const fs = new FixedTimestep(1 / 60);
    fs.accumulate(1.5 / 60);
    while (fs.shouldStep()) { /* drain */ }
    expect(fs.alpha).toBeGreaterThanOrEqual(0);
    expect(fs.alpha).toBeLessThan(1);
  });

  it('should track total steps across frames', () => {
    const fs = new FixedTimestep(1 / 60);
    for (let f = 0; f < 10; f++) {
      fs.accumulate(1 / 60);
      while (fs.shouldStep()) { /* step */ }
    }
    expect(fs.totalSteps).toBe(10);
  });

  it('should step zero times for zero dt', () => {
    const fs = new FixedTimestep(1 / 60);
    fs.accumulate(0);
    let steps = 0;
    while (fs.shouldStep()) steps++;
    expect(steps).toBe(0);
  });
});
