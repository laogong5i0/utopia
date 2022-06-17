import { createEditorState } from '../../editor/store/editor-state'
import { NO_OP } from '../../../core/shared/utils'
import { CSSCursor } from '../canvas-types'
import { foldAndApplyCommands } from './commands'
import { setCursorCommand } from './set-cursor-command'

describe('foldAndApplyCommands', () => {
  it('should accumulate commands that are permanent', () => {
    const editorState = createEditorState(NO_OP)
    const result = foldAndApplyCommands(
      editorState,
      editorState,
      [],
      [setCursorCommand('permanent', CSSCursor.Move)],
      [],
      'permanent',
    )
    expect(result.accumulatedPatches).toMatchInlineSnapshot(`
      Array [
        Object {
          "canvas": Object {
            "cursor": Object {
              "$set": "-webkit-image-set( url( '/editor/cursors/cursor-moving.png ') 1x, url( '/editor/cursors/cursor-moving@2x.png ') 2x ) 4 4, default",
            },
          },
        },
      ]
    `)
  })
  it('should not accumulate commands that are transient', () => {
    const editorState = createEditorState(NO_OP)
    const result = foldAndApplyCommands(
      editorState,
      editorState,
      [],
      [setCursorCommand('transient', CSSCursor.Move)],
      [],
      'permanent',
    )
    expect(result.accumulatedPatches).toMatchInlineSnapshot(`Array []`)
  })
})
