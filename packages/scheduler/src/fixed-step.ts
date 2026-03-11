/**
 * Fixed-timestep accumulator for deterministic simulation.
 *
 * Each frame, the accumulator absorbs the real delta time, then drains it
 * in fixed-size steps. The leftover fraction is exposed as `alpha` for
 * render-time interpolation.
 *
 * Usage:
 *   fixedStep.accumulate(dt);
 *   while (fixedStep.shouldStep()) {
 *     simulate(fixedStep.fixedDt);
 *   }
 *   const alpha = fixedStep.alpha; // 0..1 interpolation factor
 */
export class FixedTimestep {
  readonly fixedDt: number;
  private _accumulator = 0;
  private _maxAccumulator: number;
  private _alpha = 0;
  private _stepCount = 0;
  private _totalSteps = 0;

  constructor(fixedDt: number = 1 / 60, maxStepsPerFrame: number = 4) {
    this.fixedDt = fixedDt;
    this._maxAccumulator = fixedDt * maxStepsPerFrame;
  }

  /**
   * Feed real frame delta time into the accumulator.
   */
  accumulate(dt: number): void {
    this._accumulator += dt;
    if (this._accumulator > this._maxAccumulator) {
      this._accumulator = this._maxAccumulator;
    }
    this._stepCount = 0;
  }

  /**
   * Returns true if another fixed step should be taken.
   * Call in a while loop.
   */
  shouldStep(): boolean {
    if (this._accumulator >= this.fixedDt) {
      this._accumulator -= this.fixedDt;
      this._stepCount++;
      this._totalSteps++;
      return true;
    }
    this._alpha = this._accumulator / this.fixedDt;
    return false;
  }

  /**
   * Interpolation factor [0, 1) for rendering between simulation states.
   */
  get alpha(): number {
    return this._alpha;
  }

  /**
   * Number of fixed steps taken in the current frame.
   */
  get stepsThisFrame(): number {
    return this._stepCount;
  }

  /**
   * Total fixed steps since creation.
   */
  get totalSteps(): number {
    return this._totalSteps;
  }
}
