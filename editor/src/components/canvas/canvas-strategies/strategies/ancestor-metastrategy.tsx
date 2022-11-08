import { MetadataUtils } from '../../../../core/model/element-metadata-utils'
import * as EP from '../../../../core/shared/element-path'
import { CSSCursor } from '../../canvas-types'
import { CanvasCommand } from '../../commands/commands'
import { highlightElementsCommand } from '../../commands/highlight-element-command'
import { setCursorCommand } from '../../commands/set-cursor-command'
import { appendElementsToRerenderCommand } from '../../commands/set-elements-to-rerender-command'
import { MetaCanvasStrategy } from '../canvas-strategies'
import {
  CanvasStrategy,
  getTargetPathsFromInteractionTarget,
  InteractionCanvasState,
  InteractionLifecycle,
  targetPaths,
} from '../canvas-strategy-types'

export function ancestorMetaStrategy(
  allOtherStrategies: Array<MetaCanvasStrategy>,
  level: number,
): MetaCanvasStrategy {
  return (canvasState, interactionSession, customStrategyState) => {
    // Don't apply during insertion
    if (canvasState.interactionTarget.type === 'INSERTION_SUBJECTS') {
      return []
    }

    const targets = getTargetPathsFromInteractionTarget(canvasState.interactionTarget)

    if (targets.length !== 1) {
      return []
    }

    const target = targets[0]

    // Avoid children of the storyboard
    if (EP.isEmptyPath(target) || EP.isStoryboardPath(target) || EP.isStoryboardChild(target)) {
      // TODO Maybe avoid root elements?
      return []
    }

    // Is the selected element an only child?
    const siblings = MetadataUtils.getSiblings(canvasState.startingMetadata, target)
    if (siblings.length > 1) {
      return []
    }

    // Is the selected element a flow layout element?
    const targetMetadata = MetadataUtils.findElementByElementPath(
      canvasState.startingMetadata,
      target,
    )
    const isStaticLayout = !(
      MetadataUtils.isPositionAbsolute(targetMetadata) ||
      MetadataUtils.isPositionRelative(targetMetadata) ||
      MetadataUtils.isParentYogaLayoutedContainerForElementAndElementParticipatesInLayout(
        targetMetadata,
      )
    )

    if (!isStaticLayout) {
      return []
    }

    // TODO Should we also check isParentZeroSized || isParentContiguous?

    // Time to offer up available strategies for the parent
    const parentPath = EP.parentPath(target)
    const ancestorTargetPaths = targetPaths([parentPath])
    const adjustedCanvasState: InteractionCanvasState = {
      ...canvasState,
      interactionTarget: ancestorTargetPaths,
    }

    // Avoid a cyclic dependency by explicitly passing the other metastrategies when creating the next layer's meta strategy
    const nextAncestorResult = ancestorMetaStrategy(allOtherStrategies, level + 1)(
      adjustedCanvasState,
      interactionSession,
      customStrategyState,
    )

    if (nextAncestorResult.length > 0) {
      // A length of > 0 means that we should be bubbling up to the next ancestor
      return nextAncestorResult.map((s) => ({
        ...s,
        apply: appendCommandsToApplyResult(s.apply, [appendElementsToRerenderCommand([target])]),
      }))
    } else {
      // Otherwise we should stop at this ancestor and return the strategies for this ancestor
      return allOtherStrategies.flatMap((metaStrategy) =>
        metaStrategy(adjustedCanvasState, interactionSession, customStrategyState).map((s) => ({
          ...s,
          id: `${s.id}_ANCESTOR_${level}`,
          name: applyLevelSuffix(s.name, level),
          fitness: s.fitness > 0 ? s.fitness + 10 : s.fitness, // Ancestor strategies should always take priority
          apply: appendCommandsToApplyResult(s.apply, [
            appendElementsToRerenderCommand([target]),
            highlightElementsCommand([parentPath]),
            setCursorCommand('mid-interaction', CSSCursor.MovingMagic),
          ]),
        })),
      )
    }
  }
}

type ApplyFn = CanvasStrategy['apply']
function appendCommandsToApplyResult(
  applyFn: ApplyFn,
  commandsToAppend: Array<CanvasCommand>,
): ApplyFn {
  return (strategyLifecycle: InteractionLifecycle) => {
    const result = applyFn(strategyLifecycle)
    if (result.status === 'success' && result.commands.length > 0) {
      return {
        ...result,
        commands: [...result.commands, ...commandsToAppend],
      }
    } else {
      return result
    }
  }
}

function applyLevelSuffix(name: string, level: number): string {
  // FIXME What should we use for the label here?
  const newSuffix = `(Up ${level})`
  const oldSuffixIndex = name.indexOf(' (Up')
  const withoutOldSuffix = oldSuffixIndex > 0 ? name.slice(0, oldSuffixIndex) : name
  return `${withoutOldSuffix} ${newSuffix}`
}