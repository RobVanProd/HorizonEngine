export interface QuestStepDefinition {
  id: string;
  title: string;
  description: string;
  storyText: string;
  targetCount?: number;
  completionText?: string;
}

export interface QuestStepSnapshot {
  id: string;
  title: string;
  description: string;
  storyText: string;
  progress: number;
  targetCount: number;
  complete: boolean;
  active: boolean;
}

export interface QuestJournalState {
  chainTitle: string;
  currentStep: QuestStepSnapshot | null;
  completedSteps: number;
  totalSteps: number;
  complete: boolean;
  latestEvent: string;
}

interface QuestStepRuntime {
  definition: QuestStepDefinition;
  progress: number;
  targetCount: number;
  complete: boolean;
}

export class QuestChainManager {
  private readonly _steps: QuestStepRuntime[];
  private _activeIndex = 0;
  private _latestEvent = '';

  constructor(
    private readonly _chainTitle: string,
    steps: QuestStepDefinition[],
  ) {
    this._steps = steps.map((definition) => ({
      definition,
      progress: 0,
      targetCount: Math.max(1, definition.targetCount ?? 1),
      complete: false,
    }));
  }

  isCurrent(stepId: string): boolean {
    return this._steps[this._activeIndex]?.definition.id === stepId;
  }

  addProgress(stepId: string, amount = 1): boolean {
    const step = this._steps[this._activeIndex];
    if (!step || step.definition.id !== stepId || step.complete) return false;
    step.progress = Math.min(step.targetCount, step.progress + amount);
    if (step.progress >= step.targetCount) {
      this.completeCurrentStep();
    }
    return true;
  }

  complete(stepId: string): boolean {
    if (!this.isCurrent(stepId)) return false;
    const step = this._steps[this._activeIndex]!;
    if (step.complete) return false;
    step.progress = step.targetCount;
    this.completeCurrentStep();
    return true;
  }

  getState(): QuestJournalState {
    const current = this._steps[this._activeIndex] ?? null;
    return {
      chainTitle: this._chainTitle,
      currentStep: current ? this.toSnapshot(current, true) : null,
      completedSteps: this._steps.filter((step) => step.complete).length,
      totalSteps: this._steps.length,
      complete: this._activeIndex >= this._steps.length,
      latestEvent: this._latestEvent,
    };
  }

  private completeCurrentStep(): void {
    const step = this._steps[this._activeIndex];
    if (!step) return;
    step.complete = true;
    this._latestEvent = step.definition.completionText ?? `${step.definition.title} complete`;
    this._activeIndex++;
  }

  private toSnapshot(step: QuestStepRuntime, active: boolean): QuestStepSnapshot {
    return {
      id: step.definition.id,
      title: step.definition.title,
      description: step.definition.description,
      storyText: step.definition.storyText,
      progress: step.progress,
      targetCount: step.targetCount,
      complete: step.complete,
      active,
    };
  }
}
