import { PERFORMANCE_MARKS_ALLOWED, PRODUCTION_ENV } from '../../../common/env-vars'
import { isParseSuccess, isTextFile } from '../../../core/shared/project-file-types'
import {
  codeNeedsParsing,
  codeNeedsPrinting,
} from '../../../core/workers/common/project-file-utils'
import type {
  ParseOrPrint,
  ParseOrPrintResult,
  UtopiaTsWorkers,
} from '../../../core/workers/common/worker-types'
import {
  createParseFile,
  createPrintAndReparseFile,
  getParseResult,
} from '../../../core/workers/common/worker-types'
import { runLocalCanvasAction } from '../../../templates/editor-canvas'
import { runLocalNavigatorAction } from '../../../templates/editor-navigator'
import { optionalDeepFreeze } from '../../../utils/deep-freeze'
import type { CanvasAction } from '../../canvas/canvas-types'
import type { LocalNavigatorAction } from '../../navigator/actions'
import { PreviewIframeId, projectContentsUpdateMessage } from '../../preview/preview-pane'
import type { EditorAction, EditorDispatch } from '../action-types'
import { isLoggedIn } from '../action-types'
import {
  isTransientAction,
  isUndoOrRedo,
  isFromVSCode,
  checkAnyWorkerUpdates,
  onlyActionIsWorkerParsedUpdate,
  simpleStringifyActions,
} from '../actions/action-utils'
import * as EditorActions from '../actions/action-creators'
import * as History from '../history'
import type { StateHistory } from '../history'
import { saveStoredState } from '../stored-state'
import type {
  DerivedState,
  EditorState,
  EditorStoreFull,
  EditorStoreUnpatched,
} from './editor-state'
import {
  deriveState,
  persistentModelFromEditorModel,
  reconstructJSXMetadata,
  storedEditorStateFromEditorState,
} from './editor-state'
import {
  gatedActions,
  runClearPostActionSession,
  runExecuteStartPostActionMenuAction,
  runExecuteWithPostActionMenuAction,
  runLocalEditorAction,
  runUpdateProjectServerState,
} from './editor-update'
import { fastForEach, isBrowserEnvironment } from '../../../core/shared/utils'
import type { UiJsxCanvasContextData } from '../../canvas/ui-jsx-canvas'
import type { ProjectContentTreeRoot } from '../../assets'
import { treeToContents, walkContentsTree } from '../../assets'
import { isSendPreviewModel, restoreDerivedState, UPDATE_FNS } from '../actions/actions'
import { getTransitiveReverseDependencies } from '../../../core/shared/project-contents-dependencies'
import {
  reduxDevtoolsSendActions,
  reduxDevtoolsUpdateState,
} from '../../../core/shared/redux-devtools'
import { isEmptyObject, pick } from '../../../core/shared/object-utils'
import type { ProjectChanges } from './vscode-changes'
import {
  emptyProjectChanges,
  combineProjectChanges,
  getProjectChanges,
  sendVSCodeChanges,
} from './vscode-changes'
import { isFeatureEnabled } from '../../../utils/feature-switches'
import { handleStrategies, updatePostActionState } from './dispatch-strategies'

import { emptySet } from '../../../core/shared/set-utils'
import type { MetaCanvasStrategy } from '../../canvas/canvas-strategies/canvas-strategies'
import { RegisteredCanvasStrategies } from '../../canvas/canvas-strategies/canvas-strategies'
import { arrayOfPathsEqual, removePathsWithDeadUIDs } from '../../../core/shared/element-path'
import { notice } from '../../../components/common/notice'
import { getAllUniqueUids } from '../../../core/model/get-unique-ids'
import { updateSimpleLocks } from '../../../core/shared/element-locking'
import {
  getFilesToUpdate,
  parseResultToWorkerUpdates,
} from '../../../core/shared/parser-projectcontents-utils'
import { unpatchedCreateRemixDerivedDataMemo } from './remix-derived-data'
import { maybeClearPseudoInsertMode } from '../canvas-toolbar-states'
import { isSteganographyEnabled } from '../../../core/shared/stegano-text'
import { updateCollaborativeProjectContents } from './collaborative-editing'
import { updateProjectServerStateInStore } from './project-server-state'
import { ensureSceneIdsExist } from '../../../core/model/scene-id-utils'

type DispatchResultFields = {
  nothingChanged: boolean
  entireUpdateFinished: Promise<any>
}

export type DispatchResult = EditorStoreFull & DispatchResultFields

const cannotUndoRedoToastId = 'cannot-undo-or-redo'

function processAction(
  dispatchEvent: EditorDispatch,
  editorStoreUnpatched: EditorStoreUnpatched,
  action: EditorAction,
  spyCollector: UiJsxCanvasContextData,
): EditorStoreUnpatched {
  return gatedActions(
    action,
    editorStoreUnpatched.userState.loginState,
    editorStoreUnpatched.projectServerState,
    editorStoreUnpatched.unpatchedEditor,
    editorStoreUnpatched,
    () => {
      let working = editorStoreUnpatched
      // Sidestep around the local actions so that we definitely run them locally.
      if (action.action === 'TRANSIENT_ACTIONS') {
        // Drill into the array.
        return processActions(dispatchEvent, working, action.transientActions, spyCollector)
      } else if (action.action === 'ATOMIC' || action.action === 'MERGE_WITH_PREV_UNDO') {
        // Drill into the array.
        return processActions(dispatchEvent, working, action.actions, spyCollector)
      } else if (action.action === 'UNDO' && !History.canUndo(working.history)) {
        // Bail early and make no changes.
        return processActions(
          dispatchEvent,
          working,
          [
            EditorActions.addToast(
              notice(
                `Can't undo, reached the end of the undo history.`,
                'NOTICE',
                false,
                cannotUndoRedoToastId,
              ),
            ),
          ],
          spyCollector,
        )
      } else if (action.action === 'REDO' && !History.canRedo(working.history)) {
        // Bail early and make no changes.
        return processActions(
          dispatchEvent,
          working,
          [
            EditorActions.addToast(
              notice(
                `Can't redo, reached the end of the undo history.`,
                'NOTICE',
                false,
                cannotUndoRedoToastId,
              ),
            ),
          ],
          spyCollector,
        )
      } else if (action.action === 'SET_SHORTCUT') {
        return {
          ...working,
          userState: UPDATE_FNS.SET_SHORTCUT(action, working.userState),
        }
      } else if (action.action === 'SET_CURRENT_THEME') {
        return {
          ...working,
          userState: UPDATE_FNS.SET_CURRENT_THEME(action, working.userState),
        }
      } else if (action.action === 'SET_LOGIN_STATE') {
        return {
          ...working,
          userState: UPDATE_FNS.SET_LOGIN_STATE(action, working.userState),
        }
      } else if (action.action === 'SET_GITHUB_STATE') {
        return {
          ...working,
          userState: UPDATE_FNS.SET_GITHUB_STATE(action, working.userState),
        }
      } else if (action.action === 'SET_USER_CONFIGURATION') {
        return {
          ...working,
          userState: UPDATE_FNS.SET_USER_CONFIGURATION(action, working.userState),
        }
      }

      if (action.action === 'UPDATE_TEXT') {
        working = UPDATE_FNS.UPDATE_TEXT(action, working)
      }

      if (action.action === 'TRUNCATE_HISTORY') {
        working = UPDATE_FNS.TRUNCATE_HISTORY(working)
      }

      if (action.action === 'START_POST_ACTION_SESSION') {
        working = runExecuteStartPostActionMenuAction(action, working)
      }

      if (action.action === 'EXECUTE_POST_ACTION_MENU_CHOICE') {
        working = runExecuteWithPostActionMenuAction(action, working)
      }

      if (action.action === 'CLEAR_POST_ACTION_SESSION') {
        working = runClearPostActionSession(working)
      }

      if (action.action === 'UPDATE_PROJECT_SERVER_STATE') {
        working = runUpdateProjectServerState(working, action)
      }

      // Process action on the JS side.
      const editorAfterUpdateFunction = runLocalEditorAction(
        working.unpatchedEditor,
        working.unpatchedDerived,
        working.userState,
        working.workers,
        action as EditorAction,
        working.history,
        dispatchEvent,
        spyCollector,
        working.builtInDependencies,
        working.collaborativeEditingSupport,
        working.projectServerState,
      )
      const editorAfterCanvas = runLocalCanvasAction(
        dispatchEvent,
        editorAfterUpdateFunction,
        working.unpatchedDerived,
        working.builtInDependencies,
        action as CanvasAction,
      )
      const editorAfterNavigator = runLocalNavigatorAction(
        editorAfterCanvas,
        working.unpatchedDerived,
        action as LocalNavigatorAction,
      )
      const withPossiblyClearedPseudoInsert = maybeClearPseudoInsertMode(
        editorStoreUnpatched.unpatchedEditor,
        editorAfterNavigator,
        action,
      )

      let newStateHistory: StateHistory
      switch (action.action) {
        case 'UNDO':
          newStateHistory = History.undo(
            working.unpatchedEditor.id,
            working.history,
            'no-side-effects',
          )
          working.postActionInteractionSession = null
          break
        case 'REDO':
          newStateHistory = History.redo(
            working.unpatchedEditor.id,
            working.history,
            'no-side-effects',
          )
          break
        case 'NEW':
        case 'LOAD':
          const derivedState = deriveState(
            withPossiblyClearedPseudoInsert,
            null,
            'unpatched',
            unpatchedCreateRemixDerivedDataMemo,
          )
          newStateHistory = History.init(withPossiblyClearedPseudoInsert, derivedState)
          break
        default:
          newStateHistory = working.history
          break
      }

      return {
        unpatchedEditor: withPossiblyClearedPseudoInsert,
        unpatchedDerived: working.unpatchedDerived,
        strategyState: working.strategyState, // this means the actions cannot update strategyState – this piece of state lives outside our "redux" state
        postActionInteractionSession: working.postActionInteractionSession,
        history: newStateHistory,
        userState: working.userState,
        workers: working.workers,
        persistence: working.persistence,
        saveCountThisSession: working.saveCountThisSession,
        builtInDependencies: working.builtInDependencies,
        projectServerState: working.projectServerState,
        collaborativeEditingSupport: working.collaborativeEditingSupport,
      }
    },
  )
}

function processActions(
  dispatchEvent: EditorDispatch,
  working: EditorStoreUnpatched,
  actions: Array<EditorAction>,
  spyCollector: UiJsxCanvasContextData,
): EditorStoreUnpatched {
  return actions.reduce((workingFuture: EditorStoreUnpatched, action: EditorAction) => {
    return processAction(dispatchEvent, workingFuture, action, spyCollector)
  }, working)
}

export function updateEmbeddedPreview(
  modelId: string | null,
  projectContents: ProjectContentTreeRoot,
): void {
  const embeddedPreviewElement = document.getElementById(PreviewIframeId)
  if (embeddedPreviewElement != null) {
    const embeddedPreviewIframe = embeddedPreviewElement as any as HTMLIFrameElement
    const contentWindow = embeddedPreviewIframe.contentWindow
    if (contentWindow != null) {
      try {
        contentWindow.postMessage(projectContentsUpdateMessage(projectContents), '*')
      } catch (exception) {
        // Don't nuke the editor if there's an exception posting the message.
        // This can happen if a value can't be cloned when posted.
        console.error('Error updating preview.', exception)
      }
    }
  }
}

function maybeRequestModelUpdate(
  projectContents: ProjectContentTreeRoot,
  workers: UtopiaTsWorkers,
  forceParseFiles: Array<string>,
  dispatch: EditorDispatch,
): {
  modelUpdateRequested: boolean
  parseOrPrintFinished: Promise<boolean>
  forciblyParsedFiles: Array<string>
} {
  // Get the files to update that need sending over to the worker.
  const { filesToUpdate, forciblyParsedFiles, existingUIDs } = getFilesToUpdate(
    projectContents,
    forceParseFiles,
  )

  // Should anything need to be sent across, do so here.
  if (filesToUpdate.length > 0) {
    const parseFinished = getParseResult(
      workers,
      filesToUpdate,
      existingUIDs,
      isSteganographyEnabled(),
    )
      .then((parseResult) => {
        const updates = parseResult.map((fileResult) => {
          return parseResultToWorkerUpdates(fileResult)
        })

        dispatch([EditorActions.mergeWithPrevUndo([EditorActions.updateFromWorker(updates)])])
        return true
      })
      .catch((e) => {
        console.error('error during parse', e)
        dispatch([EditorActions.clearParseOrPrintInFlight()])
        return true
      })
    return {
      modelUpdateRequested: true,
      parseOrPrintFinished: parseFinished,
      forciblyParsedFiles: forciblyParsedFiles,
    }
  } else {
    return {
      modelUpdateRequested: false,
      parseOrPrintFinished: Promise.resolve(true),
      forciblyParsedFiles: forciblyParsedFiles,
    }
  }
}

function maybeRequestModelUpdateOnEditor(
  editor: EditorState,
  workers: UtopiaTsWorkers,
  dispatch: EditorDispatch,
): { editorState: EditorState; modelUpdateFinished: Promise<boolean> } {
  if (editor.parseOrPrintInFlight) {
    // Prevent repeated requests
    return { editorState: editor, modelUpdateFinished: Promise.resolve(true) }
  } else {
    const modelUpdateRequested = maybeRequestModelUpdate(
      editor.projectContents,
      workers,
      editor.forceParseFiles,
      dispatch,
    )

    const remainingForceParseFiles = editor.forceParseFiles.filter(
      (filePath) => !modelUpdateRequested.forciblyParsedFiles.includes(filePath),
    )
    return {
      editorState: {
        ...editor,
        parseOrPrintInFlight: modelUpdateRequested.modelUpdateRequested,
        forceParseFiles: remainingForceParseFiles,
      },
      modelUpdateFinished: modelUpdateRequested.parseOrPrintFinished,
    }
  }
}

let accumulatedProjectChanges: ProjectChanges = emptyProjectChanges

export function resetDispatchGlobals(): void {
  accumulatedProjectChanges = emptyProjectChanges
}

// With this reducer we can split the actions into groups (arrays) which can be dispatched together without rebuilding the derived state.
// Between the different group derived state rebuild is needed
function reducerToSplitToActionGroups(
  actionGroups: EditorAction[][],
  currentAction: EditorAction,
  i: number,
  actions: readonly EditorAction[],
): EditorAction[][] {
  if (currentAction.action === `TRANSIENT_ACTIONS`) {
    // if this is a transient action we need to split its sub-actions into groups which can be dispatched together
    const transientActionGroups = currentAction.transientActions.reduce(
      reducerToSplitToActionGroups,
      [[]],
    )
    const wrappedTransientActionGroups = transientActionGroups.map((actionGroup) => [
      EditorActions.transientActions(actionGroup),
    ])
    return [...actionGroups, ...wrappedTransientActionGroups]
  } else if (i > 0 && actions[i - 1].action === 'CLEAR_INTERACTION_SESSION') {
    // CLEAR_INTERACTION_SESSION must be the last action for a given action group, so if the previous action was CLEAR_INTERACTION_SESSION,
    // then we need to start a new action group
    return [...actionGroups, [currentAction]]
  } else {
    // if this action does not need a rebuilt derived state we can just push it into the last action group to dispatch them together
    let updatedGroups = actionGroups
    updatedGroups[actionGroups.length - 1].push(currentAction)
    return updatedGroups
  }
}

export function editorDispatchActionRunner(
  boundDispatch: EditorDispatch,
  dispatchedActions: readonly EditorAction[],
  storedState: EditorStoreFull,
  spyCollector: UiJsxCanvasContextData,
  strategiesToUse: Array<MetaCanvasStrategy> = RegisteredCanvasStrategies, // only override this for tests
): DispatchResult {
  const actionGroupsToProcess = dispatchedActions.reduce(reducerToSplitToActionGroups, [[]])

  const result: DispatchResult = actionGroupsToProcess.reduce(
    (working: DispatchResult, actions) => {
      const newStore = editorDispatchInner(
        boundDispatch,
        actions,
        working,
        spyCollector,
        strategiesToUse,
      )
      return newStore
    },
    { ...storedState, entireUpdateFinished: Promise.resolve(true), nothingChanged: true },
  )
  // Gather up these values.
  const updatedFromVSCode = dispatchedActions.some(isFromVSCode)
  const parsedAfterCodeChanged = onlyActionIsWorkerParsedUpdate(dispatchedActions)
  const updatedFromVSCodeOrParsedAfterCodeChange = updatedFromVSCode || parsedAfterCodeChanged

  // Whatever changes the actions may have made to the model could result
  // in some caches needing clearing.
  const projectChanges = getProjectChanges(
    storedState.unpatchedEditor,
    result.unpatchedEditor,
    updatedFromVSCodeOrParsedAfterCodeChange,
  )
  applyProjectChangesToEditor(result.unpatchedEditor, projectChanges)

  return result
}

export function editorDispatchClosingOut(
  boundDispatch: EditorDispatch,
  dispatchedActions: readonly EditorAction[],
  storedState: EditorStoreFull,
  result: DispatchResult,
): DispatchResult {
  const actionGroupsToProcess = dispatchedActions.reduce(reducerToSplitToActionGroups, [[]])
  const isLoadAction = dispatchedActions.some((a) => a.action === 'LOAD')
  const nameUpdated = dispatchedActions.some(
    (action) => action.action === 'SET_PROJECT_NAME' || action.action === 'SET_PROJECT_ID',
  )
  const forceSave =
    nameUpdated ||
    dispatchedActions.some((action) => action.action === 'SAVE_CURRENT_FILE') ||
    dispatchedActions.some(
      (action) => action.action === 'UPDATE_FROM_CODE_EDITOR' && action.unsavedContent == null,
    )

  const allTransient = dispatchedActions.every(isTransientAction)
  const allMergeWithPrevUndo = dispatchedActions.every((a) => a.action === 'MERGE_WITH_PREV_UNDO')
  const anyFinishCheckpointTimer = dispatchedActions.some((action) => {
    return action.action === 'FINISH_CHECKPOINT_TIMER'
  })
  const anyWorkerUpdates = checkAnyWorkerUpdates(dispatchedActions)
  const anyUndoOrRedo = dispatchedActions.some(isUndoOrRedo)
  const anySendPreviewModel = dispatchedActions.some(isSendPreviewModel)

  // The FINISH_CHECKPOINT_TIMER action effectively overrides the case where nothing changed,
  // as it's likely that action on it's own didn't change anything, but the actions that paired with
  // START_CHECKPOINT_TIMER likely did.
  const transientOrNoChange = (allTransient || result.nothingChanged) && !anyFinishCheckpointTimer

  const unpatchedEditorState = result.unpatchedEditor
  const patchedEditorState = result.patchedEditor
  const newStrategyState = result.strategyState
  const patchedDerivedState = result.patchedDerived

  const editorFilteredForFiles = filterEditorForFiles(unpatchedEditorState)

  const frozenDerivedState = result.unpatchedDerived

  const editorWithModelChecked =
    !anyUndoOrRedo &&
    transientOrNoChange &&
    !anyWorkerUpdates &&
    !unpatchedEditorState.previousParseOrPrintSkipped
      ? { editorState: unpatchedEditorState, modelUpdateFinished: Promise.resolve(true) }
      : maybeRequestModelUpdateOnEditor(unpatchedEditorState, storedState.workers, boundDispatch)

  const frozenEditorState = editorWithModelChecked.editorState

  const saveCountThisSession = result.saveCountThisSession

  const isLoaded = editorFilteredForFiles.isLoaded

  // Permit saving if:
  // - The editor has initialised and loaded for the first time.
  //   AND
  // - The editor isn't loading a project.
  //   AND
  // - This is running in a browser (as opposed to a test environment).
  const canSave = isLoaded && !isLoadAction && isBrowserEnvironment
  const changesShouldTriggerSave = editorChangesShouldTriggerSave(
    storedState.unpatchedEditor,
    frozenEditorState,
  )
  // Should save in a regular unforced situation if:
  // - Changes have been made which necessitate a save.
  //   AND
  // - These conditions are met:
  //   - There are changes and they are not transient.
  //     OR
  //   - The action is either an undo or redo.
  //     OR
  //   - There are worker updates (which ordinarily are transient changes) and a prior save has been triggered.
  //     As we don't want the first worker updates to trigger a save, because those will have been triggered from a load.
  const shouldSaveIfNotForced =
    changesShouldTriggerSave &&
    (!transientOrNoChange || anyUndoOrRedo || (anyWorkerUpdates && saveCountThisSession > 0))
  // Should save if:
  // - It's possible for us to save.
  //   AND
  // - At least one of these is the case:
  //   - The save has been forced.
  //     OR
  //   - Save should happen in an unforced situation.
  const shouldSave = canSave && (forceSave || shouldSaveIfNotForced)

  // Include asset renames with the history.
  let assetRenames: Array<History.AssetRename> = []
  for (const action of dispatchedActions) {
    if (action.action === 'UPDATE_FILE_PATH') {
      assetRenames.push({
        filenameChangedFrom: action.oldPath,
        filenameChangedTo: action.newPath,
      })
    }
  }

  let newHistory: StateHistory
  if (allMergeWithPrevUndo) {
    newHistory = History.replaceLast(
      result.history,
      editorFilteredForFiles,
      frozenDerivedState,
      assetRenames,
    )
  } else if (transientOrNoChange || !shouldSave) {
    // If there's a selection change, incorporate it into the previous history step.
    if (
      arrayOfPathsEqual(
        storedState.unpatchedEditor.selectedViews,
        result.unpatchedEditor.selectedViews,
      )
    ) {
      newHistory = result.history
    } else {
      newHistory = History.replaceLastWithUpdate(result.history, (historyEditorState) => {
        return {
          ...historyEditorState,
          selectedViews: result.unpatchedEditor.selectedViews,
        }
      })
    }
  } else {
    newHistory = History.add(
      result.history,
      editorFilteredForFiles,
      frozenDerivedState,
      assetRenames,
    )
  }

  const finalStore: DispatchResult = {
    unpatchedEditor: frozenEditorState,
    patchedEditor: patchedEditorState,
    unpatchedDerived: frozenDerivedState,
    patchedDerived: patchedDerivedState,
    strategyState: optionalDeepFreeze(newStrategyState),
    history: newHistory,
    postActionInteractionSession: result.postActionInteractionSession,
    userState: result.userState,
    workers: storedState.workers,
    persistence: storedState.persistence,
    nothingChanged: result.nothingChanged,
    entireUpdateFinished: Promise.all([
      result.entireUpdateFinished,
      editorWithModelChecked.modelUpdateFinished,
    ]),
    saveCountThisSession: saveCountThisSession + (shouldSave ? 1 : 0),
    builtInDependencies: storedState.builtInDependencies,
    projectServerState: result.projectServerState,
    collaborativeEditingSupport: storedState.collaborativeEditingSupport,
  }

  reduxDevtoolsSendActions(actionGroupsToProcess, finalStore, allTransient)

  if (storedState.userState.loginState.type !== result.userState.loginState.type) {
    if (isLoggedIn(result.userState.loginState)) {
      storedState.persistence.login()
    } else {
      storedState.persistence.logout()
    }
  }

  if (shouldSave) {
    storedState.persistence.save(
      frozenEditorState.projectName,
      persistentModelFromEditorModel(frozenEditorState),
      forceSave ? 'force' : 'throttle',
    )
    const stateToStore = storedEditorStateFromEditorState(frozenEditorState)
    void saveStoredState(frozenEditorState.id, stateToStore)
    reduxDevtoolsUpdateState('Save Editor', finalStore)
  }

  const updatedFromVSCode = dispatchedActions.some(isFromVSCode)
  if (updatedFromVSCode && !dispatchedActions.every(isFromVSCode)) {
    console.error(
      `VS Code actions mixed with Utopia actions`,
      simpleStringifyActions(dispatchedActions),
    )
  }

  let finalStoreV1Final: DispatchResult = finalStore
  // If the action was a load action then we don't want to send across any changes
  if (!isLoadAction) {
    const parsedAfterCodeChanged = onlyActionIsWorkerParsedUpdate(dispatchedActions)

    // We don't want to send selection changes coming from updates triggered by changes made in the code editor
    const updatedFromVSCodeOrParsedAfterCodeChange = updatedFromVSCode || parsedAfterCodeChanged

    const projectChanges = getProjectChanges(
      storedState.unpatchedEditor,
      frozenEditorState,
      updatedFromVSCodeOrParsedAfterCodeChange,
    )
    applyProjectChangesToVSCode(frozenEditorState, projectChanges)
    if (
      finalStore.collaborativeEditingSupport.session != null &&
      finalStore.projectServerState.isMyProject === 'yes'
    ) {
      updateCollaborativeProjectContents(
        finalStore.collaborativeEditingSupport.session,
        projectChanges.fileChanges.collabProjectChanges,
        frozenEditorState.filesModifiedByAnotherUser,
      )
    }
    const filesChanged = projectChanges.fileChanges.collabProjectChanges.map((v) => v.fullPath)
    const updatedFilesModifiedByElsewhere = frozenEditorState.filesModifiedByAnotherUser.filter(
      (v) => !filesChanged.includes(v),
    )
    finalStoreV1Final = {
      ...finalStoreV1Final,
      unpatchedEditor: {
        ...finalStoreV1Final.unpatchedEditor,
        filesModifiedByAnotherUser: updatedFilesModifiedByElsewhere,
      },
    }
  }

  const shouldUpdatePreview =
    anySendPreviewModel ||
    frozenEditorState.projectContents !== storedState.unpatchedEditor.projectContents
  if (shouldUpdatePreview) {
    updateEmbeddedPreview(frozenEditorState.id, frozenEditorState.projectContents)
  }

  if (frozenEditorState.id != null && frozenEditorState.id != storedState.unpatchedEditor.id) {
    storedState.workers.initWatchdogWorker(frozenEditorState.id)
  }

  maybeCullElementPathCache(
    finalStoreV1Final.unpatchedEditor.projectContents,
    anyWorkerUpdates ? 'schedule-now' : 'dont-schedule',
  )

  return finalStoreV1Final
}

function editorChangesShouldTriggerSave(oldState: EditorState, newState: EditorState): boolean {
  return (
    // FIXME We should be ripping out the parsed models before comparing the project contents here
    oldState.projectContents !== newState.projectContents ||
    oldState.githubSettings !== newState.githubSettings ||
    oldState.branchOriginContents !== newState.branchOriginContents
  )
}

let cullElementPathCacheTimeoutId: number | undefined = undefined
const CullElementPathCacheTimeout = 1000
let lastProjectContents: ProjectContentTreeRoot = {}
export function setLastProjectContentsForTesting(projectContents: ProjectContentTreeRoot): void {
  lastProjectContents = projectContents
}

export function killElementPathCacheCallback(): void {
  if (cullElementPathCacheTimeoutId != null) {
    window.cancelIdleCallback(cullElementPathCacheTimeoutId)
  }
}

function maybeCullElementPathCache(
  projectContents: ProjectContentTreeRoot,
  scheduleOrNot: 'schedule-now' | 'dont-schedule',
) {
  lastProjectContents = projectContents
  if (scheduleOrNot === 'schedule-now') {
    // Updates from the worker indicate that paths might have changed, so schedule a
    // cache cull for the next time the browser is idle
    if (typeof window.requestIdleCallback !== 'undefined') {
      killElementPathCacheCallback()

      cullElementPathCacheTimeoutId = window.requestIdleCallback(cullElementPathCache)
    } else {
      clearTimeout(cullElementPathCacheTimeoutId)
      cullElementPathCacheTimeoutId = window.setTimeout(
        cullElementPathCache,
        CullElementPathCacheTimeout,
      )
    }
  }
}

export function cullElementPathCache(): void {
  const allExistingUids = getAllUniqueUids(lastProjectContents).allIDs
  removePathsWithDeadUIDs(new Set(allExistingUids))
}

function applyProjectChangesToVSCode(
  frozenEditorState: EditorState,
  projectChanges: ProjectChanges,
): void {
  accumulatedProjectChanges = combineProjectChanges(accumulatedProjectChanges, projectChanges)

  if (frozenEditorState.vscodeReady) {
    const changesToSend = accumulatedProjectChanges
    accumulatedProjectChanges = emptyProjectChanges
    sendVSCodeChanges(changesToSend)
  }
}

function applyProjectChangesToEditor(
  frozenEditorState: EditorState,
  projectChanges: ProjectChanges,
): void {
  const updatedFileNames = projectChanges.fileChanges.changesForVSCode.map(
    (fileChange) => fileChange.fullPath,
  )
  const updatedAndReverseDepFilenames = getTransitiveReverseDependencies(
    frozenEditorState.projectContents,
    frozenEditorState.nodeModules.files,
    updatedFileNames,
  )

  // Mutating the evaluation cache.
  for (const fileToDelete of updatedAndReverseDepFilenames) {
    delete frozenEditorState.codeResultCache.evaluationCache[fileToDelete]
  }
}

export const UTOPIA_IRRECOVERABLE_ERROR_MESSAGE = `Utopia has suffered from an irrecoverable error, please reload the editor.`
function editorDispatchInner(
  boundDispatch: EditorDispatch,
  dispatchedActions: EditorAction[],
  storedState: DispatchResult,
  spyCollector: UiJsxCanvasContextData,
  strategiesToUse: Array<MetaCanvasStrategy>,
): DispatchResult {
  // console.log('DISPATCH', simpleStringifyActions(dispatchedActions), dispatchedActions)

  const MeasureDispatchTime =
    (isFeatureEnabled('Debug – Performance Marks (Fast)') ||
      isFeatureEnabled('Debug – Performance Marks (Slow)')) &&
    PERFORMANCE_MARKS_ALLOWED

  if (MeasureDispatchTime) {
    window.performance.mark('dispatch_begin')
  }
  if (dispatchedActions.length > 0) {
    // Run everything in a big chain.
    let result = processActions(boundDispatch, storedState, dispatchedActions, spyCollector)
    result.unpatchedEditor = ensureSceneIdsExist(result.unpatchedEditor)

    const anyUndoOrRedo = dispatchedActions.some(isUndoOrRedo)

    if (MeasureDispatchTime) {
      window.performance.mark('derived_state_begin')
    }

    const editorStayedTheSame =
      storedState.nothingChanged &&
      storedState.unpatchedEditor === result.unpatchedEditor &&
      storedState.userState === result.userState &&
      storedState.projectServerState === result.projectServerState &&
      storedState.postActionInteractionSession === result.postActionInteractionSession

    const domMetadataChanged =
      storedState.unpatchedEditor.domMetadata !== result.unpatchedEditor.domMetadata
    const spyMetadataChanged =
      storedState.unpatchedEditor.spyMetadata !== result.unpatchedEditor.spyMetadata
    const allElementPropsChanged =
      storedState.unpatchedEditor.currentAllElementProps !==
      result.unpatchedEditor.currentAllElementProps

    const variablesInScopeChanged =
      storedState.unpatchedEditor.currentVariablesInScope !==
      result.unpatchedEditor.currentVariablesInScope

    const metadataChanged =
      domMetadataChanged || spyMetadataChanged || allElementPropsChanged || variablesInScopeChanged

    if (metadataChanged) {
      const { metadata, elementPathTree } = reconstructJSXMetadata(result.unpatchedEditor)
      // Cater for the strategies wiping out the metadata on completion.
      const storedStateHasEmptyElementPathTree = isEmptyObject(
        storedState.unpatchedEditor.elementPathTree,
      )
      const storedStateHasEmptyMetadata = isEmptyObject(storedState.unpatchedEditor.jsxMetadata)
      const doNotUpdateLocks = storedStateHasEmptyMetadata && !storedStateHasEmptyElementPathTree
      // Update the locks as appropriate.
      const priorSimpleLocks = storedState.unpatchedEditor.lockedElements.simpleLock
      const updatedSimpleLocks = doNotUpdateLocks
        ? priorSimpleLocks
        : updateSimpleLocks(
            storedState.unpatchedEditor.jsxMetadata,
            metadata,
            elementPathTree,
            priorSimpleLocks,
          )
      if (result.unpatchedEditor.canvas.interactionSession != null) {
        result = {
          ...result,
          unpatchedEditor: {
            ...result.unpatchedEditor,
            canvas: {
              ...result.unpatchedEditor.canvas,
              interactionSession: {
                ...result.unpatchedEditor.canvas.interactionSession,
                latestMetadata: metadata,
                latestAllElementProps: result.unpatchedEditor.currentAllElementProps,
                latestElementPathTree: elementPathTree,
                latestVariablesInScope: result.unpatchedEditor.currentVariablesInScope,
              },
            },
          },
        }
      } else {
        result = {
          ...result,
          unpatchedEditor: {
            ...result.unpatchedEditor,
            jsxMetadata: metadata,
            elementPathTree: elementPathTree,
            allElementProps: result.unpatchedEditor.currentAllElementProps,
            variablesInScope: result.unpatchedEditor.currentVariablesInScope,
            lockedElements: {
              ...result.unpatchedEditor.lockedElements,
              simpleLock: updatedSimpleLocks,
            },
          },
        }
      }
    }

    const actionNames = simpleStringifyActions(dispatchedActions)

    // Check for duplicate UIDs that have originated from actions being applied.
    const uniqueIDsResult = getAllUniqueUids(result.unpatchedEditor.projectContents)
    if (Object.keys(uniqueIDsResult.duplicateIDs).length > 0) {
      const errorMessage = `Running ${actionNames} resulted in duplicate UIDs ${JSON.stringify(
        uniqueIDsResult.duplicateIDs,
      )}.`
      //if (IS_TEST_ENVIRONMENT) {
      // In tests blow out with an exception so that the error is correctly attributed.
      //  throw new Error(errorMessage)
      //} else {
      // When running in the browser log the error and tell the user to restart the editor.
      console.error(errorMessage)
      const errorToast = EditorActions.addToast(
        notice(UTOPIA_IRRECOVERABLE_ERROR_MESSAGE, 'ERROR', true, 'reload-editor'),
      )
      result = {
        ...result,
        unpatchedEditor: UPDATE_FNS.ADD_TOAST(errorToast, result.unpatchedEditor),
      }
      //}
    }

    let frozenEditorState: EditorState = optionalDeepFreeze(result.unpatchedEditor)

    let frozenDerivedState: DerivedState
    if (anyUndoOrRedo) {
      frozenDerivedState = optionalDeepFreeze(restoreDerivedState(result.history))
      // TODO BB put inspector and navigator back to history
    } else if (editorStayedTheSame) {
      // !! We completely skip creating a new derived state, since the editor state stayed the exact same
      frozenDerivedState = storedState.unpatchedDerived
    } else {
      const derivedState = deriveState(
        frozenEditorState,
        storedState.unpatchedDerived,
        'unpatched',
        unpatchedCreateRemixDerivedDataMemo,
      )
      frozenDerivedState = optionalDeepFreeze(derivedState)
    }

    if (MeasureDispatchTime) {
      window.performance.mark('dispatch_end')
      window.performance.measure(
        `Momentum Dispatch: [${actionNames}]`,
        'dispatch_begin',
        'dispatch_end',
      )
      window.performance.measure(
        'Momentum Editor State Update',
        'dispatch_begin',
        'derived_state_begin',
      )
      window.performance.measure(
        'Momentum Editor Derived State',
        'derived_state_begin',
        'dispatch_end',
      )
    }

    const { unpatchedEditorState, patchedEditorState, newStrategyState, patchedDerivedState } =
      handleStrategies(
        strategiesToUse,
        dispatchedActions,
        storedState,
        result,
        storedState.patchedDerived,
      )

    return {
      unpatchedEditor: unpatchedEditorState,
      patchedEditor: patchedEditorState,
      unpatchedDerived: frozenDerivedState,
      patchedDerived: patchedDerivedState,
      strategyState: newStrategyState,
      postActionInteractionSession: updatePostActionState(
        result.postActionInteractionSession,
        dispatchedActions,
      ),
      history: result.history,
      userState: result.userState,
      workers: storedState.workers,
      persistence: storedState.persistence,
      nothingChanged: editorStayedTheSame,
      entireUpdateFinished: Promise.all([storedState.entireUpdateFinished]),
      saveCountThisSession: storedState.saveCountThisSession,
      builtInDependencies: storedState.builtInDependencies,
      projectServerState: result.projectServerState,
      collaborativeEditingSupport: result.collaborativeEditingSupport,
    }
  } else {
    //empty return
    return {
      ...storedState,
      nothingChanged: true,
    }
  }
}

function filterEditorForFiles(editor: EditorState) {
  // FIXME: Reimplement this in a way that doesn't require converting from `ProjectContents`.
  const projectContents = treeToContents(editor.projectContents)
  const allFiles = Object.keys(projectContents)
  return {
    ...editor,
    codeResultCache: {
      ...editor.codeResultCache,
      cache: pick(allFiles, editor.codeResultCache.cache),
    },
    codeEditorErrors: {
      buildErrors: pick(allFiles, editor.codeEditorErrors.buildErrors),
      lintErrors: pick(allFiles, editor.codeEditorErrors.lintErrors),
    },
  }
}
