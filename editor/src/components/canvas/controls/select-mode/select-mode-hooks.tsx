import React from 'react'
import { MetadataUtils } from '../../../../core/model/element-metadata-utils'
import { mapDropNulls, uniqBy } from '../../../../core/shared/array-utils'
import { ElementInstanceMetadataMap } from '../../../../core/shared/element-template'
import {
  boundingRectangleArray,
  CanvasPoint,
  distance,
  isInfinityRectangle,
  point,
  WindowPoint,
  windowPoint,
} from '../../../../core/shared/math-utils'
import { ElementPath } from '../../../../core/shared/project-file-types'
import * as EP from '../../../../core/shared/element-path'
import { fastForEach } from '../../../../core/shared/utils'
import { KeysPressed } from '../../../../utils/keyboard'
import Utils from '../../../../utils/utils'
import {
  clearHighlightedViews,
  clearSelection,
  setFocusedElement,
  setHighlightedView,
  selectComponents,
  setHoveredView,
  clearHoveredViews,
} from '../../../editor/actions/action-creators'
import { cancelInsertModeActions } from '../../../editor/actions/meta-actions'
import { EditorState, EditorStorePatched, LockedElements } from '../../../editor/store/editor-state'
import { Substores, useEditorState, useRefEditorState } from '../../../editor/store/store-hook'
import CanvasActions from '../../canvas-actions'
import { moveDragState } from '../../canvas-types'
import {
  createDuplicationNewUIDs,
  getDragStateDrag,
  getOriginalCanvasFrames,
} from '../../canvas-utils'
import { getSelectionOrValidTargetAtPoint, getValidTargetAtPoint } from '../../dom-lookup'
import { useWindowToCanvasCoordinates } from '../../dom-lookup-hooks'
import { useInsertModeSelectAndHover } from '../insert-mode/insert-mode-hooks'
import { WindowMousePositionRaw } from '../../../../utils/global-positions'
import {
  boundingArea,
  createInteractionViaMouse,
  isDragToPan,
  KeyboardInteractionTimeout,
} from '../../canvas-strategies/interaction-state'
import { Modifier } from '../../../../utils/modifiers'
import { pathsEqual } from '../../../../core/shared/element-path'
import { EditorAction } from '../../../../components/editor/action-types'
import { EditorModes, isInsertMode } from '../../../editor/editor-modes'
import {
  scheduleTextEditForNextFrame,
  useTextEditModeSelectAndHover,
} from '../text-edit-mode/text-edit-mode-hooks'
import { useDispatch } from '../../../editor/store/dispatch-context'

const DRAG_START_THRESHOLD = 2

export function isResizing(editorState: EditorState): boolean {
  // TODO retire isResizing and replace with isInteractionActive once we have the strategies turned on, and the old controls removed
  const dragState = editorState.canvas.dragState
  return (
    (dragState?.type === 'RESIZE_DRAG_STATE' &&
      getDragStateDrag(dragState, editorState.canvas.resizeOptions) != null) ||
    editorState.canvas.interactionSession?.interactionData.type === 'DRAG'
  )
}

export function isDragging(editorState: EditorState): boolean {
  // TODO retire isDragging and replace with isInteractionActive once we have the strategies turned on, and the old controls removed
  const dragState = editorState.canvas.dragState
  return (
    (dragState?.type === 'MOVE_DRAG_STATE' &&
      getDragStateDrag(dragState, editorState.canvas.resizeOptions) != null) ||
    editorState.canvas.interactionSession?.interactionData.type === 'DRAG'
  )
}

export function isInserting(editorState: EditorState): boolean {
  const dragState = editorState.canvas.dragState
  return (
    dragState?.type === 'INSERT_DRAG_STATE' &&
    getDragStateDrag(dragState, editorState.canvas.resizeOptions) != null
  )
}

export function pickSelectionEnabled(
  canvas: EditorState['canvas'],
  keysPressed: KeysPressed,
): boolean {
  return canvas.selectionControlsVisible && !keysPressed['z'] && canvas.textEditor == null
}

/**
 * maybeHighlightOnHover and maybeClearHighlightsOnHoverEnd are moved here from new-canvas-controls, kept as-is for continuity
 */
export function useMaybeHighlightElement(): {
  maybeHighlightOnHover: (target: ElementPath) => void
  maybeClearHighlightsOnHoverEnd: () => void
  maybeHoverOnHover: (target: ElementPath) => void
  maybeClearHoveredViewsOnHoverEnd: () => void
} {
  const dispatch = useDispatch()
  const stateRef = useRefEditorState((store) => {
    return {
      resizing: isResizing(store.editor),
      dragging: isDragging(store.editor),
      selectionEnabled: pickSelectionEnabled(store.editor.canvas, store.editor.keysPressed),
      inserting: isInserting(store.editor),
      highlightedViews: store.editor.highlightedViews,
      hoveredViews: store.editor.hoveredViews,
    }
  })

  const maybeHighlightOnHover = React.useCallback(
    (target: ElementPath): void => {
      const { dragging, resizing, selectionEnabled, inserting, highlightedViews } = stateRef.current

      const alreadyHighlighted = pathsEqual(target, highlightedViews?.[0])

      if (selectionEnabled && !dragging && !resizing && !inserting && !alreadyHighlighted) {
        dispatch([setHighlightedView(target)], 'canvas')
      }
    },
    [dispatch, stateRef],
  )

  const maybeClearHighlightsOnHoverEnd = React.useCallback((): void => {
    const { dragging, resizing, selectionEnabled, inserting, highlightedViews } = stateRef.current

    if (selectionEnabled && !dragging && !resizing && !inserting && highlightedViews.length > 0) {
      dispatch([clearHighlightedViews()], 'canvas')
    }
  }, [dispatch, stateRef])

  const maybeHoverOnHover = React.useCallback(
    (target: ElementPath): void => {
      const { dragging, resizing, inserting, hoveredViews } = stateRef.current

      const alreadyHovered = pathsEqual(target, hoveredViews?.[0])

      if (!dragging && !resizing && !inserting && !alreadyHovered) {
        dispatch([setHoveredView(target)], 'canvas')
      }
    },
    [dispatch, stateRef],
  )

  const maybeClearHoveredViewsOnHoverEnd = React.useCallback((): void => {
    const { dragging, resizing, inserting, hoveredViews } = stateRef.current

    if (!dragging && !resizing && !inserting && hoveredViews.length > 0) {
      dispatch([clearHoveredViews()], 'canvas')
    }
  }, [dispatch, stateRef])

  return {
    maybeHighlightOnHover: maybeHighlightOnHover,
    maybeClearHighlightsOnHoverEnd: maybeClearHighlightsOnHoverEnd,
    maybeHoverOnHover: maybeHoverOnHover,
    maybeClearHoveredViewsOnHoverEnd: maybeClearHoveredViewsOnHoverEnd,
  }
}

function filterNonSelectableElements(
  nonSelectablePaths: Array<ElementPath>,
  paths: Array<ElementPath>,
): Array<ElementPath> {
  return paths.filter((path) =>
    nonSelectablePaths.every((nonSelectablePath) => !EP.pathsEqual(path, nonSelectablePath)),
  )
}

function collectSelectableSiblings(
  componentMetadata: ElementInstanceMetadataMap,
  selectedViews: Array<ElementPath>,
  childrenSelectable: boolean,
  lockedElements: LockedElements,
): Array<ElementPath> {
  let siblings: Array<ElementPath> = []
  Utils.fastForEach(selectedViews, (view) => {
    function addChildrenAndUnfurledFocusedComponents(paths: Array<ElementPath>) {
      Utils.fastForEach(paths, (ancestor) => {
        const { children, unfurledComponents } =
          MetadataUtils.getAllChildrenIncludingUnfurledFocusedComponents(
            ancestor,
            componentMetadata,
          )

        siblings.push(ancestor)

        const ancestorChildren = [...children, ...unfurledComponents]
        fastForEach(ancestorChildren, (child) => {
          siblings.push(child)

          // If this element is locked we want to recurse the children
          if (lockedElements.simpleLock.some((path) => EP.pathsEqual(path, child))) {
            addChildrenAndUnfurledFocusedComponents([child])
          }
        })
      })
    }

    const allPaths = childrenSelectable
      ? EP.allPathsForLastPart(view)
      : EP.allPathsForLastPart(EP.parentPath(view))

    addChildrenAndUnfurledFocusedComponents(allPaths)
  })
  return siblings
}

function getAllLockedElementPaths(
  componentMetadata: ElementInstanceMetadataMap,
  lockedElements: LockedElements,
): Array<ElementPath> {
  const descendantsOfHierarchyLocked = MetadataUtils.getAllPaths(componentMetadata).filter((path) =>
    MetadataUtils.isDescendantOfHierarchyLockedElement(path, lockedElements),
  )
  return [
    ...lockedElements.simpleLock,
    ...lockedElements.hierarchyLock,
    ...descendantsOfHierarchyLocked,
  ]
}

export function getSelectableViews(
  componentMetadata: ElementInstanceMetadataMap,
  selectedViews: Array<ElementPath>,
  hiddenInstances: Array<ElementPath>,
  allElementsDirectlySelectable: boolean,
  childrenSelectable: boolean,
  lockedElements: LockedElements,
): ElementPath[] {
  let candidateViews: Array<ElementPath>

  if (allElementsDirectlySelectable) {
    candidateViews = MetadataUtils.getAllPathsIncludingUnfurledFocusedComponents(componentMetadata)
  } else {
    const allRoots = MetadataUtils.getAllCanvasRootPaths(componentMetadata)
    const siblings = collectSelectableSiblings(
      componentMetadata,
      selectedViews,
      childrenSelectable,
      lockedElements,
    )

    const selectableViews = [...allRoots, ...siblings]
    const uniqueSelectableViews = uniqBy<ElementPath>(selectableViews, EP.pathsEqual)

    candidateViews = uniqueSelectableViews
  }

  const nonSelectableElements = [
    ...hiddenInstances,
    ...getAllLockedElementPaths(componentMetadata, lockedElements),
  ]
  return filterNonSelectableElements(nonSelectableElements, candidateViews)
}

export function useFindValidTarget(): (
  selectableViews: Array<ElementPath>,
  mousePoint: WindowPoint | null,
  preferAlreadySelected: 'prefer-selected' | 'dont-prefer-selected',
) => {
  elementPath: ElementPath
  isSelected: boolean
} | null {
  const storeRef = useRefEditorState((store) => {
    return {
      componentMetadata: store.editor.jsxMetadata,
      selectedViews: store.editor.selectedViews,
      hiddenInstances: store.editor.hiddenInstances,
      canvasScale: store.editor.canvas.scale,
      canvasOffset: store.editor.canvas.realCanvasOffset,
      focusedElementPath: store.editor.focusedElementPath,
      allElementProps: store.editor.allElementProps,
    }
  })

  return React.useCallback(
    (
      selectableViews: Array<ElementPath>,
      mousePoint: WindowPoint | null,
      preferAlreadySelected: 'prefer-selected' | 'dont-prefer-selected',
    ) => {
      const {
        selectedViews,
        componentMetadata,
        hiddenInstances,
        canvasScale,
        canvasOffset,
        allElementProps,
      } = storeRef.current
      const validElementMouseOver: ElementPath | null =
        preferAlreadySelected === 'prefer-selected'
          ? getSelectionOrValidTargetAtPoint(
              componentMetadata,
              selectedViews,
              hiddenInstances,
              selectableViews,
              mousePoint,
              canvasScale,
              canvasOffset,
              allElementProps,
            )
          : getValidTargetAtPoint(selectableViews, mousePoint)
      const validElementPath: ElementPath | null =
        validElementMouseOver != null ? validElementMouseOver : null
      if (validElementPath != null) {
        const isSelected = selectedViews.some((selectedView) =>
          EP.pathsEqual(validElementPath, selectedView),
        )
        return {
          elementPath: validElementPath,
          isSelected: isSelected,
        }
      } else {
        return null
      }
    },
    [storeRef],
  )
}

function useStartDragState(): (
  target: ElementPath,
  start: CanvasPoint | null,
) => (event: MouseEvent) => void {
  const dispatch = useDispatch()
  const entireEditorStoreRef = useRefEditorState((store) => store)

  return React.useCallback(
    (target: ElementPath, start: CanvasPoint | null) => (event: MouseEvent) => {
      if (start == null) {
        return
      }

      const componentMetadata = entireEditorStoreRef.current.editor.jsxMetadata
      const selectedViews = entireEditorStoreRef.current.editor.selectedViews

      const duplicate = event.altKey
      const duplicateNewUIDs = duplicate
        ? createDuplicationNewUIDs(
            selectedViews,
            componentMetadata,
            entireEditorStoreRef.current.editor.projectContents,
          )
        : null

      const isTargetSelected = selectedViews.some((sv) => EP.pathsEqual(sv, target))

      const moveTargets =
        isTargetSelected && EP.areAllElementsInSameInstance(selectedViews)
          ? selectedViews
          : [target]

      let originalFrames = getOriginalCanvasFrames(moveTargets, componentMetadata)
      originalFrames = originalFrames.filter((f) => f.frame != null)

      const selectionArea = boundingRectangleArray(
        mapDropNulls((view) => {
          const frame = MetadataUtils.getFrameInCanvasCoords(view, componentMetadata)
          return frame == null || isInfinityRectangle(frame) ? null : frame
        }, selectedViews),
      )

      dispatch([
        CanvasActions.createDragState(
          moveDragState(
            start,
            null,
            null,
            originalFrames,
            selectionArea,
            !event.metaKey,
            event.shiftKey,
            duplicate,
            event.metaKey,
            duplicateNewUIDs,
            start,
            componentMetadata,
            moveTargets,
          ),
        ),
      ])
    },
    [dispatch, entireEditorStoreRef],
  )
}

function callbackAfterDragExceedsThreshold(
  startEvent: MouseEvent,
  threshold: number,
  callback: (event: MouseEvent) => void,
) {
  const startPoint = windowPoint(point(startEvent.clientX, startEvent.clientY))
  function onMouseMove(event: MouseEvent) {
    if (distance(startPoint, windowPoint(point(event.clientX, event.clientY))) > threshold) {
      callback(event)
      removeListeners()
    }
  }

  function onMouseUp() {
    removeListeners()
  }

  function removeListeners() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

export function useStartDragStateAfterDragExceedsThreshold(): (
  nativeEvent: MouseEvent,
  foundTarget: ElementPath,
) => void {
  const startDragState = useStartDragState()

  const windowToCanvasCoordinates = useWindowToCanvasCoordinates()

  const startDragStateAfterDragExceedsThreshold = React.useCallback(
    (nativeEvent: MouseEvent, foundTarget: ElementPath) => {
      const startPoint = windowToCanvasCoordinates(
        windowPoint(point(nativeEvent.clientX, nativeEvent.clientY)),
      ).canvasPositionRounded

      callbackAfterDragExceedsThreshold(
        nativeEvent,
        DRAG_START_THRESHOLD,
        startDragState(foundTarget, startPoint),
      )
    },
    [startDragState, windowToCanvasCoordinates],
  )

  return startDragStateAfterDragExceedsThreshold
}

export function useGetSelectableViewsForSelectMode() {
  const storeRef = useRefEditorState((store) => {
    return {
      componentMetadata: store.editor.jsxMetadata,
      selectedViews: store.editor.selectedViews,
      hiddenInstances: store.editor.hiddenInstances,
      lockedElements: store.editor.lockedElements,
    }
  })

  return React.useCallback(
    (allElementsDirectlySelectable: boolean, childrenSelectable: boolean) => {
      const { componentMetadata, selectedViews, hiddenInstances, lockedElements } = storeRef.current
      const selectableViews = getSelectableViews(
        componentMetadata,
        selectedViews,
        hiddenInstances,
        allElementsDirectlySelectable,
        childrenSelectable,
        lockedElements,
      )
      return selectableViews
    },
    [storeRef],
  )
}

export function useCalculateHighlightedViews(
  allowHoverOnSelectedView: boolean,
  getHighlightableViews: (
    allElementsDirectlySelectable: boolean,
    childrenSelectable: boolean,
  ) => ElementPath[],
): (targetPoint: WindowPoint, eventCmdPressed: boolean) => void {
  const {
    maybeHighlightOnHover,
    maybeClearHighlightsOnHoverEnd,
    maybeHoverOnHover,
    maybeClearHoveredViewsOnHoverEnd,
  } = useMaybeHighlightElement()
  const findValidTarget = useFindValidTarget()
  return React.useCallback(
    (targetPoint: WindowPoint, eventCmdPressed: boolean) => {
      const selectableViews: Array<ElementPath> = getHighlightableViews(eventCmdPressed, false)
      const validElementPath = findValidTarget(selectableViews, targetPoint, 'dont-prefer-selected')
      const validElementPathForHover = findValidTarget(
        selectableViews,
        targetPoint,
        'prefer-selected',
      )

      if (validElementPathForHover == null) {
        maybeClearHoveredViewsOnHoverEnd()
      } else {
        maybeHoverOnHover(validElementPathForHover.elementPath)
      }

      if (
        validElementPath == null ||
        (!allowHoverOnSelectedView && validElementPath.isSelected) // we remove highlights if the hovered element is selected
      ) {
        maybeClearHighlightsOnHoverEnd()
      } else {
        maybeHighlightOnHover(validElementPath.elementPath)
      }
    },
    [
      getHighlightableViews,
      findValidTarget,
      allowHoverOnSelectedView,
      maybeClearHighlightsOnHoverEnd,
      maybeClearHoveredViewsOnHoverEnd,
      maybeHighlightOnHover,
      maybeHoverOnHover,
    ],
  )
}

export function useHighlightCallbacks(
  active: boolean,
  cmdPressed: boolean,
  allowHoverOnSelectedView: boolean,
  getHighlightableViews: (
    allElementsDirectlySelectable: boolean,
    childrenSelectable: boolean,
  ) => ElementPath[],
): {
  onMouseMove: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
} {
  const calculateHighlightedViews = useCalculateHighlightedViews(
    allowHoverOnSelectedView,
    getHighlightableViews,
  )

  const onMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      return calculateHighlightedViews(
        windowPoint(point(event.clientX, event.clientY)),
        event.metaKey,
      )
    },
    [calculateHighlightedViews],
  )

  React.useEffect(() => {
    if (active && WindowMousePositionRaw != null) {
      // this useEffect will re-calculate (and update) the highlighted views if the user presses or releases 'cmd' without moving the mouse,
      // or if the user enters a new mode (the `active` flag will change for the modes), this is important when entering insert mode
      setTimeout(() => {
        calculateHighlightedViews(WindowMousePositionRaw!, cmdPressed)
      }, 0)
    }
  }, [calculateHighlightedViews, active, cmdPressed])

  return { onMouseMove }
}

function getPreferredSelectionForEvent(
  eventType: 'mousedown' | 'mouseup' | string,
  isDoubleClick: boolean,
): 'prefer-selected' | 'dont-prefer-selected' {
  // mousedown keeps selection on a single click to allow dragging overlapping elements and selection happens on mouseup
  // with continuous clicking mousedown should select
  switch (eventType) {
    case 'mousedown':
      return isDoubleClick ? 'dont-prefer-selected' : 'prefer-selected'
    case 'mouseup':
      return isDoubleClick ? 'prefer-selected' : 'dont-prefer-selected'
    default:
      return 'prefer-selected'
  }
}

export interface MouseCallbacks {
  onMouseMove: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseDown: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseUp: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
}

function useSelectOrLiveModeSelectAndHover(
  active: boolean,
  draggingAllowed: boolean,
  cmdPressed: boolean,
  setSelectedViewsForCanvasControlsOnly: (newSelectedViews: ElementPath[]) => void,
): MouseCallbacks {
  const dispatch = useDispatch()
  const selectedViewsRef = useRefEditorState((store) => store.editor.selectedViews)
  const findValidTarget = useFindValidTarget()
  const getSelectableViewsForSelectMode = useGetSelectableViewsForSelectMode()
  const windowToCanvasCoordinates = useWindowToCanvasCoordinates()
  const interactionSessionHappened = React.useRef(false)
  const didWeHandleMouseDown = React.useRef(false) //  this is here to avoid selecting when closing text editing

  const { onMouseMove: innerOnMouseMove } = useHighlightCallbacks(
    active,
    cmdPressed,
    false,
    getSelectableViewsForSelectMode,
  )

  const editorStoreRef = useRefEditorState((store) => ({
    editor: store.editor,
    derived: store.derived,
  }))

  const onMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Do not handle the mouse move in the regular style if 'space' is pressed.
      const isDragIntention =
        isDragToPan(
          editorStoreRef.current.editor.canvas.interactionSession,
          editorStoreRef.current.editor.keysPressed['space'],
        ) || event.buttons === 4
      if (isDragIntention) {
        return
      }
      if (editorStoreRef.current.editor.canvas.interactionSession == null) {
        innerOnMouseMove(event)
      } else {
        // An interaction session has happened, which is important to know on mouseup
        interactionSessionHappened.current = true
      }
    },
    [innerOnMouseMove, editorStoreRef],
  )
  const mouseHandler = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const isLeftClick = event.button === 0
      const isDragIntention =
        editorStoreRef.current.editor.keysPressed['space'] || event.button === 1
      const hasInteractionSessionWithMouseMoved =
        editorStoreRef.current.editor.canvas.interactionSession?.interactionData?.type === 'DRAG'
          ? editorStoreRef.current.editor.canvas.interactionSession?.interactionData?.drag != null
          : false
      const hasInteractionSession = editorStoreRef.current.editor.canvas.interactionSession != null
      const hadInteractionSessionThatWasCancelled =
        interactionSessionHappened.current && !hasInteractionSession

      const activeControl = editorStoreRef.current.editor.canvas.interactionSession?.activeControl
      const mouseUpSelectionAllowed =
        didWeHandleMouseDown.current &&
        !hadInteractionSessionThatWasCancelled &&
        (activeControl == null || activeControl.type === 'BOUNDING_AREA')

      if (event.type === 'mousedown') {
        didWeHandleMouseDown.current = true
      }
      if (event.type === 'mouseup') {
        // Clear the interaction session tracking flag
        interactionSessionHappened.current = false
        // didWeHandleMouseDown is used to avoid selecting when closing text editing
        didWeHandleMouseDown.current = false

        if (!mouseUpSelectionAllowed) {
          // We should skip this mouseup
          return
        }
      }

      if (isDragIntention || hasInteractionSessionWithMouseMoved || !active || !isLeftClick) {
        // Skip all of this handling if 'space' is pressed or a mousemove happened in an interaction, or the hook is not active
        return
      }

      const doubleClick = event.type === 'mousedown' && event.detail > 0 && event.detail % 2 === 0
      const selectableViews = getSelectableViewsForSelectMode(event.metaKey, doubleClick)
      const preferAlreadySelected = getPreferredSelectionForEvent(event.type, doubleClick)
      const foundTarget = findValidTarget(
        selectableViews,
        windowPoint(point(event.clientX, event.clientY)),
        preferAlreadySelected,
      )

      const isMultiselect = event.shiftKey
      const isDeselect = foundTarget == null && !isMultiselect
      let editorActions: Array<EditorAction> = []

      if (foundTarget != null || isDeselect) {
        if (foundTarget != null && draggingAllowed) {
          const start = windowToCanvasCoordinates(
            windowPoint(point(event.clientX, event.clientY)),
          ).canvasPositionRounded
          if (event.button !== 2 && event.type !== 'mouseup') {
            editorActions.push(
              CanvasActions.createInteractionSession(
                createInteractionViaMouse(
                  start,
                  Modifier.modifiersForEvent(event),
                  boundingArea(),
                  'zero-drag-not-permitted',
                ),
              ),
            )
          }
        }

        let updatedSelection: Array<ElementPath>
        if (isMultiselect) {
          updatedSelection = EP.addPathIfMissing(foundTarget!.elementPath, selectedViewsRef.current)
        } else {
          updatedSelection = foundTarget != null ? [foundTarget.elementPath] : []
        }

        const foundTargetIsSelected = foundTarget?.isSelected ?? false

        if (foundTarget != null && foundTargetIsSelected && doubleClick) {
          // for components without passed children doubleclicking enters focus mode
          const isFocusableLeaf = MetadataUtils.isFocusableLeafComponent(
            foundTarget.elementPath,
            editorStoreRef.current.editor.jsxMetadata,
          )
          if (isFocusableLeaf) {
            editorActions.push(CanvasActions.clearInteractionSession(false))
            editorActions.push(setFocusedElement(foundTarget.elementPath))
          }

          const isEditableText = MetadataUtils.targetTextEditableAndHasText(
            editorStoreRef.current.editor.jsxMetadata,
            foundTarget.elementPath,
          )
          if (isEditableText) {
            editorActions.push(CanvasActions.clearInteractionSession(false))
            // We need to dispatch switching to text edit mode in the next frame, otherwise the mouse up blurs the text editor immediately
            scheduleTextEditForNextFrame(
              foundTarget.elementPath,
              { x: event.clientX, y: event.clientY },
              dispatch,
            )
          }
        }

        if (!foundTargetIsSelected) {
          // first we only set the selected views for the canvas controls
          setSelectedViewsForCanvasControlsOnly(updatedSelection)

          // In either case cancel insert mode.
          if (isInsertMode(editorStoreRef.current.editor.mode)) {
            editorActions.push(...cancelInsertModeActions('apply-changes'))
          }

          if (updatedSelection.length === 0) {
            // then we set the selected views for the editor state, 1 frame later
            editorActions.push(clearSelection(), setFocusedElement(null))
          } else {
            editorActions.push(selectComponents(updatedSelection, event.shiftKey))
          }
        }
      }
      dispatch(editorActions)
    },
    [
      dispatch,
      selectedViewsRef,
      findValidTarget,
      setSelectedViewsForCanvasControlsOnly,
      getSelectableViewsForSelectMode,
      editorStoreRef,
      draggingAllowed,
      windowToCanvasCoordinates,
      active,
    ],
  )

  const onMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => mouseHandler(event),
    [mouseHandler],
  )

  const onMouseUp = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => mouseHandler(event),
    [mouseHandler],
  )

  return { onMouseMove, onMouseDown, onMouseUp }
}

export function useSelectAndHover(
  cmdPressed: boolean,
  setSelectedViewsForCanvasControlsOnly: (newSelectedViews: ElementPath[]) => void,
): {
  onMouseMove: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseDown: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
  onMouseUp: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
} {
  const modeType = useEditorState(
    Substores.restOfEditor,
    (store) => store.editor.mode.type,
    'useSelectAndHover mode',
  )
  const isZoomMode = useEditorState(
    Substores.restOfEditor,
    (store) => store.editor.keysPressed['z'] ?? false,
    'useSelectAndHover isZoomMode',
  )
  const hasInteractionSession = useEditorState(
    Substores.canvas,
    (store) => store.editor.canvas.interactionSession != null,
    'useSelectAndHover hasInteractionSession',
  )
  const selectModeCallbacks = useSelectOrLiveModeSelectAndHover(
    (modeType === 'select' || modeType === 'live') && !isZoomMode,
    (modeType === 'select' || modeType === 'live') && !isZoomMode,
    cmdPressed,
    setSelectedViewsForCanvasControlsOnly,
  )
  const insertModeCallbacks = useInsertModeSelectAndHover(modeType === 'insert', cmdPressed)
  const textEditModeCallbacks = useTextEditModeSelectAndHover(modeType === 'textEdit')

  if (hasInteractionSession) {
    return {
      onMouseMove: selectModeCallbacks.onMouseMove,
      onMouseDown: Utils.NO_OP,
      onMouseUp: selectModeCallbacks.onMouseUp,
    }
  } else {
    switch (modeType) {
      case 'select':
        return selectModeCallbacks
      case 'insert':
        return insertModeCallbacks
      case 'live':
        return selectModeCallbacks
      case 'textEdit':
        return textEditModeCallbacks
      default:
        const _exhaustiveCheck: never = modeType
        throw new Error(`Unhandled editor mode ${JSON.stringify(modeType)}`)
    }
  }
}

export function useClearKeyboardInteraction(editorStoreRef: {
  readonly current: EditorStorePatched
}) {
  const dispatch = useDispatch()
  const keyboardTimeoutHandler = React.useRef<NodeJS.Timeout | null>(null)
  return React.useCallback(() => {
    if (keyboardTimeoutHandler.current != null) {
      clearTimeout(keyboardTimeoutHandler.current)
      keyboardTimeoutHandler.current = null
    }

    const clearKeyboardInteraction = () => {
      window.removeEventListener('mousedown', clearKeyboardInteraction)
      if (keyboardTimeoutHandler.current != null) {
        clearTimeout(keyboardTimeoutHandler.current)
        keyboardTimeoutHandler.current = null
      }
      if (
        editorStoreRef.current.editor.canvas.interactionSession?.interactionData.type === 'KEYBOARD'
      ) {
        dispatch([CanvasActions.clearInteractionSession(true)], 'everyone')
      }
    }

    keyboardTimeoutHandler.current = setTimeout(
      clearKeyboardInteraction,
      KeyboardInteractionTimeout,
    )

    window.addEventListener('mousedown', clearKeyboardInteraction, { once: true, capture: true })
  }, [dispatch, editorStoreRef])
}
