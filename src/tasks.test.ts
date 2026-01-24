import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseTasksMarkdown,
  serializeTasksMarkdown,
  findOrCreateTaskFile,
  loadBoard,
  saveBoard,
  addTask,
  moveTask,
  claimTask,
  blockTask,
  doneTask,
  trashTask,
  getBoardSummary,
  formatItemList,
  formatItemDetail,
  getBoardJson,
  dispatchTaskCommand,
  COLUMNS,
  type TaskBoard,
  type TaskItem,
} from './tasks'

describe('parseTasksMarkdown', () => {
  it('parses empty file', () => {
    const items = parseTasksMarkdown('')
    expect(items).toEqual([])
  })

  it('parses headings as columns', () => {
    const md = `# queued\n\nTask one\nTask two\n\n# in_progress\n\nTask three\n`
    const items = parseTasksMarkdown(md)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ id: 1, title: 'Task one', column: 'queued' })
    expect(items[1]).toMatchObject({ id: 2, title: 'Task two', column: 'queued' })
    expect(items[2]).toMatchObject({ id: 3, title: 'Task three', column: 'in_progress' })
  })

  it('parses metadata sub-bullets', () => {
    const md = `# in_progress\n\nBuild UI\n- claimed: agent-1\n- started: 12345\n`
    const items = parseTasksMarkdown(md)
    expect(items).toHaveLength(1)
    expect(items[0].metadata).toEqual({ claimed: 'agent-1', started: '12345' })
  })

  it('ignores unknown headings', () => {
    const md = `# unknown_column\n\nSome task\n\n# queued\n\nReal task\n`
    const items = parseTasksMarkdown(md)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Real task')
  })

  it('assigns sequential IDs', () => {
    const md = `# queued\n\nA\nB\n\n# done\n\nC\nD\nE\n`
    const items = parseTasksMarkdown(md)
    expect(items.map(i => i.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('handles multiple metadata on one item', () => {
    const md = `# blocked\n\nDeploy\n- reason: waiting on DNS\n- blocked_by: ops-team\n- since: 2024-01-01\n`
    const items = parseTasksMarkdown(md)
    expect(items[0].metadata).toEqual({
      reason: 'waiting on DNS',
      blocked_by: 'ops-team',
      since: '2024-01-01',
    })
  })

  it('metadata without preceding item is ignored', () => {
    const md = `# queued\n\n- orphan: value\nReal task\n`
    const items = parseTasksMarkdown(md)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Real task')
    expect(items[0].metadata).toEqual({})
  })
})

describe('serializeTasksMarkdown', () => {
  it('serializes empty array', () => {
    const result = serializeTasksMarkdown([])
    expect(result).toBe('')
  })

  it('groups items by column in order', () => {
    const items: TaskItem[] = [
      { id: 1, title: 'First', column: 'in_progress', metadata: {} },
      { id: 2, title: 'Second', column: 'queued', metadata: {} },
      { id: 3, title: 'Third', column: 'in_progress', metadata: { claimed: 'me' } },
    ]
    const result = serializeTasksMarkdown(items)
    const lines = result.split('\n')
    // queued comes before in_progress in COLUMNS order
    expect(lines.indexOf('# queued')).toBeLessThan(lines.indexOf('# in_progress'))
    expect(result).toContain('Second')
    expect(result).toContain('- claimed: me')
  })

  it('omits empty columns', () => {
    const items: TaskItem[] = [
      { id: 1, title: 'Only item', column: 'review', metadata: {} },
    ]
    const result = serializeTasksMarkdown(items)
    expect(result).toContain('# review')
    expect(result).not.toContain('# queued')
    expect(result).not.toContain('# icebox')
  })

  it('round-trips parse → serialize', () => {
    const original = `# queued\n\nTask A\nTask B\n- priority: high\n\n# blocked\n\nTask C\n- reason: waiting\n\n`
    const items = parseTasksMarkdown(original)
    const serialized = serializeTasksMarkdown(items)
    const reparsed = parseTasksMarkdown(serialized)
    expect(reparsed).toHaveLength(items.length)
    expect(reparsed[0].title).toBe(items[0].title)
    expect(reparsed[1].metadata).toEqual(items[1].metadata)
    expect(reparsed[2].metadata).toEqual(items[2].metadata)
  })
})

describe('findOrCreateTaskFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hj-tasks-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates .haltija directory and task file', () => {
    const filePath = findOrCreateTaskFile(tmpDir)
    expect(filePath).toContain('.haltija/tasks-')
    expect(filePath).toMatch(/tasks-[a-f0-9]{6}\.md$/)
    const content = readFileSync(filePath, 'utf-8')
    expect(content).toContain('# queued')
    expect(content).toContain('# icebox')
  })

  it('reuses existing task file', () => {
    const first = findOrCreateTaskFile(tmpDir)
    const second = findOrCreateTaskFile(tmpDir)
    expect(first).toBe(second)
  })
})

describe('Board CRUD', () => {
  let tmpDir: string
  let board: TaskBoard

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hj-tasks-'))
    board = loadBoard(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loadBoard creates empty board', () => {
    expect(board.items).toHaveLength(0)
    expect(board.filePath).toContain('tasks-')
  })

  it('addTask adds to queued by default', () => {
    const item = addTask(board, 'New task')
    expect(item.column).toBe('queued')
    expect(item.title).toBe('New task')
    expect(board.items).toHaveLength(1)
    // Verify persisted
    const reloaded = loadBoard(tmpDir)
    expect(reloaded.items).toHaveLength(1)
    expect(reloaded.items[0].title).toBe('New task')
  })

  it('addTask respects column parameter', () => {
    const item = addTask(board, 'Ice task', 'icebox')
    expect(item.column).toBe('icebox')
  })

  it('moveTask changes column', () => {
    addTask(board, 'Movable')
    const moved = moveTask(board, 1, 'in_progress')
    expect(moved?.column).toBe('in_progress')
  })

  it('moveTask with reason sets metadata', () => {
    addTask(board, 'Movable')
    const moved = moveTask(board, 1, 'blocked', 'waiting on API')
    expect(moved?.metadata.reason).toBe('waiting on API')
  })

  it('moveTask returns null for unknown ID', () => {
    expect(moveTask(board, 99, 'done')).toBeNull()
  })

  it('claimTask moves to in_progress with metadata', () => {
    addTask(board, 'Claimable')
    const claimed = claimTask(board, 1, 'agent-1')
    expect(claimed?.column).toBe('in_progress')
    expect(claimed?.metadata.claimed).toBe('agent-1')
    expect(claimed?.metadata.started).toBeDefined()
  })

  it('blockTask moves to blocked with reason', () => {
    addTask(board, 'Blockable')
    const blocked = blockTask(board, 1, 'DNS issue')
    expect(blocked?.column).toBe('blocked')
    expect(blocked?.metadata.reason).toBe('DNS issue')
  })

  it('doneTask moves to done with timestamp', () => {
    addTask(board, 'Completable')
    const done = doneTask(board, 1)
    expect(done?.column).toBe('done')
    expect(done?.metadata.completed).toBeDefined()
  })

  it('trashTask moves to trash', () => {
    addTask(board, 'Trashable')
    const trashed = trashTask(board, 1)
    expect(trashed?.column).toBe('trash')
  })

  it('sequential IDs work correctly after adds', () => {
    addTask(board, 'First')
    addTask(board, 'Second')
    addTask(board, 'Third')
    expect(board.items.map(i => i.id)).toEqual([1, 2, 3])
  })
})

describe('getBoardSummary', () => {
  let tmpDir: string
  let board: TaskBoard

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hj-tasks-'))
    board = loadBoard(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns "empty" for empty board', () => {
    expect(getBoardSummary(board)).toBe('empty')
  })

  it('shows counts for active columns', () => {
    addTask(board, 'A')
    addTask(board, 'B')
    claimTask(board, 1, 'me')
    expect(getBoardSummary(board)).toBe('1 active 1 queued')
  })

  it('shows blocked count', () => {
    addTask(board, 'A')
    blockTask(board, 1, 'reason')
    expect(getBoardSummary(board)).toBe('1 blocked')
  })
})

describe('formatItemList', () => {
  it('returns (empty) for no items', () => {
    expect(formatItemList([])).toBe('(empty)')
  })

  it('formats items with IDs', () => {
    const items: TaskItem[] = [
      { id: 1, title: 'First', column: 'queued', metadata: {} },
      { id: 2, title: 'Second', column: 'queued', metadata: { claimed: 'bot' } },
    ]
    const result = formatItemList(items)
    expect(result).toContain('1 First')
    expect(result).toContain('2 Second (bot)')
  })

  it('shows column when requested', () => {
    const items: TaskItem[] = [
      { id: 1, title: 'Task', column: 'blocked', metadata: { reason: 'DNS' } },
    ]
    const result = formatItemList(items, true)
    expect(result).toContain('[blocked]')
    expect(result).toContain('DNS')
  })
})

describe('formatItemDetail', () => {
  it('shows all fields', () => {
    const item: TaskItem = {
      id: 5,
      title: 'Deploy app',
      column: 'blocked',
      metadata: { reason: 'waiting', claimed: 'ops' },
    }
    const result = formatItemDetail(item)
    expect(result).toContain('#5 Deploy app')
    expect(result).toContain('column: blocked')
    expect(result).toContain('reason: waiting')
    expect(result).toContain('claimed: ops')
  })
})

describe('getBoardJson', () => {
  let tmpDir: string
  let board: TaskBoard

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hj-tasks-'))
    board = loadBoard(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns board structure with type field', () => {
    addTask(board, 'Item A')
    addTask(board, 'Item B')
    const json = getBoardJson(board) as any
    expect(json.type).toBe('board')
    expect(json.columns.queued).toHaveLength(2)
    expect(json.columns.queued[0].title).toBe('Item A')
  })

  it('omits empty columns', () => {
    addTask(board, 'Only one')
    const json = getBoardJson(board) as any
    expect(json.columns.queued).toBeDefined()
    expect(json.columns.icebox).toBeUndefined()
  })

  it('includes claimed metadata', () => {
    addTask(board, 'Claimed item')
    claimTask(board, 1, 'agent-x')
    const json = getBoardJson(board) as any
    expect(json.columns.in_progress[0].claimed).toBe('agent-x')
  })
})

describe('dispatchTaskCommand', () => {
  let tmpDir: string
  let board: TaskBoard

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hj-tasks-'))
    board = loadBoard(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('no verb shows summary + verb list', () => {
    const result = dispatchTaskCommand(board, undefined, [], 'me')
    expect(result.output).toContain('empty')
    expect(result.output).toContain('tasks >')
  })

  it('add creates a task', () => {
    const result = dispatchTaskCommand(board, 'add', ['"Fix bug"'], 'me')
    expect(result.output).toContain('#1 added to queued')
    expect(result.mutated).toBe(true)
    expect(board.items).toHaveLength(1)
    expect(board.items[0].title).toBe('Fix bug')
  })

  it('add with column', () => {
    dispatchTaskCommand(board, 'add', ['"Ice item"', 'icebox'], 'me')
    expect(board.items[0].column).toBe('icebox')
  })

  it('add errors on missing title', () => {
    const result = dispatchTaskCommand(board, 'add', [], 'me')
    expect(result.output).toContain('error:')
  })

  it('move changes column', () => {
    dispatchTaskCommand(board, 'add', ['"Task"'], 'me')
    const result = dispatchTaskCommand(board, 'move', ['1', 'in_progress'], 'me')
    expect(result.output).toContain('#1')
    expect(result.output).toContain('in_progress')
    expect(result.mutated).toBe(true)
  })

  it('claim assigns shell name', () => {
    dispatchTaskCommand(board, 'add', ['"Task"'], 'me')
    const result = dispatchTaskCommand(board, 'claim', ['1'], 'agent-1')
    expect(result.output).toContain('claimed by agent-1')
    expect(board.items[0].metadata.claimed).toBe('agent-1')
  })

  it('block sets reason', () => {
    dispatchTaskCommand(board, 'add', ['"Task"'], 'me')
    const result = dispatchTaskCommand(board, 'block', ['1', '"DNS issue"'], 'me')
    expect(result.output).toContain('blocked')
    expect(board.items[0].metadata.reason).toBe('DNS issue')
  })

  it('done completes task', () => {
    dispatchTaskCommand(board, 'add', ['"Task"'], 'me')
    const result = dispatchTaskCommand(board, 'done', ['1'], 'me')
    expect(result.output).toContain('done')
    expect(board.items[0].column).toBe('done')
  })

  it('trash removes task', () => {
    dispatchTaskCommand(board, 'add', ['"Task"'], 'me')
    const result = dispatchTaskCommand(board, 'trash', ['1'], 'me')
    expect(result.output).toContain('trashed')
    expect(board.items[0].column).toBe('trash')
  })

  it('detail shows item info', () => {
    dispatchTaskCommand(board, 'add', ['"My task"'], 'me')
    claimTask(board, 1, 'agent-1')
    const result = dispatchTaskCommand(board, 'detail', ['1'], 'me')
    expect(result.output).toContain('#1 My task')
    expect(result.output).toContain('in_progress')
    expect(result.output).toContain('agent-1')
  })

  it('list shows non-done items', () => {
    dispatchTaskCommand(board, 'add', ['"Active"'], 'me')
    dispatchTaskCommand(board, 'add', ['"Done one"'], 'me')
    doneTask(board, 2)
    const result = dispatchTaskCommand(board, 'list', [], 'me')
    expect(result.output).toContain('Active')
    expect(result.output).not.toContain('Done one')
  })

  it('list with column filter', () => {
    dispatchTaskCommand(board, 'add', ['"A"'], 'me')
    dispatchTaskCommand(board, 'add', ['"B"', 'icebox'], 'me')
    const result = dispatchTaskCommand(board, 'list', ['icebox'], 'me')
    expect(result.output).toContain('B')
    expect(result.output).not.toContain('A')
  })

  it('board returns JSON', () => {
    dispatchTaskCommand(board, 'add', ['"Item"'], 'me')
    const result = dispatchTaskCommand(board, 'board', [], 'me')
    const parsed = JSON.parse(result.output)
    expect(parsed.type).toBe('board')
    expect(parsed.columns.queued).toHaveLength(1)
  })

  it('unknown verb shows error with verb list', () => {
    const result = dispatchTaskCommand(board, 'unknown', [], 'me')
    expect(result.output).toContain('error:')
    expect(result.output).toContain('tasks >')
  })

  it('invalid ID shows error', () => {
    const result = dispatchTaskCommand(board, 'done', ['abc'], 'me')
    expect(result.output).toContain('error:')
  })

  it('not-found ID shows error', () => {
    const result = dispatchTaskCommand(board, 'done', ['99'], 'me')
    expect(result.output).toContain('not found')
  })
})
