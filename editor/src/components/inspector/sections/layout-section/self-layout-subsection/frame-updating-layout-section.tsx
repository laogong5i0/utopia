import React from 'react'
import {
  directResizeInspectorStrategy,
  resizeInspectorStrategy,
} from '../../../../../components/canvas/canvas-strategies/strategies/shared-absolute-resize-strategy-helpers'
import {
  directMoveInspectorStrategy,
  moveInspectorStrategy,
} from '../../../../../components/canvas/canvas-strategies/strategies/shared-move-strategies-helpers'
import { MetadataUtils } from '../../../../../core/model/element-metadata-utils'
import { oneLevelNestedEquals } from '../../../../../core/shared/equality-utils'
import type { CanvasRectangle, CanvasVector } from '../../../../../core/shared/math-utils'
import {
  boundingRectangleArray,
  canvasRectangle,
  canvasVector,
  isInfinityRectangle,
  zeroRectangle,
} from '../../../../../core/shared/math-utils'
import { optionalMap } from '../../../../../core/shared/optional-utils'
import { assertNever } from '../../../../../core/shared/utils'
import { NumberInput } from '../../../../../uuiui'
import {
  EdgePositionBottom,
  EdgePositionLeft,
  EdgePositionRight,
  EdgePositionTop,
  type EdgePosition,
} from '../../../../canvas/canvas-types'
import { InspectorContextMenuWrapper } from '../../../../context-menu-wrapper'
import { useDispatch } from '../../../../editor/store/dispatch-context'
import { Substores, useEditorState, useRefEditorState } from '../../../../editor/store/store-hook'
import { metadataSelector, selectedViewsSelector } from '../../../../inspector/inpector-selectors'
import { unsetPropertyMenuItem } from '../../../common/context-menu-items'
import {
  cssNumber,
  isEmptyInputValue,
  isUnknownInputValue,
  type CSSNumber,
  type UnknownOrEmptyInput,
} from '../../../common/css-utils'
import { useInspectorLayoutInfo } from '../../../common/property-path-hooks'
import { executeFirstApplicableStrategy } from '../../../inspector-strategies/inspector-strategy'
import { UIGridRow } from '../../../widgets/ui-grid-row'

type TLWH = 'top' | 'left' | 'width' | 'height'

function getTLWHEdgePosition(property: TLWH): EdgePosition {
  switch (property) {
    case 'top':
      return EdgePositionTop
    case 'height':
      return EdgePositionBottom
    case 'left':
      return EdgePositionLeft
    case 'width':
      return EdgePositionRight
    default:
      assertNever(property)
  }
}

function getMovementFromValues(property: TLWH, oldValue: number, newValue: number): CanvasVector {
  switch (property) {
    case 'left':
    case 'width':
      return canvasVector({ x: newValue - oldValue, y: 0 })
    case 'top':
    case 'height':
      return canvasVector({ x: 0, y: newValue - oldValue })
    default:
      assertNever(property)
  }
}

interface LTWHPixelValues {
  left: Array<number>
  top: Array<number>
  width: Array<number>
  height: Array<number>
}

export const FrameUpdatingLayoutSection = React.memo(() => {
  const dispatch = useDispatch()
  const metadataRef = useRefEditorState(metadataSelector)
  const selectedViewsRef = useRefEditorState(selectedViewsSelector)
  const elementPathTreeRef = useRefEditorState((store) => store.editor.elementPathTree)
  const allElementPropsRef = useRefEditorState((store) => store.editor.allElementProps)
  const projectContentsRef = useRefEditorState((store) => store.editor.projectContents)
  const originalGlobalFrame: CanvasRectangle = useEditorState(
    Substores.metadata,
    (store) => {
      const globalFrames = store.editor.selectedViews.map((selectedView) => {
        const metadata = MetadataUtils.findElementByElementPath(
          store.editor.jsxMetadata,
          selectedView,
        )
        const maybeInfinityGlobalFrame = metadata?.globalFrame ?? canvasRectangle(zeroRectangle)
        return isInfinityRectangle(maybeInfinityGlobalFrame)
          ? canvasRectangle(zeroRectangle)
          : maybeInfinityGlobalFrame
      })
      return boundingRectangleArray(globalFrames) ?? canvasRectangle(zeroRectangle)
    },
    'SimplifiedLayoutSubsection originalGlobalFrame',
    oneLevelNestedEquals,
  )
  const originalLTWHValues: LTWHPixelValues = useEditorState(
    Substores.metadata,
    (store) => {
      let result: LTWHPixelValues = {
        left: [],
        top: [],
        width: [],
        height: [],
      }
      for (const selectedView of store.editor.selectedViews) {
        const metadata = MetadataUtils.findElementByElementPath(
          store.editor.jsxMetadata,
          selectedView,
        )
        if (metadata == null) {
          result.left.push(0)
          result.top.push(0)
          result.width.push(0)
          result.height.push(0)
        } else {
          const maybeInfinityLocalFrame = metadata.localFrame
          if (maybeInfinityLocalFrame == null || isInfinityRectangle(maybeInfinityLocalFrame)) {
            result.left.push(0)
            result.top.push(0)
            result.width.push(0)
            result.height.push(0)
          } else {
            result.left.push(maybeInfinityLocalFrame.x)
            result.top.push(maybeInfinityLocalFrame.y)
            result.width.push(maybeInfinityLocalFrame.width)
            result.height.push(maybeInfinityLocalFrame.height)
          }
        }
      }
      return result
    },
    'SimplifiedLayoutSubsection originalLTWHValues',
    oneLevelNestedEquals,
  )

  const updateFrame = React.useCallback(
    (frameUpdate: FrameUpdate) => {
      switch (frameUpdate.type) {
        case 'DELTA_FRAME_UPDATE':
          if (
            frameUpdate.edgePosition === EdgePositionTop ||
            frameUpdate.edgePosition === EdgePositionLeft
          ) {
            executeFirstApplicableStrategy(
              dispatch,
              metadataRef.current,
              selectedViewsRef.current,
              elementPathTreeRef.current,
              allElementPropsRef.current,
              [moveInspectorStrategy(projectContentsRef.current, frameUpdate.edgeMovement)],
            )
          } else {
            executeFirstApplicableStrategy(
              dispatch,
              metadataRef.current,
              selectedViewsRef.current,
              elementPathTreeRef.current,
              allElementPropsRef.current,
              [
                resizeInspectorStrategy(
                  projectContentsRef.current,
                  originalGlobalFrame,
                  frameUpdate.edgePosition,
                  frameUpdate.edgeMovement,
                ),
              ],
            )
          }
          break
        case 'DIRECT_FRAME_UPDATE':
          if (
            frameUpdate.edgePosition === EdgePositionTop ||
            frameUpdate.edgePosition === EdgePositionLeft
          ) {
            const leftOrTop = frameUpdate.edgePosition === EdgePositionLeft ? 'left' : 'top'
            executeFirstApplicableStrategy(
              dispatch,
              metadataRef.current,
              selectedViewsRef.current,
              elementPathTreeRef.current,
              allElementPropsRef.current,
              [
                directMoveInspectorStrategy(
                  projectContentsRef.current,
                  leftOrTop,
                  frameUpdate.edgeValue,
                ),
              ],
            )
          } else {
            const widthOrHeight =
              frameUpdate.edgePosition === EdgePositionRight ? 'width' : 'height'
            executeFirstApplicableStrategy(
              dispatch,
              metadataRef.current,
              selectedViewsRef.current,
              elementPathTreeRef.current,
              allElementPropsRef.current,
              [
                directResizeInspectorStrategy(
                  projectContentsRef.current,
                  widthOrHeight,
                  frameUpdate.edgeValue,
                ),
              ],
            )
          }
          break
        default:
          assertNever(frameUpdate)
      }
    },
    [
      allElementPropsRef,
      dispatch,
      elementPathTreeRef,
      metadataRef,
      originalGlobalFrame,
      projectContentsRef,
      selectedViewsRef,
    ],
  )

  return (
    <>
      <UIGridRow
        padded={false}
        variant='<--1fr--><--1fr-->'
        style={{ minHeight: undefined, gap: 4 }}
      >
        <FrameUpdatingLayoutControl
          property='left'
          label='L'
          updateFrame={updateFrame}
          currentValues={originalLTWHValues.left}
        />
        <FrameUpdatingLayoutControl
          property='top'
          label='T'
          updateFrame={updateFrame}
          currentValues={originalLTWHValues.top}
        />
      </UIGridRow>
      <UIGridRow
        padded={false}
        variant='<--1fr--><--1fr-->'
        style={{ minHeight: undefined, gap: 4 }}
      >
        <FrameUpdatingLayoutControl
          property='width'
          label='W'
          updateFrame={updateFrame}
          currentValues={originalLTWHValues.width}
        />
        <FrameUpdatingLayoutControl
          property='height'
          label='H'
          updateFrame={updateFrame}
          currentValues={originalLTWHValues.height}
        />
      </UIGridRow>
    </>
  )
})
FrameUpdatingLayoutSection.displayName = 'FrameUpdatingLayoutSection'

interface DeltaFrameUpdate {
  type: 'DELTA_FRAME_UPDATE'
  edgePosition: EdgePosition
  edgeMovement: CanvasVector
}

function deltaFrameUpdate(
  edgePosition: EdgePosition,
  edgeMovement: CanvasVector,
): DeltaFrameUpdate {
  return {
    type: 'DELTA_FRAME_UPDATE',
    edgePosition: edgePosition,
    edgeMovement: edgeMovement,
  }
}

interface DirectFrameUpdate {
  type: 'DIRECT_FRAME_UPDATE'
  edgePosition: EdgePosition
  edgeValue: number
}

function directFrameUpdate(edgePosition: EdgePosition, edgeValue: number): DirectFrameUpdate {
  return {
    type: 'DIRECT_FRAME_UPDATE',
    edgePosition: edgePosition,
    edgeValue: edgeValue,
  }
}

type FrameUpdate = DeltaFrameUpdate | DirectFrameUpdate

interface LayoutPinPropertyControlProps {
  label: string
  property: TLWH
  currentValues: Array<number>
  updateFrame: (frameUpdate: FrameUpdate) => void
}

function getSingleCommonValue(currentValues: Array<number>): number | null {
  // Capture the first value to check against every other value.
  const firstValue = currentValues[0]
  // Must have at least 2 entries for there to be multiple different values.
  if (currentValues.length > 1) {
    for (let index: number = 1; index < currentValues.length; index++) {
      // Compare against every other value, any difference is enough to stop then and there.
      const value = currentValues[index]
      if (firstValue !== value) {
        return null
      }
    }
  }

  // Fallback, in all other cases assume there are not multiple different values.
  return firstValue
}

const FrameUpdatingLayoutControl = React.memo((props: LayoutPinPropertyControlProps) => {
  const { property, currentValues, updateFrame } = props
  const pointInfo = useInspectorLayoutInfo(props.property)

  // a way to reset the NumberInput to the real measured value it was displaying before the user started typing into it
  const [mountCount, resetNumberInputToOriginalValue] = React.useReducer((c) => c + 1, 0)

  const singleCommonValue = getSingleCommonValue(currentValues)

  const onSubmitValue = React.useCallback(
    (newValue: UnknownOrEmptyInput<CSSNumber>) => {
      if (isUnknownInputValue(newValue)) {
        // Ignore right now.
        resetNumberInputToOriginalValue()
      } else if (isEmptyInputValue(newValue)) {
        // Reset the NumberInput
        resetNumberInputToOriginalValue()
      } else {
        if (newValue.unit == null || newValue.unit === 'px') {
          const edgePosition = getTLWHEdgePosition(property)
          if (singleCommonValue == null) {
            updateFrame(directFrameUpdate(edgePosition, newValue.value))
          } else {
            const movement = getMovementFromValues(property, singleCommonValue, newValue.value)
            updateFrame(deltaFrameUpdate(edgePosition, movement))
          }
        } else {
          console.error('Attempting to use a value with a unit, which is invalid.')
          resetNumberInputToOriginalValue()
        }
      }
    },
    [property, singleCommonValue, updateFrame],
  )

  return (
    <InspectorContextMenuWrapper
      id={`position-${props.property}-context-menu`}
      items={[unsetPropertyMenuItem(props.property, pointInfo.onUnsetValues)]}
      data={{}}
    >
      <NumberInput
        key={`frame-${props.property}-number-input-mount-${mountCount}`}
        data-controlstatus={pointInfo.controlStatus}
        value={optionalMap(cssNumber, singleCommonValue)}
        id={`frame-${props.property}-number-input`}
        testId={`frame-${props.property}-number-input`}
        labelInner={props.label}
        onSubmitValue={onSubmitValue}
        onTransientSubmitValue={onSubmitValue}
        incrementControls={singleCommonValue == null}
        controlStatus={singleCommonValue == null ? 'multiselect-mixed-simple-or-unset' : 'simple'}
        numberType={'LengthPercent'}
        defaultUnitToHide={'px'}
      />
    </InspectorContextMenuWrapper>
  )
})
FrameUpdatingLayoutControl.displayName = 'FrameUpdatingLayoutControl'
