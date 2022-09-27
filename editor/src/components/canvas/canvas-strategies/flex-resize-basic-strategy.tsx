import { MetadataUtils } from '../../../core/model/element-metadata-utils'
import {
  CanvasPoint,
  canvasRectangle,
  CanvasRectangle,
  offsetPoint,
} from '../../../core/shared/math-utils'
import { stylePropPathMappingFn } from '../../inspector/common/property-path-hooks'
import { EdgePosition, oppositeEdgePosition } from '../canvas-types'
import {
  isEdgePositionACorner,
  isEdgePositionAHorizontalEdge,
  pickPointOnRect,
} from '../canvas-utils'
import { adjustCssLengthProperty } from '../commands/adjust-css-length-command'
import { setCursorCommand } from '../commands/set-cursor-command'
import { setElementsToRerenderCommand } from '../commands/set-elements-to-rerender-command'
import { updateHighlightedViews } from '../commands/update-highlighted-views-command'
import { ParentBounds } from '../controls/parent-bounds'
import { ParentOutlines } from '../controls/parent-outlines'
import { AbsoluteResizeControl } from '../controls/select-mode/absolute-resize-control'
import { ZeroSizeResizeControlWrapper } from '../controls/zero-sized-element-controls'
import { honoursPropsSize } from './absolute-utils'
import {
  CanvasStrategy,
  emptyStrategyApplicationResult,
  getTargetPathsFromInteractionTarget,
  strategyApplicationResult,
} from './canvas-strategy-types'
import { pickCursorFromEdgePosition } from './shared-absolute-resize-strategy-helpers'

export const flexResizeBasicStrategy: CanvasStrategy = {
  id: 'FLEX_RESIZE_BASIC',
  name: () => 'Flex Resize (Basic)',
  isApplicable: (canvasState, interactionState, metadata) => {
    const selectedElements = getTargetPathsFromInteractionTarget(canvasState.interactionTarget)
    // no multiselection support yet
    if (selectedElements.length === 1) {
      return (
        MetadataUtils.isParentYogaLayoutedContainerAndElementParticipatesInLayout(
          selectedElements[0],
          metadata,
        ) && honoursPropsSize(canvasState, selectedElements[0])
      )
    } else {
      return false
    }
  },
  controlsToRender: [
    { control: AbsoluteResizeControl, key: 'absolute-resize-control', show: 'always-visible' },
    {
      control: ZeroSizeResizeControlWrapper,
      key: 'zero-size-resize-control',
      show: 'always-visible',
    },
    { control: ParentOutlines, key: 'parent-outlines-control', show: 'visible-only-while-active' },
    { control: ParentBounds, key: 'parent-bounds-control', show: 'visible-only-while-active' },
  ],
  fitness: (canvasState, interactionState, sessionState) => {
    return flexResizeBasicStrategy.isApplicable(
      canvasState,
      interactionState,
      sessionState.startingMetadata,
      sessionState.startingAllElementProps,
    ) &&
      interactionState.interactionData.type === 'DRAG' &&
      interactionState.activeControl.type === 'RESIZE_HANDLE'
      ? 1
      : 0
  },
  apply: (canvasState, interactionState, sessionState) => {
    if (
      interactionState.interactionData.type === 'DRAG' &&
      interactionState.activeControl.type === 'RESIZE_HANDLE'
    ) {
      const selectedElements = getTargetPathsFromInteractionTarget(canvasState.interactionTarget)
      // no multiselection support yet
      const selectedElement = selectedElements[0]
      const edgePosition = interactionState.activeControl.edgePosition
      if (interactionState.interactionData.drag != null) {
        const drag = interactionState.interactionData.drag
        const originalBounds = MetadataUtils.getFrameInCanvasCoords(
          selectedElement,
          sessionState.startingMetadata,
        )

        if (originalBounds == null) {
          return emptyStrategyApplicationResult
        }

        const resizedBounds = resizeWidthHeight(originalBounds, drag, edgePosition)

        const elementParentBounds =
          MetadataUtils.findElementByElementPath(sessionState.startingMetadata, selectedElement)
            ?.specialSizeMeasurements.immediateParentBounds ?? null

        const resizeCommands = [
          adjustCssLengthProperty(
            'always',
            selectedElement,
            stylePropPathMappingFn('width', ['style']),
            resizedBounds.width - originalBounds.width,
            elementParentBounds?.width,
            true,
          ),
          adjustCssLengthProperty(
            'always',
            selectedElement,
            stylePropPathMappingFn('height', ['style']),
            resizedBounds.height - originalBounds.height,
            elementParentBounds?.height,
            true,
          ),
        ]
        return strategyApplicationResult([
          ...resizeCommands,
          updateHighlightedViews('mid-interaction', []),
          setCursorCommand('mid-interaction', pickCursorFromEdgePosition(edgePosition)),
          setElementsToRerenderCommand(selectedElements),
        ])
      } else {
        return strategyApplicationResult([
          updateHighlightedViews('mid-interaction', []),
          setCursorCommand('mid-interaction', pickCursorFromEdgePosition(edgePosition)),
        ])
      }
    }
    // Fallback for when the checks above are not satisfied.
    return emptyStrategyApplicationResult
  },
}
export function resizeWidthHeight(
  boundingBox: CanvasRectangle,
  drag: CanvasPoint,
  edgePosition: EdgePosition,
): CanvasRectangle {
  if (isEdgePositionACorner(edgePosition)) {
    const startingCornerPosition = {
      x: 1 - edgePosition.x,
      y: 1 - edgePosition.y,
    } as EdgePosition

    let oppositeCorner = pickPointOnRect(boundingBox, startingCornerPosition)
    const draggedCorner = pickPointOnRect(boundingBox, edgePosition)
    const newCorner = offsetPoint(draggedCorner, drag)

    const newWidth = Math.abs(oppositeCorner.x - newCorner.x)
    const newHeight = Math.abs(oppositeCorner.y - newCorner.y)

    return canvasRectangle({
      x: boundingBox.x,
      y: boundingBox.y,
      width: newWidth,
      height: newHeight,
    })
  } else {
    const isEdgeHorizontalSide = isEdgePositionAHorizontalEdge(edgePosition)

    const oppositeSideCenterPosition = oppositeEdgePosition(edgePosition)

    const oppositeSideCenter = pickPointOnRect(boundingBox, oppositeSideCenterPosition)
    const draggedSideCenter = pickPointOnRect(boundingBox, edgePosition)

    if (isEdgeHorizontalSide) {
      const newHeight = Math.abs(oppositeSideCenter.y - (draggedSideCenter.y + drag.y))
      return canvasRectangle({
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: newHeight,
      })
    } else {
      const newWidth = Math.abs(oppositeSideCenter.x - (draggedSideCenter.x + drag.x))
      return canvasRectangle({
        x: boundingBox.x,
        y: boundingBox.y,
        width: newWidth,
        height: boundingBox.height,
      })
    }
  }
}