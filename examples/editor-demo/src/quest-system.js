export class QuestChainManager {
    _chainTitle;
    _steps;
    _activeIndex = 0;
    _latestEvent = '';
    constructor(_chainTitle, steps) {
        this._chainTitle = _chainTitle;
        this._steps = steps.map((definition) => ({
            definition,
            progress: 0,
            targetCount: Math.max(1, definition.targetCount ?? 1),
            complete: false,
        }));
    }
    isCurrent(stepId) {
        return this._steps[this._activeIndex]?.definition.id === stepId;
    }
    addProgress(stepId, amount = 1) {
        const step = this._steps[this._activeIndex];
        if (!step || step.definition.id !== stepId || step.complete)
            return false;
        step.progress = Math.min(step.targetCount, step.progress + amount);
        if (step.progress >= step.targetCount) {
            this.completeCurrentStep();
        }
        return true;
    }
    complete(stepId) {
        if (!this.isCurrent(stepId))
            return false;
        const step = this._steps[this._activeIndex];
        if (!step || step.complete)
            return false;
        step.progress = step.targetCount;
        this.completeCurrentStep();
        return true;
    }
    getState() {
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
    completeCurrentStep() {
        const step = this._steps[this._activeIndex];
        if (!step)
            return;
        step.complete = true;
        this._latestEvent = step.definition.completionText ?? `${step.definition.title} complete`;
        this._activeIndex++;
    }
    toSnapshot(step, active) {
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
