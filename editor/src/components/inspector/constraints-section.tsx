/** @jsxRuntime classic */
/** @jsx jsx */
import { jsx } from '@emotion/react'

import React from 'react'
import { useContextSelector } from 'use-context-selector'
import type { LayoutPinnedPropIncludingCenter } from '../../core/layout/layout-helpers-new'
import { when } from '../../utils/react-conditionals'
import { FlexColumn, FlexRow, InspectorSubsectionHeader, PopupList, UtopiaTheme } from '../../uuiui'
import type { SelectOption } from '../../uuiui-deps'
import { getControlStyles } from '../../uuiui-deps'
import { InspectorRowHoverCSS } from '../context-menu-wrapper'
import { useDispatch } from '../editor/store/dispatch-context'
import { Substores, useEditorState, useRefEditorState } from '../editor/store/store-hook'
import type { FramePinsInfo } from './common/layout-property-path-hooks'
import { InspectorPropsContext } from './common/property-path-hooks'
import { PinControl } from './controls/pin-control'
import {
  allElementsAreGroupChildren,
  anySelectedElementGroupOrChildOfGroup,
} from './fill-hug-fixed-control'
import { selectedViewsSelector } from './inpector-selectors'
import type { RequestedPins } from './simplified-pinning-helpers'
import {
  HorizontalPinChangeOptions,
  HorizontalPinChangeOptionsIncludingMixed,
  VerticalPinChangeOptions,
  VerticalPinChangeOptionsIncludingMixed,
  getConstraintAndFrameChangeActionsForGroupChild,
  getFixedPointsForPinning,
  getFrameChangeActionsForFrameChild,
  useDetectedConstraints,
} from './simplified-pinning-helpers'
import { PinHeightSVG, PinWidthSVG } from './utility-controls/pin-control'
import { UIGridRow } from './widgets/ui-grid-row'

export const ConstraintsSection = React.memo(() => {
  const noGroupOrGroupChildrenSelected = !useEditorState(
    Substores.metadata,
    anySelectedElementGroupOrChildOfGroup,
    'ConstraintsSection someGroupOrGroupChildrenSelected',
  )
  const onlyGroupChildrenSelected = useEditorState(
    Substores.metadata,
    allElementsAreGroupChildren,
    'ConstraintsSection onlyGroupChildrenSelected',
  )

  return (
    <React.Fragment>
      <InspectorSubsectionHeader>
        <FlexRow
          style={{
            flexGrow: 1,
            height: 42,
          }}
        >
          <span style={{ flex: 1 }}>Constraints</span>
        </FlexRow>
      </InspectorSubsectionHeader>
      {when(noGroupOrGroupChildrenSelected, <FrameChildConstraintsSection />)}
      {when(onlyGroupChildrenSelected, <GroupChildConstraintsSection />)}
    </React.Fragment>
  )
})
ConstraintsSection.displayName = 'ConstraintsSection'

const GroupChildConstraintsSection = React.memo(() => {
  return (
    <FlexColumn css={{ paddingBottom: UtopiaTheme.layout.rowHorizontalPadding }}>
      <UIGridRow padded variant='<-auto-><----------1fr--------->'>
        <ChildPinControl isGroupChild='group-child' />
        <FlexColumn style={{ gap: 8 }}>
          <FlexRow css={InspectorRowHoverCSS}>
            <PinWidthSVG />
            <ChildConstraintSelect isGroupChild='group-child' dimension={'width'} />
          </FlexRow>
          <FlexRow css={InspectorRowHoverCSS}>
            <PinHeightSVG />
            <ChildConstraintSelect isGroupChild='group-child' dimension={'height'} />
          </FlexRow>
        </FlexColumn>
      </UIGridRow>
    </FlexColumn>
  )
})
GroupChildConstraintsSection.displayName = 'GroupChildConstraintsSection'

const FrameChildConstraintsSection = React.memo(() => {
  return (
    <FlexColumn css={{ paddingBottom: UtopiaTheme.layout.rowHorizontalPadding }}>
      <UIGridRow padded variant='<-auto-><----------1fr--------->'>
        <ChildPinControl isGroupChild='frame-child' />
        <FlexColumn css={{ gap: 8 }}>
          <FlexRow css={InspectorRowHoverCSS}>
            <PinWidthSVG />
            <ChildConstraintSelect isGroupChild='frame-child' dimension={'width'} />
          </FlexRow>
          <FlexRow css={InspectorRowHoverCSS}>
            <PinHeightSVG />
            <ChildConstraintSelect isGroupChild='frame-child' dimension={'height'} />
          </FlexRow>
        </FlexColumn>
      </UIGridRow>
    </FlexColumn>
  )
})
FrameChildConstraintsSection.displayName = 'FrameChildConstraintsSection'

const ChildPinControl = React.memo(
  ({ isGroupChild }: { isGroupChild: 'group-child' | 'frame-child' }) => {
    const dispatch = useDispatch()

    const propertyTarget = useContextSelector(InspectorPropsContext, (contextData) => {
      return contextData.targetPath
    })

    const selectedViewsRef = useRefEditorState(selectedViewsSelector)
    const metadataRef = useRefEditorState((store) => store.editor.jsxMetadata)
    const allElementPropsRef = useRefEditorState((store) => store.editor.allElementProps)

    const pins = useDetectedConstraints(isGroupChild)

    const onPinControlMouseDown = React.useCallback(
      (
        frameProp: LayoutPinnedPropIncludingCenter,
        event: React.MouseEvent<Element, MouseEvent>,
      ) => {
        const cmdPressed = event.metaKey
        const requestedPinChange: RequestedPins | 'no-op' = (() => {
          switch (frameProp) {
            case 'left': {
              if (cmdPressed && pins.horizontal === 'right-and-width') {
                return 'left-and-right'
              } else {
                return 'left-and-width'
              }
            }
            case 'right': {
              if (cmdPressed && pins.horizontal === 'left-and-width') {
                return 'left-and-right'
              } else {
                return 'right-and-width'
              }
            }
            case 'width': {
              return 'left-and-width'
            }
            case 'top': {
              if (cmdPressed && pins.vertical === 'bottom-and-height') {
                return 'top-and-bottom'
              } else {
                return 'top-and-height'
              }
            }
            case 'bottom': {
              if (cmdPressed && pins.vertical === 'top-and-height') {
                return 'top-and-bottom'
              } else {
                return 'bottom-and-height'
              }
            }
            case 'height': {
              return 'top-and-height'
            }
            case 'centerX': {
              if (cmdPressed) {
                return 'scale-horizontal'
              } else {
                return 'no-op'
              }
            }
            case 'centerY': {
              if (cmdPressed) {
                return 'scale-vertical'
              } else {
                return 'no-op'
              }
            }
            default:
              const _exhaustiveCheck: never = frameProp
              throw new Error(`Unhandled frameProp: ${_exhaustiveCheck}`)
          }
        })()

        if (requestedPinChange === 'no-op') {
          // no-op, early return :)
          return
        }
        dispatch(
          isGroupChild === 'group-child'
            ? getConstraintAndFrameChangeActionsForGroupChild(
                metadataRef.current,
                allElementPropsRef.current,
                propertyTarget,
                selectedViewsRef.current,
                requestedPinChange,
              )
            : getFrameChangeActionsForFrameChild(
                metadataRef.current,
                propertyTarget,
                selectedViewsRef.current,
                requestedPinChange,
              ),
        )
      },
      [
        dispatch,
        metadataRef,
        allElementPropsRef,
        selectedViewsRef,
        isGroupChild,
        propertyTarget,
        pins,
      ],
    )

    const framePoints: FramePinsInfo = React.useMemo(() => getFixedPointsForPinning(pins), [pins])

    return (
      <PinControl
        handlePinMouseDown={onPinControlMouseDown}
        framePoints={framePoints}
        controlStatus='simple'
        name='group-child-controls'
      />
    )
  },
)
ChildPinControl.displayName = 'ChildPinControl'

const ChildConstraintSelect = React.memo(
  (props: { dimension: 'width' | 'height'; isGroupChild: 'group-child' | 'frame-child' }) => {
    const { dimension, isGroupChild } = props

    const dispatch = useDispatch()

    const propertyTarget = useContextSelector(InspectorPropsContext, (contextData) => {
      return contextData.targetPath
    })

    const editorRef = useRefEditorState((store) => ({
      selectedViews: store.editor.selectedViews,
      metadata: store.editor.jsxMetadata,
      allElementProps: store.editor.allElementProps,
    }))

    const pins = useDetectedConstraints(isGroupChild)

    const optionsToUse =
      dimension === 'width'
        ? Object.values(HorizontalPinChangeOptions)
        : Object.values(VerticalPinChangeOptions)

    const activeOption =
      dimension === 'width'
        ? HorizontalPinChangeOptionsIncludingMixed[pins.horizontal]
        : VerticalPinChangeOptionsIncludingMixed[pins.vertical]

    const onSubmit = React.useCallback(
      (option: SelectOption) => {
        const requestedPins: RequestedPins = option.value
        dispatch(
          isGroupChild === 'group-child'
            ? getConstraintAndFrameChangeActionsForGroupChild(
                editorRef.current.metadata,
                editorRef.current.allElementProps,
                propertyTarget,
                editorRef.current.selectedViews,
                requestedPins,
              )
            : getFrameChangeActionsForFrameChild(
                editorRef.current.metadata,
                propertyTarget,
                editorRef.current.selectedViews,
                requestedPins,
              ),
        )
      },
      [dispatch, propertyTarget, editorRef, isGroupChild],
    )

    return (
      <PopupList
        id={`frame-child-constraint-${dimension}`}
        onSubmitValue={onSubmit}
        value={activeOption}
        options={optionsToUse}
        style={{
          position: 'relative',
        }}
        controlStyles={getControlStyles('simple')}
      />
    )
  },
)
