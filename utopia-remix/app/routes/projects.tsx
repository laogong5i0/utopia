import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LoaderFunctionArgs, json } from '@remix-run/node'
import { useFetcher, useLoaderData } from '@remix-run/react'
import moment from 'moment'
import { UserDetails } from 'prisma-client'
import React from 'react'
import { ProjectContextMenu } from '../components/projectActionContextMenu'
import { useIsDarkMode } from '../hooks/useIsDarkMode'
import { listDeletedProjects, listProjects } from '../models/project.server'
import { useProjectsStore } from '../store'
import { button } from '../styles/button.css'
import { newProjectButton } from '../styles/newProjectButton.css'
import { projectCategoryButton, userName } from '../styles/sidebarComponents.css'
import { sprinkles } from '../styles/sprinkles.css'
import { ProjectWithoutContent } from '../types'
import { requireUser } from '../util/api.server'
import { assertNever } from '../util/assertNever'
import { projectEditorLink } from '../util/links'
import { when } from '../util/react-conditionals'

const Categories = ['allProjects', 'trash'] as const

function isCategory(category: unknown): category is Category {
  return Categories.includes(category as Category)
}

export type Category = (typeof Categories)[number]

const categories: { [key in Category]: { name: string } } = {
  allProjects: { name: 'All My Projects' },
  trash: { name: 'Trash' },
}

const MarginSize = 30
const SidebarRowHeight = 30

export async function loader(args: LoaderFunctionArgs) {
  const user = await requireUser(args.request)

  const projects = await listProjects({
    ownerId: user.user_id,
  })

  const deletedProjects = await listDeletedProjects({
    ownerId: user.user_id,
  })

  return json({ projects, deletedProjects, user })
}

const ProjectsPage = React.memo(() => {
  const data = useLoaderData() as unknown as {
    projects: ProjectWithoutContent[]
    user: UserDetails
    deletedProjects: ProjectWithoutContent[]
  }

  const selectedCategory = useProjectsStore((store) => store.selectedCategory)

  const activeProjects = React.useMemo(() => {
    switch (selectedCategory) {
      case 'allProjects':
        return data.projects
      case 'trash':
        return data.deletedProjects
      default:
        assertNever(selectedCategory)
    }
  }, [data.projects, data.deletedProjects, selectedCategory])

  return (
    <div
      style={{
        margin: MarginSize,
        height: `calc(100vh - ${MarginSize * 2}px)`,
        width: `calc(100vw - ${MarginSize * 2}px)`,
        gap: MarginSize,
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        userSelect: 'none',
      }}
    >
      <Sidebar user={data.user} />
      <div
        style={{
          display: 'flex',
          flexGrow: 1,
          flexDirection: 'column',
          gap: MarginSize,
        }}
      >
        <TopActionBar />
        <CategoryHeader projects={activeProjects} />
        <ProjectCards projects={activeProjects} />)
      </div>
    </div>
  )
})
ProjectsPage.displayName = 'ProjectsPage'

export default ProjectsPage

const Sidebar = React.memo(({ user }: { user: UserDetails }) => {
  const searchQuery = useProjectsStore((store) => store.searchQuery)
  const setSearchQuery = useProjectsStore((store) => store.setSearchQuery)
  const selectedCategory = useProjectsStore((store) => store.selectedCategory)
  const setSelectedCategory = useProjectsStore((store) => store.setSelectedCategory)
  const setSelectedProjectId = useProjectsStore((store) => store.setSelectedProjectId)

  const isDarkMode = useIsDarkMode()

  const logoPic = React.useMemo(() => {
    return isDarkMode ? 'url(/assets/pyramid_dark.png)' : 'url(/assets/pyramid_light.png)'
  }, [isDarkMode])

  const handleSelectCategory = React.useCallback(
    (category: string) => () => {
      if (isCategory(category)) {
        setSelectedCategory(category)
        setSearchQuery('')
        setSelectedProjectId(null)
      }
    },
    [setSelectedCategory, setSearchQuery, setSelectedProjectId],
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 230,
        flexShrink: 0,
        justifyContent: 'space-between',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <img
            className={sprinkles({ borderRadius: 'medium' })}
            style={{ width: 40 }}
            src={user.picture ?? undefined}
            referrerPolicy='no-referrer'
          />
          <div className={userName({})}>{user.name}</div>
        </div>

        <input
          id='search-input'
          autoFocus={true}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
          }}
          style={{
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'grey',
            height: SidebarRowHeight,
            borderBottom: '1px solid gray',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            padding: '0 14px',
          }}
          placeholder='Search…'
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {Object.entries(categories).map(([category, data]) => {
            return (
              <button
                key={`category-${category}`}
                className={projectCategoryButton({
                  color: category === selectedCategory ? 'selected' : 'neutral',
                })}
                onClick={handleSelectCategory(category)}
              >
                <span>{data.name}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          fontFamily: 'Reckless',
          fontSize: 34,
        }}
      >
        <div
          style={{
            height: 60,
            width: 45,
            backgroundSize: '45px',
            backgroundRepeat: 'no-repeat',
            backgroundImage: logoPic,
          }}
        />
        Utopia
      </div>
    </div>
  )
})
Sidebar.displayName = 'Sidebar'

const TopActionBar = React.memo(() => {
  const newProjectButtons = [
    {
      id: 'createProject',
      title: '+ Blank Project',
      onClick: () => window.open(projectEditorLink(null), '_blank'),
      color: 'orange',
    },
    // {
    //   title: '+ Project On GitHub',
    //   onClick: () => {},
    //   color: 'pink',
    // },
    // {
    //   title: '+ Import From GitHub',
    //   onClick: () => {},
    //   color: 'purple',
    // },
    // {
    //   title: '+ Remix Project',
    //   onClick: () => {},
    //   color: 'blue',
    // },
    // {
    //   title: '+ Shopify Store',
    //   onClick: () => {},
    //   color: 'green',
    // },
  ] as const

  return (
    <div
      style={{
        height: 60,
        flex: 0,
        display: 'flex',
        flexDirection: 'row',
        gap: 15,
      }}
    >
      {newProjectButtons.map((p) => (
        <button key={p.id} className={newProjectButton({ color: p.color })} onClick={p.onClick}>
          <span>{p.title}</span>
        </button>
      ))}
    </div>
  )
})
TopActionBar.displayName = 'TopActionBar'

const CategoryHeader = React.memo(({ projects }: { projects: ProjectWithoutContent[] }) => {
  const searchQuery = useProjectsStore((store) => store.searchQuery)
  const setSearchQuery = useProjectsStore((store) => store.setSearchQuery)
  const selectedCategory = useProjectsStore((store) => store.selectedCategory)

  return (
    <div style={{ fontSize: 16, fontWeight: 600, padding: '5px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 40 }}>
        <div style={{ flex: 'auto' }}>
          {when(
            searchQuery !== '',
            <span>
              <span style={{ color: 'gray', paddingRight: 3 }}>
                <span
                  onClick={() => {
                    setSearchQuery('')
                    const inputElement = document.getElementById('search-input') as HTMLInputElement
                    if (inputElement) {
                      inputElement.value = ''
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  ←{' '}
                </span>{' '}
                Search results for
              </span>
              <span> "{searchQuery}"</span>
            </span>,
          )}
          {when(
            searchQuery === '',
            <div style={{ flex: 1 }}>{categories[selectedCategory].name}</div>,
          )}
        </div>

        <CategoryActions projects={projects} />
      </div>
    </div>
  )
})
CategoryHeader.displayName = 'CategoryHeader'

const CategoryActions = React.memo(({ projects }: { projects: ProjectWithoutContent[] }) => {
  const selectedCategory = useProjectsStore((store) => store.selectedCategory)

  switch (selectedCategory) {
    case 'allProjects':
      return null
    case 'trash':
      return <CategoryTrashActions projects={projects} />
    default:
      assertNever(selectedCategory)
  }
})
CategoryActions.displayName = 'CategoryActions'

const CategoryTrashActions = React.memo(({ projects }: { projects: ProjectWithoutContent[] }) => {
  const fetcher = useFetcher()

  const handleEmptyTrash = React.useCallback(() => {
    const ok = window.confirm(
      'Are you sure? ALL projects in the trash will be deleted permanently.',
    )
    if (ok) {
      fetcher.submit({}, { method: 'POST', action: `/internal/projects/destroy` })
    }
  }, [fetcher])

  return (
    <>
      <button
        className={button({ size: 'small' })}
        onClick={handleEmptyTrash}
        disabled={projects.length === 0}
      >
        Empty trash
      </button>
    </>
  )
})
CategoryTrashActions.displayName = 'CategoryTrashActions'

const ProjectCards = React.memo(({ projects }: { projects: ProjectWithoutContent[] }) => {
  const searchQuery = useProjectsStore((store) => store.searchQuery)
  const selectedProjectId = useProjectsStore((store) => store.selectedProjectId)
  const setSelectedProjectId = useProjectsStore((store) => store.setSelectedProjectId)

  const handleProjectSelect = React.useCallback(
    (project: ProjectWithoutContent) =>
      setSelectedProjectId(project.proj_id === selectedProjectId ? null : project.proj_id),
    [setSelectedProjectId, selectedProjectId],
  )

  const filteredProjects = React.useMemo(() => {
    const sanitizedQuery = searchQuery.trim().toLowerCase()
    if (sanitizedQuery.length === 0) {
      return projects
    }
    return projects.filter((project) => project.title.toLowerCase().includes(sanitizedQuery))
  }, [projects, searchQuery])

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        gap: MarginSize,
        flexGrow: 1,
        flexDirection: 'row',
        overflowY: 'scroll',
        scrollbarColor: 'lightgrey transparent',
      }}
    >
      {filteredProjects.map((project) => (
        <ProjectCard
          key={project.proj_id}
          project={project}
          selected={project.proj_id === selectedProjectId}
          onSelect={() => handleProjectSelect(project)}
        />
      ))}
    </div>
  )
})
ProjectCards.displayName = 'CategoryAllProjects'

const ProjectCard = React.memo(
  ({
    project,
    selected,
    onSelect,
  }: {
    project: ProjectWithoutContent
    selected: boolean
    onSelect: () => void
  }) => {
    const openProject = React.useCallback(() => {
      window.open(projectEditorLink(project.proj_id), '_blank')
    }, [project.proj_id])

    return (
      <div
        style={{
          height: 200,
          width: 300,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div
          style={{
            border: selected ? '2px solid #0075F9' : '2px solid transparent',
            borderRadius: 10,
            overflow: 'hidden',
            height: 180,
            width: '100%',
            background: 'linear-gradient(rgba(77, 255, 223, 0.4), rgba(255,250,220,.8))',
            backgroundAttachment: 'local',
            backgroundRepeat: 'no-repeat',
          }}
          onMouseDown={onSelect}
          onDoubleClick={openProject}
        />
        <ProjectCardActions project={project} />
      </div>
    )
  },
)
ProjectCard.displayName = 'ProjectCard'

const ProjectCardActions = React.memo(({ project }: { project: ProjectWithoutContent }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: 10, gap: 5, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{project.title}</div>
        <div>{moment(project.modified_at).fromNow()}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={button()}>…</button>
          </DropdownMenu.Trigger>
          <ProjectContextMenu project={project} />
        </DropdownMenu.Root>
      </div>
    </div>
  )
})
ProjectCardActions.displayName = 'ProjectCardActions'
