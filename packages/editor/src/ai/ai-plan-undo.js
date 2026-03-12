import { applyAiActionPlanWithUndoLog, undoAiActionPlanExecution, } from '@engine/ai';
export function createEditorAiPlanUndoBridge(engine, undoStack) {
    return {
        applyPlanWithUndo(plan) {
            let latestResult = null;
            let latestExecution = null;
            undoStack.execute({
                label: plan.label,
                execute: () => {
                    latestExecution = applyAiActionPlanWithUndoLog(engine, plan, {
                        editorUndoAvailable: true,
                        undoAvailable: true,
                    });
                    latestResult = latestExecution.publicResult;
                },
                undo: () => {
                    if (latestExecution) {
                        undoAiActionPlanExecution(latestExecution);
                    }
                },
            });
            if (!latestResult) {
                throw new Error('AI plan undo bridge did not produce an execution result');
            }
            return latestResult;
        },
    };
}
