import { within } from '@testing-library/react'
import * as EP from '../../../../core/shared/element-path'
import { selectComponentsForTest, wait } from '../../../../utils/utils.test-utils'
import { mouseClickAtPoint, pressKey } from '../../../canvas/event-helpers.test-utils'
import type { EditorRenderResult } from '../../../canvas/ui-jsx.test-utils'
import { renderTestEditorWithCode } from '../../../canvas/ui-jsx.test-utils'
import {
  DataPickerPopupButtonTestId,
  DataPickerPopupTestId,
  VariableFromScopeOptionTestId,
} from './component-section'

describe('Set element prop via the data picker', () => {
  it('can pick from the property data picker', async () => {
    const editor = await renderTestEditorWithCode(project, 'await-first-dom-report')
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/title')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const theScene = editor.renderedDOM.getByTestId('scene')
    const theInspector = editor.renderedDOM.getByTestId('inspector-sections-container')

    const options = getRenderedOptions(editor)

    // the items from the data picker are expected here, so that the numbers in `VariableFromScopeOptionTestId`
    // below are put in context
    expect(options).toEqual([
      'titleToo',
      'alternateTitle',
      'titles',
      'one',
      'also JS',
      'titleIdeas',
      'titleIdeas[0]',
    ])
    // choose a string-valued variable
    let currentOption = editor.renderedDOM.getByTestId(VariableFromScopeOptionTestId('0'))
    await mouseClickAtPoint(currentOption, { x: 2, y: 2 })
    expect(within(theScene).queryByText('Title too')).not.toBeNull()
    expect(within(theInspector).queryByText('Title too')).not.toBeNull()

    // choose another string-valued variable
    currentOption = editor.renderedDOM.getByTestId(VariableFromScopeOptionTestId('1'))
    await mouseClickAtPoint(currentOption, { x: 2, y: 2 })
    expect(within(theScene).queryByText('Alternate title')).not.toBeNull()
    expect(within(theInspector).queryByText('Alternate title')).not.toBeNull()

    // choose an object prop
    currentOption = editor.renderedDOM.getByTestId(VariableFromScopeOptionTestId('2-0'))
    await mouseClickAtPoint(currentOption, { x: 2, y: 2 })
    expect(within(theScene).queryByText('The First Title')).not.toBeNull()
    expect(within(theInspector).queryByText('The First Title')).not.toBeNull()

    // choose an object prop
    currentOption = editor.renderedDOM.getByTestId(VariableFromScopeOptionTestId('2-1'))
    await mouseClickAtPoint(currentOption, { x: 2, y: 2 })
    expect(within(theScene).queryByText('Sweet')).not.toBeNull()
    expect(within(theInspector).queryByText('Sweet')).not.toBeNull()

    // choose an array element
    currentOption = editor.renderedDOM.getByTestId(VariableFromScopeOptionTestId('3-0'))
    await mouseClickAtPoint(currentOption, { x: 2, y: 2 })
    expect(within(theScene).queryByText('Chapter One')).not.toBeNull()
    expect(within(theInspector).queryByText('Chapter One')).not.toBeNull()
  })

  it('with number input control descriptor present', async () => {
    const editor = await renderTestEditorWithCode(
      projectWithNumberInputControlDescription,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/counter')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'currentCount', // at the top because the number input control descriptor is present
      'titleToo', // because the current value of `count` is a string
      'titleIdeas', // doesn't match control descriptor, nor the shape of the prop value
      'titleIdeas[0]',
    ])
  })

  it('with array control descriptor present', async () => {
    const editor = await renderTestEditorWithCode(
      projectWithObjectsAndArrays,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/toc')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'titleIdeas', // the array is at the top because of the array descriptor
      'titleIdeas[0]', // <- array element
      'titleToo',
      'currentCount',
      'bookInfo',
      'title',
      'published',
      'description',
      'likes',
    ])
  })

  it('with object control descriptor present', async () => {
    const editor = await renderTestEditorWithCode(
      projectWithObjectsAndArrays,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/bd')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'bookInfo', // object is at the top because of the object descriptor
      'title', // <- object key
      'published', // <- object key
      'description', // <- object key
      'likes', // <- object key
      'titleToo',
      'currentCount',
      'titleIdeas',
      'titleIdeas[0]',
    ])
  })

  it("with another array matching the prop array's shape", async () => {
    const editor = await renderTestEditorWithCode(
      DataPickerProjectShell(`
      function TableOfContents({ titles }) {
        const content = 'Content'
      
        return (
          <>
            {titles.map((t) => (
              <h2 data-uid='a9c'>{t}</h2>
            ))}
          </>
        )
      }
      
      var Playground = () => {
        const titleToo = 'Title too'
        const currentCount = 12
        const authors = ['Jack London', 'Mary Shelley']
        const titleIdeas = ['Chapter One', 'Chapter Two']
      
        return (
          <div data-uid='root'>
            <TableOfContents titles={titleIdeas} data-uid='toc' />
          </div>
        )
      }`),
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/toc')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'authors', // at the top because it's an array of string, same as titleIdeas
      'authors[0]',
      'titleIdeas', // the original array of string
      'titleIdeas[0]',
      'titleToo',
      'currentCount',
    ])
  })

  it("with another object matching the prop object's shape", async () => {
    const editor = await renderTestEditorWithCode(
      DataPickerProjectShell(`
      function BookDetail({ book }) {
        const content = 'Content'
      
        return (
          <div data-uid='aak'>
            <h1 data-uid='aae'>{book.title}</h1>
            <code data-uid='aai'>{book.published}</code>
            <p data-uid='88b'>{book.description}</p>
            <p data-uid='a48'>Likes: {book.likes}</p>
          </div>
        )
      }
      
      var Playground = () => {
        const titleToo = 'Title too'
        const authors = { jack: "Jack London", mary: "Mary Shelley" }
      
        const bookInfo = {
          title: 'Moby Dick',
          published: 'August 1888',
          description: 'An oldie but goldie',
          likes: 33,
        }
      
        const alternateBookInfo = {
          title: 'Frankenstein',
          published: 'August 1866',
          description: 'Short, fun read',
          likes: 66,
        }
      
        return (
          <div data-uid='root'>
            <BookDetail book={bookInfo} data-uid='bd' />
          </div>
        )
      }`),
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/bd')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'bookInfo', // object with matching shape
      'title', // <- object key
      'published', // <- object key
      'description', // <- object key
      'likes', // <- object key
      'alternateBookInfo', // object with matching shape
      'title', // <- object key
      'published', // <- object key
      'description', // <- object key
      'likes', // <- object key
      'titleToo',
      'authors', // object with a shape that doesn't match
      'jack',
      'mary',
    ])
  })

  it('style props are filterd from `props`', async () => {
    const editor = await renderTestEditorWithCode(
      DataPickerProjectShell(`
      function TableOfContents({ titles }) {
        const content = 'Content'
      
        return (
          <>
            {titles.map((t) => (
              <h2 data-uid='a9c'>{t}</h2>
            ))}
          </>
        )
      }
      
      var Playground = (props) => {
        const titleToo = 'Title too'
        const currentCount = 12
        const authors = ['Jack London', 'Mary Shelley']
        const titleIdeas = ['Chapter One', 'Chapter Two']
      
        return (
          <div data-uid='root'>
            <TableOfContents titles={titleIdeas} data-uid='toc' />
          </div>
        )
      }`),
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/toc')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'authors',
      'authors[0]',
      'titleIdeas',
      'titleIdeas[0]',
      'props',
      'titleToo',
      'currentCount',
    ])
  })

  it('style props are filterd from destructured props', async () => {
    const editor = await renderTestEditorWithCode(
      DataPickerProjectShell(`
      function TableOfContents({ titles }) {
        const content = 'Content'
      
        return (
          <>
            {titles.map((t) => (
              <h2 data-uid='a9c'>{t}</h2>
            ))}
          </>
        )
      }
      
      var Playground = ({ style, className, css }) => {
        const titleToo = 'Title too'
        const currentCount = 12
        const authors = ['Jack London', 'Mary Shelley']
        const titleIdeas = ['Chapter One', 'Chapter Two']
      
        return (
          <div data-uid='root'>
            <TableOfContents titles={titleIdeas} data-uid='toc' />
          </div>
        )
      }`),
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/toc')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(DataPickerPopupButtonTestId)
    await mouseClickAtPoint(dataPickerOpenerButton, { x: 2, y: 2 })

    const dataPickerPopup = editor.renderedDOM.queryByTestId(DataPickerPopupTestId)
    expect(dataPickerPopup).not.toBeNull()

    const options = getRenderedOptions(editor)

    expect(options).toEqual([
      'authors',
      'authors[0]',
      'titleIdeas',
      'titleIdeas[0]',
      'titleToo',
      'currentCount',
    ])
  })
})

// comment out tests temporarily because it causes a dom-walker test to fail
// describe('Image preview for string control', () => {
//   it('shows image preview for urls with image extension', async () => {
//     const editor = await renderTestEditorWithCode(
//       projectWithImage(
//         'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVQIW2P8z8AARAwMjDAGACwBA/+8RVWvAAAAAElFTkSuQmCC',
//       ),
//       'await-first-dom-report',
//     )
//     await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/image')])

//     expect(editor.renderedDOM.queryAllByTestId(ImagePreviewTestId)).toHaveLength(1)
//   })
//   it('does not show image preview for urls without image extension', async () => {
//     const editor = await renderTestEditorWithCode(
//       projectWithImage('https://i.pinimg.com/474x/4d/79/99/4d7999a51a1a397189a6f98168bcde45'),
//       'await-first-dom-report',
//     )
//     await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/image')])

//     expect(editor.renderedDOM.queryAllByTestId(ImagePreviewTestId)).toHaveLength(0)
//   })
//   it('does not show image preview for non-urls', async () => {
//     const editor = await renderTestEditorWithCode(
//       projectWithImage('hello'),
//       'await-first-dom-report',
//     )
//     await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/image')])

//     expect(editor.renderedDOM.queryAllByTestId(ImagePreviewTestId)).toHaveLength(0)
//   })
// })

describe('Controls from registering components', () => {
  it('registering internal component', async () => {
    const editor = await renderTestEditorWithCode(
      registerInternalComponentProject,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/title')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(
      `text-string-input-property-control`,
    )
    dataPickerOpenerButton.focus()
    document.execCommand('insertText', false, 'New title')
    await pressKey('Enter', { targetElement: dataPickerOpenerButton })

    const theScene = editor.renderedDOM.getByTestId('scene')
    expect(within(theScene).queryByText('New title')).not.toBeNull()
  })

  it('registering internal component with html prop shows preview', async () => {
    const editor = await renderTestEditorWithCode(
      registerInternalComponentProjectWithHtmlProp,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/title')])

    const theInspector = editor.renderedDOM.getByTestId('inspector-sections-container')
    expect(within(theInspector).queryByText('Hello Utopia')).not.toBeNull()
  })

  it('registering external component', async () => {
    const editor = await renderTestEditorWithCode(
      registerExternalComponentProject,
      'await-first-dom-report',
    )
    await selectComponentsForTest(editor, [EP.fromString('sb/scene/pg:root/title')])

    const dataPickerOpenerButton = editor.renderedDOM.getByTestId(
      `sampleprop-string-input-property-control`,
    )
    dataPickerOpenerButton.focus()
    document.execCommand('insertText', false, 'New props value')
    await pressKey('Enter', { targetElement: dataPickerOpenerButton })

    const theView = editor.renderedDOM.getByTestId('view')
    expect(theView.outerHTML).toContain('sampleprop="New props value"')
  })
})

const project = DataPickerProjectShell(`
function Title({ text }) {
  const content = 'Content'

  return <h2 data-uid='0cd'>{text}</h2>
}

var Playground = ({ style }) => {
  const titleToo = 'Title too'

  const alternateTitle = 'Alternate title'

  const titles = {
    one: "The First Title",
    ['also JS']: 'Sweet',
  }

  const titleIdeas = [
    'Chapter One',
  ]

  return (
    <div style={style} data-uid='root'>
      <Title text='The Title' data-uid='title' />
    </div>
  )
}`)

const registerInternalComponentProject = `import * as React from 'react'
import {
  Storyboard,
  Scene,
  registerInternalComponent,
} from 'utopia-api'

function Title({ text }) {
  return <h2 data-uid='0cd'>{text}</h2>
}

var Playground = ({ style }) => {
  return (
    <div style={style} data-uid='root'>
      <Title text='Hello Utopia' data-uid='title' />
    </div>
  )
}

export var storyboard = (
  <Storyboard data-uid='sb'>
    <Scene
      style={{
        width: 521,
        height: 266,
        position: 'absolute',
        left: 554,
        top: 247,
        backgroundColor: 'white',
      }}
      data-uid='scene'
      data-testid='scene'
      commentId='120'
    >
      <Playground
        style={{
          width: 454,
          height: 177,
          position: 'absolute',
          left: 34,
          top: 44,
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title='Hello Utopia'
        data-uid='pg'
      />
    </Scene>
  </Storyboard>
)

registerInternalComponent(Title, {
  supportsChildren: false,
  properties: {
    text: {
      control: 'string-input',
    },
  },
  variants: [
    {
      code: '<Title />',
    },
  ],
})

`

const registerExternalComponentProject = `import * as React from 'react'
import {
  Storyboard,
  Scene,
  View,
  registerExternalComponent,
} from 'utopia-api'

var Playground = ({ style }) => {
  return (
    <div style={style} data-uid='root' data-testid='view'>
      <View sampleprop='Hello Utopia' data-uid='title'>
        Hello Utopia
      </View>
    </div>
  )
}

export var storyboard = (
  <Storyboard data-uid='sb'>
    <Scene
      style={{
        width: 521,
        height: 266,
        position: 'absolute',
        left: 554,
        top: 247,
        backgroundColor: 'white',
      }}
      data-uid='scene'
      data-testid='scene'
      commentId='120'
    >
      <Playground
        style={{
          width: 454,
          height: 177,
          position: 'absolute',
          left: 34,
          top: 44,
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title='Hello Utopia'
        data-uid='pg'
      />
    </Scene>
  </Storyboard>
)

registerExternalComponent(
  View,
  'utopia-api',
  {
    supportsChildren: false,
    properties: {
      sampleprop: {
        control: 'string-input',
      },
    },
    variants: [
      {
        code: '<View />',
      },
    ],
  },
)`

const projectWithNumberInputControlDescription = DataPickerProjectShell(`
  registerInternalComponent(Counter, {
  properties: {
    count: Utopia.numberControl(),
  },
  supportsChildren: false,
  variants: [],
})

function Counter({ count }) {
  const content = 'Content'

  return <h2 data-uid='a9c'>{count}</h2>
}

var Playground = () => {
  const titleToo = 'Title too'
  const titleIdeas = ['Chapter One']
  const currentCount = 12

  return (
    <div data-uid='root'>
      <Counter count={''} data-uid='counter' />
    </div>
  )
}`)

const projectWithObjectsAndArrays =
  DataPickerProjectShell(`registerInternalComponent(TableOfContents, {
  properties: {
    titles: Utopia.arrayControl(
      Utopia.stringControl(), // control to use for each value in the array
    ),
  },
  supportsChildren: false,
  variants: [],
})

registerInternalComponent(BookDetail, {
  properties: {
    titles: Utopia.objectControl({
      title: Utopia.stringControl(),
      published: Utopia.stringControl(),
      description: Utopia.stringControl(),
      likes: Utopia.numberControl(),
    }),
  },
  supportsChildren: false,
  variants: [],
})

function TableOfContents({ titles }) {
  const content = 'Content'

  return (
    <>
      {titles.map((t) => (
        <h2 data-uid='a9c'>{t}</h2>
      ))}
    </>
  )
}

function BookDetail({ book }) {
  const content = 'Content'

  return (
    <div>
      <h1>{book.title}</h1>
      <code>{book.published}</code>
      <p>{book.description}</p>
      <p>Likes: {book.likes}</p>
    </div>
  )
}

var Playground = () => {
  const titleToo = 'Title too'
  const currentCount = 12
  const titleIdeas = ['Chapter One', 'Chapter Two']

  const bookInfo = {
    title: 'Moby Dick',
    published: 'August 1888',
    description: 'An oldie but goldie',
    likes: 33,
  }

  return (
    <div data-uid='root'>
      <TableOfContents titles={[]} data-uid='toc' />
      <BookDetail book={{}} data-uid='bd' />
    </div>
  )
}`)

function DataPickerProjectShell(contents: string) {
  return `
  import * as React from 'react'
import * as Utopia from 'utopia-api'
import {
  Storyboard,
  Scene,
  registerInternalComponent,
} from 'utopia-api'

${contents}

export var storyboard = (
  <Storyboard data-uid='sb'>
    <Scene
      style={{
        width: 521,
        height: 266,
        position: 'absolute',
        left: 554,
        top: 247,
        backgroundColor: 'white',
      }}
      data-uid='scene'
      data-testid='scene'
      commentId='120'
    >
      <Playground
        style={{
          width: 454,
          height: 177,
          position: 'absolute',
          left: 34,
          top: 44,
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className='playground'
        css={{ color: 'red' }}
        data-uid='pg'
      />
    </Scene>
  </Storyboard>
)`
}

const projectWithHtmlProp = (imageUrl: string) => `import * as React from 'react'
import {
  Storyboard,
  Scene,
  registerInternalComponent,
} from 'utopia-api'

function Image({ url }) {
  return <img src={url} />
}

var Playground = ({ style }) => {
  return (
    <div style={style} data-uid='root'>
      <Image url='${imageUrl}' data-uid='image' />
    </div>
  )
}

export var storyboard = (
  <Storyboard data-uid='sb'>
    <Scene
      style={{
        width: 521,
        height: 266,
        position: 'absolute',
        left: 554,
        top: 247,
        backgroundColor: 'white',
      }}
      data-uid='scene'
      data-testid='scene'
      commentId='120'
    >
      <Playground
        style={{
          width: 454,
          height: 177,
          position: 'absolute',
          left: 34,
          top: 44,
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title='Hello Utopia'
        data-uid='pg'
      />
    </Scene>
  </Storyboard>
)

registerInternalComponent(Image, {
  supportsChildren: false,
  properties: {
    url: {
      control: 'string-input',
    },
  },
  variants: [
    {
      code: '<Image />',
    },
  ],
})

`

const registerInternalComponentProjectWithHtmlProp = `import * as React from 'react'
import {
  Storyboard,
  Scene,
  registerInternalComponent,
} from 'utopia-api'

function Title({ text }) {
  return <h2 data-uid='0cd'>{text}</h2>
}

var Playground = ({ style }) => {
  return (
    <div style={style} data-uid='root'>
      <Title text='<p>Hello Utopia</p>' data-uid='title' />
    </div>
  )
}

export var storyboard = (
  <Storyboard data-uid='sb'>
    <Scene
      style={{
        width: 521,
        height: 266,
        position: 'absolute',
        left: 554,
        top: 247,
        backgroundColor: 'white',
      }}
      data-uid='scene'
      data-testid='scene'
      commentId='120'
    >
      <Playground
        style={{
          width: 454,
          height: 177,
          position: 'absolute',
          left: 34,
          top: 44,
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title='Hello Utopia'
        data-uid='pg'
      />
    </Scene>
  </Storyboard>
)

registerInternalComponent(Title, {
  supportsChildren: false,
  properties: {
    text: {
      control: 'html-input',
    },
  },
  variants: [
    {
      code: '<Title />',
    },
  ],
})

`

// const projectWithImage = (imageUrl: string) => `import * as React from 'react'
// import {
//   Storyboard,
//   Scene,
//   registerInternalComponent,
// } from 'utopia-api'

// function Image({ url }) {
//   return <img src={url} />
// }

// var Playground = ({ style }) => {
//   return (
//     <div style={style} data-uid='root'>
//       <Image url='${imageUrl}' data-uid='image' />
//     </div>
//   )
// }

// export var storyboard = (
//   <Storyboard data-uid='sb'>
//     <Scene
//       style={{
//         width: 521,
//         height: 266,
//         position: 'absolute',
//         left: 554,
//         top: 247,
//         backgroundColor: 'white',
//       }}
//       data-uid='scene'
//       data-testid='scene'
//       commentId='120'
//     >
//       <Playground
//         style={{
//           width: 454,
//           height: 177,
//           position: 'absolute',
//           left: 34,
//           top: 44,
//           backgroundColor: 'white',
//           display: 'flex',
//           alignItems: 'center',
//           justifyContent: 'center',
//         }}
//         title='Hello Utopia'
//         data-uid='pg'
//       />
//     </Scene>
//   </Storyboard>
// )

// registerInternalComponent(Image, {
//   supportsChildren: false,
//   properties: {
//     url: {
//       control: 'string-input',
//     },
//   },
//   variants: [
//     {
//       code: '<Image />',
//     },
//   ],
// })

function getRenderedOptions(editor: EditorRenderResult) {
  return [
    ...editor.renderedDOM.baseElement.querySelectorAll(
      `[data-testid^="variable-from-scope"] [data-testid="variable-name"]`,
    ),
  ].map((node) => node.textContent)
}
