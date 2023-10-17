import {
  BakedInStoryboardUID,
  BakedInStoryboardVariableName,
} from '../../../../../core/model/scene-utils'
import type {
  LocalRectangle,
  MaybeInfinityLocalRectangle,
  MaybeInfinityRectangle,
} from '../../../../../core/shared/math-utils'
import { canvasRectangle, localRectangle } from '../../../../../core/shared/math-utils'
import {
  filtered,
  fromField,
  traverseArray,
} from '../../../../../core/shared/optics/optic-creators'
import { forEachOf, toArrayOf } from '../../../../../core/shared/optics/optic-utilities'
import type { EditorRenderResult } from '../../../../canvas/ui-jsx.test-utils'
import {
  TestAppUID,
  TestSceneUID,
  formatTestProjectCode,
  getPrintedUiJsCode,
  getPrintedUiJsCodeWithoutUIDs,
  renderTestEditorWithCode,
} from '../../../../canvas/ui-jsx.test-utils'
import * as EP from '../../../../../core/shared/element-path'
import { selectComponentsForTest } from '../../../../../utils/utils.test-utils'
import { RegisteredCanvasStrategies } from '../../../../canvas/canvas-strategies/canvas-strategies'
import { act, fireEvent } from '@testing-library/react'
import { mouseClickAtPoint } from '../../../../canvas/event-helpers.test-utils'
import { getDomRectCenter } from '../../../../../core/shared/dom-utils'

async function updateInputValue(
  renderResult: EditorRenderResult,
  controlToUpdateTestID: string,
  newValue: string,
): Promise<void> {
  const controlToUpdate = renderResult.renderedDOM.getByTestId(controlToUpdateTestID)
  const controlToUpdateBounds = controlToUpdate.getBoundingClientRect()
  await act(async () => {
    await mouseClickAtPoint(controlToUpdate, getDomRectCenter(controlToUpdateBounds))
    fireEvent.change(controlToUpdate, { target: { value: newValue } })
    fireEvent.blur(controlToUpdate)
  })
}

function makeTestProjectCode(componentInnards: string): string {
  const code = `
  import * as React from 'react'
  import { Scene, Storyboard, View, Group, Rectangle } from 'utopia-api'


  export var App = (props) => {
    return (
      ${componentInnards}
    )
  }

  export var ${BakedInStoryboardVariableName} = (props) => {
    return (
      <Storyboard data-uid='${BakedInStoryboardUID}'>
        <Scene
          style={{ left: 0, top: 0, width: 400, height: 400 }}
          data-uid='${TestSceneUID}'
        >
          <App
            data-uid='${TestAppUID}'
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, top: 0 }}
          />
        </Scene>
      </Storyboard>
    )
  }
`
  return formatTestProjectCode(code)
}

function makeTestProjectCodeWithoutUIDs(componentInnards: string): string {
  const code = `
  import * as React from 'react'
  import { Scene, Storyboard, View, Group, Rectangle } from 'utopia-api'


  export var App = (props) => {
    return (
      ${componentInnards}
    )
  }

  export var ${BakedInStoryboardVariableName} = (props) => {
    return (
      <Storyboard>
        <Scene
          style={{ left: 0, top: 0, width: 400, height: 400 }}
        >
          <App
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, top: 0 }}
          />
        </Scene>
      </Storyboard>
    )
  }
`
  return formatTestProjectCode(code)
}

interface TestCase {
  controlTested: string
  projectContext: string
  changeApplied: string
  baseProject: string
  actionChange: (renderResult: EditorRenderResult) => Promise<void>
  expectedFrames: { [key: string]: MaybeInfinityLocalRectangle | null }
  expectedProject: string
}

const testCases: Array<TestCase> = [
  {
    controlTested: 'Left',
    projectContext: 'single element selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the left field.
      await updateInputValue(renderResult, `frame-left-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 110,
          y: 100,
          width: 200,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 110,
          top: 100,
          width: 200,
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Left',
    projectContext: 'single element with percentage value selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: '25%',
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the left field.
      await updateInputValue(renderResult, `frame-left-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 110,
          y: 100,
          width: 200,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: '13.75%',
          top: 100,
          width: 200,
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Left',
    projectContext: 'multiple elements selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 25,
          height: 35,
        }}
        data-uid={'rectangle-2'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`),
      ])

      // Change the left field.
      await updateInputValue(renderResult, `frame-left-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 110,
          y: 100,
          width: 200,
          height: 300,
        }),
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`]:
        localRectangle({
          x: 110,
          y: 300,
          width: 25,
          height: 35,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 110,
          top: 100,
          width: 200,
          height: 300,
        }}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 110,
          top: 300,
          width: 25,
          height: 35,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Top',
    projectContext: 'single element selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the top field.
      await updateInputValue(renderResult, `frame-top-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 110,
          width: 200,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 110,
          width: 200,
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Top',
    projectContext: 'single element with percentage value selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: '25%',
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the top field.
      await updateInputValue(renderResult, `frame-top-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 110,
          width: 200,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: '12.22%',
          width: 200,
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Top',
    projectContext: 'multiple elements selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 25,
          height: 35,
        }}
        data-uid={'rectangle-2'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`),
      ])

      // Change the top field.
      await updateInputValue(renderResult, `frame-top-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 110,
          width: 200,
          height: 300,
        }),
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`]:
        localRectangle({
          x: 400,
          y: 110,
          width: 25,
          height: 35,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 110,
          width: 200,
          height: 300,
        }}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 110,
          width: 25,
          height: 35,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Width',
    projectContext: 'single element selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the width field.
      await updateInputValue(renderResult, `frame-width-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 110,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 110,
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Width',
    projectContext: 'single element with percentage value selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: '25%',
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the width field.
      await updateInputValue(renderResult, `frame-width-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 110,
          height: 300,
        }),
    },
    expectedProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: '13.75%',
          height: 300,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Width',
    projectContext: 'multiple elements selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 25,
          height: 35,
        }}
        data-uid={'rectangle-2'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`),
      ])

      // Change the width field.
      await updateInputValue(renderResult, `frame-width-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 110,
          height: 300,
        }),
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`]:
        localRectangle({
          x: 400,
          y: 300,
          width: 110,
          height: 35,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 110,
          height: 300,
        }}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 110,
          height: 35,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Height',
    projectContext: 'single element selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the height field.
      await updateInputValue(renderResult, `frame-height-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 200,
          height: 110,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 110,
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Height',
    projectContext: 'single element with percentage value selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: '25%',
        }}
        data-uid={'rectangle-1'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
      ])

      // Change the height field.
      await updateInputValue(renderResult, `frame-height-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 200,
          height: 110,
        }),
    },
    expectedProject: `<div
      style={{
        position: 'absolute',
        height: 900,
        width: 800,
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: '12.22%',
        }}
      />
    </div>`,
  },
  {
    controlTested: 'Height',
    projectContext: 'multiple elements selected',
    changeApplied: 'setting value directly',
    baseProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
      data-uid={'root-div'}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 300,
        }}
        data-uid={'rectangle-1'}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 25,
          height: 35,
        }}
        data-uid={'rectangle-2'}
      />
    </div>`,
    actionChange: async (renderResult) => {
      // Select the rectangle.
      await selectComponentsForTest(renderResult, [
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`),
        EP.fromString(`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`),
      ])

      // Change the height field.
      await updateInputValue(renderResult, `frame-height-number-input`, '110')
    },
    expectedFrames: {
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-1`]:
        localRectangle({
          x: 90,
          y: 100,
          width: 200,
          height: 110,
        }),
      [`${BakedInStoryboardUID}/${TestSceneUID}/${TestAppUID}:root-div/rectangle-2`]:
        localRectangle({
          x: 400,
          y: 300,
          width: 25,
          height: 110,
        }),
    },
    expectedProject: `<div
      style={{
        height: '100%',
        width: '100%',
        contain: 'layout',
      }}
    >
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 90,
          top: 100,
          width: 200,
          height: 110,
        }}
      />
      <Rectangle
        style={{
          backgroundColor: '#FF69B4AB',
          position: 'absolute',
          left: 400,
          top: 300,
          width: 25,
          height: 110,
        }}
      />
    </div>`,
  },
]

const controlsTested = new Set(
  toArrayOf(traverseArray<TestCase>().compose(fromField('controlTested')), testCases),
)

describe('Frame updating layout section', () => {
  controlsTested.forEach((controlTested) => {
    it(`${controlTested} control`, () => {
      const filterOptic = traverseArray<TestCase>().compose(
        filtered((testCase) => {
          return testCase.controlTested === controlTested
        }),
      )
      forEachOf(filterOptic, testCases, (testCase) => {
        it(`with a ${testCase.projectContext} when ${testCase.changeApplied}`, async () => {
          const editor = await renderTestEditorWithCode(
            makeTestProjectCode(testCase.baseProject),
            'await-first-dom-report',
            RegisteredCanvasStrategies,
            { 'Simplified Layout Section': true },
          )

          await testCase.actionChange(editor)
          await editor.getDispatchFollowUpActionsFinished()

          // Check the expected frames.
          const metadataMap = editor.getEditorState().editor.jsxMetadata
          for (const [path, expectedFrame] of Object.entries(testCase.expectedFrames)) {
            const metadataForElement = metadataMap[path]
            expect(metadataForElement).not.toBeNull()
            expect(metadataForElement).not.toBeUndefined()
            const actualLocalFrame = metadataForElement.localFrame
            expect(actualLocalFrame).toEqual(expectedFrame)
          }

          // Check the expected code.
          expect(
            formatTestProjectCode(getPrintedUiJsCodeWithoutUIDs(editor.getEditorState())),
          ).toEqual(makeTestProjectCodeWithoutUIDs(testCase.expectedProject))
        })
      })
    })
  })
})