import {
  getElementPathFromInsertionPath,
  InsertionPath,
  insertionPathToString,
} from '../../editor/store/insertion-path'
import {
  EditorState,
  EditorStatePatch,
  forUnderlyingTargetFromEditorState,
} from '../../../components/editor/store/editor-state'
import { getUtopiaJSXComponentsFromSuccess } from '../../../core/model/project-file-utils'
import { JSXElementChild } from '../../../core/shared/element-template'
import { Imports } from '../../../core/shared/project-file-types'
import { BaseCommand, CommandFunction, getPatchForComponentChange, WhenToRun } from './commands'
import { includeToastPatch } from '../../../components/editor/actions/toast-helpers'
import { IndexPosition } from '../../../utils/utils'
import { mergeImports } from '../../../core/workers/common/project-file-utils'
import { Spec } from 'immutability-helper'
import { insertJSXElementChildren } from '../../../core/model/element-template-utils'

export interface AddElements extends BaseCommand {
  type: 'ADD_ELEMENTS'
  parentPath: InsertionPath
  elements: Array<JSXElementChild>
  indexPosition?: IndexPosition
  importsToAdd?: Imports
}

export function addElements(
  whenToRun: WhenToRun,
  parentPath: InsertionPath,
  elements: Array<JSXElementChild>,
  options: Partial<{
    indexPosition: IndexPosition
    importsToAdd: Imports
  }> = {},
): AddElements {
  return {
    whenToRun: whenToRun,
    type: 'ADD_ELEMENTS',
    parentPath: parentPath,
    elements: elements,
    indexPosition: options.indexPosition,
    importsToAdd: options.importsToAdd,
  }
}

export const runAddElements: CommandFunction<AddElements> = (
  editorState: EditorState,
  command: AddElements,
) => {
  let editorStatePatches: Array<EditorStatePatch> = []
  forUnderlyingTargetFromEditorState(
    getElementPathFromInsertionPath(command.parentPath),
    editorState,
    (
      parentSuccess,
      _underlyingElementNewParent,
      _underlyingTargetNewParent,
      underlyingFilePathNewParent,
    ) => {
      const componentsNewParent = getUtopiaJSXComponentsFromSuccess(parentSuccess)

      const insertionResult = insertJSXElementChildren(
        editorState.projectContents,
        command.parentPath,
        command.elements,
        componentsNewParent,
        command.indexPosition ?? null,
      )
      const withElementsInserted = insertionResult.components

      const editorStatePatchNewParentFile = getPatchForComponentChange(
        parentSuccess.topLevelElements,
        withElementsInserted,
        mergeImports(
          underlyingFilePathNewParent,
          parentSuccess.imports,
          mergeImports(
            underlyingFilePathNewParent,
            insertionResult.importsToAdd,
            command.importsToAdd ?? {},
          ),
        ),
        underlyingFilePathNewParent,
      )

      const newElementPathsPatch: Spec<EditorState> = {
        canvas: {
          controls: {
            reparentedToPaths: {
              $push: insertionResult.insertedChildrenPaths,
            },
          },
        },
      }

      editorStatePatches = [
        editorStatePatchNewParentFile,
        includeToastPatch(insertionResult.insertionDetails, editorState),
        newElementPathsPatch,
      ]
    },
  )

  return {
    editorStatePatches: editorStatePatches,
    commandDescription: `Add Elements to ${insertionPathToString(command.parentPath)}`,
  }
}