import type { Engine } from '@engine/core';
import {
  applyAiActionPlanWithUndoLog,
  undoAiActionPlanExecution,
  type AiNormalizedActionPlan,
  type AiPlanApplyResult,
  type AiPlanUndoBridge,
} from '@engine/ai';
import type { UndoRedoStack } from '../scene/undo-redo.js';

export function createEditorAiPlanUndoBridge(
  engine: Engine,
  undoStack: UndoRedoStack,
): AiPlanUndoBridge {
  return {
    applyPlanWithUndo(plan: AiNormalizedActionPlan): AiPlanApplyResult {
      let latestResult: AiPlanApplyResult | null = null;
      let latestExecution: ReturnType<typeof applyAiActionPlanWithUndoLog> | null = null;

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
