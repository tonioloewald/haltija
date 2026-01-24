/**
 * Task Board — Shared Trello-like task management persisted as markdown.
 *
 * Single file at .haltija/tasks-<random>.md
 * Headings are columns, lines are items, sub-bullets are metadata.
 * Read-on-demand, write-on-mutate.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

// ============================================
// Types
// ============================================

export type TaskColumn =
  | 'icebox' | 'queued' | 'in_progress' | 'blocked'
  | 'review' | 'done' | 'trash'

export const COLUMNS: TaskColumn[] = [
  'icebox', 'queued', 'in_progress', 'blocked', 'review', 'done', 'trash'
]

export interface TaskItem {
  id: number
  title: string
  column: TaskColumn
  metadata: Record<string, string>
}

export interface TaskBoard {
  filePath: string
  items: TaskItem[]
}

export interface TaskCommandResult {
  output: string
  mutated?: boolean
  boardJson?: object
}

// ============================================
// File Discovery
// ============================================

const HALTIJA_DIR = '.haltija'
const TASK_FILE_PATTERN = /^tasks-[a-f0-9]+\.md$/

/**
 * Find existing task file or create a new one.
 */
export function findOrCreateTaskFile(projectDir: string): string {
  const hjDir = join(projectDir, HALTIJA_DIR)

  // Look for existing task file
  if (existsSync(hjDir)) {
    const files = readdirSync(hjDir).filter(f => TASK_FILE_PATTERN.test(f))
    if (files.length > 0) {
      return join(hjDir, files[0])
    }
  }

  // Create directory and new file
  if (!existsSync(hjDir)) {
    mkdirSync(hjDir, { recursive: true })
  }

  const id = randomBytes(3).toString('hex')
  const filePath = join(hjDir, `tasks-${id}.md`)
  const initial = COLUMNS.map(c => `# ${c}`).join('\n\n') + '\n'
  writeFileSync(filePath, initial)
  return filePath
}

// ============================================
// Markdown Parser
// ============================================

/**
 * Parse task markdown into items. Headings become columns,
 * lines become items, `- key: value` lines become metadata on the preceding item.
 */
export function parseTasksMarkdown(content: string): TaskItem[] {
  const items: TaskItem[] = []
  let currentColumn: TaskColumn | null = null
  let currentItem: TaskItem | null = null
  let nextId = 1

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Heading → column
    const headingMatch = trimmed.match(/^#\s+(.+)$/)
    if (headingMatch) {
      const col = headingMatch[1].trim() as TaskColumn
      if (COLUMNS.includes(col)) {
        currentColumn = col
        currentItem = null
      }
      continue
    }

    // Empty line
    if (!trimmed) {
      continue
    }

    // Metadata sub-bullet (only attaches to a preceding item)
    if (trimmed.startsWith('- ')) {
      if (currentItem) {
        const kvMatch = trimmed.match(/^-\s+([^:]+):\s*(.*)$/)
        if (kvMatch) {
          currentItem.metadata[kvMatch[1].trim()] = kvMatch[2].trim()
        }
      }
      continue
    }

    // Task item line
    if (currentColumn) {
      currentItem = {
        id: nextId++,
        title: trimmed,
        column: currentColumn,
        metadata: {},
      }
      items.push(currentItem)
    }
  }

  return items
}

// ============================================
// Markdown Serializer
// ============================================

/**
 * Serialize items back to markdown, grouped by column.
 */
export function serializeTasksMarkdown(items: TaskItem[]): string {
  const sections: string[] = []

  for (const col of COLUMNS) {
    const colItems = items.filter(i => i.column === col)
    if (colItems.length === 0) continue

    sections.push(`# ${col}`)
    sections.push('')
    for (const item of colItems) {
      sections.push(item.title)
      for (const [key, value] of Object.entries(item.metadata)) {
        sections.push(`- ${key}: ${value}`)
      }
    }
    sections.push('')
  }

  return sections.join('\n')
}

// ============================================
// Board Load/Save
// ============================================

/**
 * Load the task board from disk.
 */
export function loadBoard(projectDir: string): TaskBoard {
  const filePath = findOrCreateTaskFile(projectDir)
  const content = readFileSync(filePath, 'utf-8')
  const items = parseTasksMarkdown(content)
  return { filePath, items }
}

/**
 * Save the task board to disk.
 */
export function saveBoard(board: TaskBoard): void {
  const content = serializeTasksMarkdown(board.items)
  writeFileSync(board.filePath, content)
}

/**
 * Reload the board from disk (re-reads file, re-assigns IDs).
 */
export function reloadBoard(board: TaskBoard): TaskBoard {
  const content = readFileSync(board.filePath, 'utf-8')
  board.items = parseTasksMarkdown(content)
  return board
}

// ============================================
// CRUD Operations
// ============================================

export function getItemById(board: TaskBoard, id: number): TaskItem | null {
  return board.items.find(i => i.id === id) || null
}

export function addTask(board: TaskBoard, title: string, column: TaskColumn = 'queued'): TaskItem {
  const maxId = board.items.reduce((max, i) => Math.max(max, i.id), 0)
  const item: TaskItem = {
    id: maxId + 1,
    title,
    column,
    metadata: {},
  }
  board.items.push(item)
  saveBoard(board)
  return item
}

export function moveTask(board: TaskBoard, id: number, column: TaskColumn, reason?: string): TaskItem | null {
  const item = getItemById(board, id)
  if (!item) return null
  item.column = column
  if (reason) item.metadata.reason = reason
  saveBoard(board)
  return item
}

export function claimTask(board: TaskBoard, id: number, shellName: string): TaskItem | null {
  const item = getItemById(board, id)
  if (!item) return null
  item.column = 'in_progress'
  item.metadata.claimed = shellName
  item.metadata.started = String(Date.now())
  saveBoard(board)
  return item
}

export function blockTask(board: TaskBoard, id: number, reason: string): TaskItem | null {
  const item = getItemById(board, id)
  if (!item) return null
  item.column = 'blocked'
  item.metadata.reason = reason
  saveBoard(board)
  return item
}

export function doneTask(board: TaskBoard, id: number): TaskItem | null {
  const item = getItemById(board, id)
  if (!item) return null
  item.column = 'done'
  item.metadata.completed = String(Date.now())
  saveBoard(board)
  return item
}

export function trashTask(board: TaskBoard, id: number): TaskItem | null {
  const item = getItemById(board, id)
  if (!item) return null
  item.column = 'trash'
  saveBoard(board)
  return item
}

// ============================================
// Board Summary & Formatting
// ============================================

/**
 * Compact status line summary.
 * e.g., "2 active 1 blocked 3 queued"
 */
export function getBoardSummary(board: TaskBoard): string {
  const active = board.items.filter(i => i.column === 'in_progress').length
  const blocked = board.items.filter(i => i.column === 'blocked').length
  const queued = board.items.filter(i => i.column === 'queued').length
  const review = board.items.filter(i => i.column === 'review').length

  const parts: string[] = []
  if (active) parts.push(`${active} active`)
  if (blocked) parts.push(`${blocked} blocked`)
  if (review) parts.push(`${review} review`)
  if (queued) parts.push(`${queued} queued`)

  return parts.length > 0 ? parts.join(' ') : 'empty'
}

/**
 * Format items for list display.
 */
export function formatItemList(items: TaskItem[], showColumn = false): string {
  if (items.length === 0) return '(empty)'
  return items.map(i => {
    let line = `${i.id} ${i.title}`
    if (showColumn) line += ` [${i.column}]`
    if (i.metadata.claimed) line += ` (${i.metadata.claimed})`
    if (i.metadata.reason) line += ` — ${i.metadata.reason}`
    return line
  }).join('\n')
}

/**
 * Format single item detail.
 */
export function formatItemDetail(item: TaskItem): string {
  const lines = [`#${item.id} ${item.title}`, `column: ${item.column}`]
  for (const [key, value] of Object.entries(item.metadata)) {
    lines.push(`${key}: ${value}`)
  }
  return lines.join('\n')
}

/**
 * Return board as JSON structure for visual rendering.
 */
export function getBoardJson(board: TaskBoard): object {
  const columns: Record<string, Array<{ id: number; title: string; claimed?: string }>> = {}
  for (const col of COLUMNS) {
    const colItems = board.items.filter(i => i.column === col)
    if (colItems.length > 0) {
      columns[col] = colItems.map(i => ({
        id: i.id,
        title: i.title,
        ...(i.metadata.claimed ? { claimed: i.metadata.claimed } : {}),
      }))
    }
  }
  return { type: 'board', columns }
}

// ============================================
// Command Dispatch
// ============================================

/**
 * Parse a quoted string or bare word from args.
 * Handles: "multi word title" or bare-word
 */
function extractQuotedOrWord(args: string[]): { value: string; rest: string[] } {
  if (args.length === 0) return { value: '', rest: [] }

  // Check if first arg starts with a quote
  if (args[0].startsWith('"')) {
    const joined = args.join(' ')
    const match = joined.match(/^"([^"]*)"(.*)$/)
    if (match) {
      const remaining = match[2].trim()
      return {
        value: match[1],
        rest: remaining ? remaining.split(/\s+/) : [],
      }
    }
    // Unclosed quote — take everything after the opening quote
    return { value: joined.slice(1), rest: [] }
  }

  return { value: args[0], rest: args.slice(1) }
}

/**
 * Dispatch a task command. Returns output text and mutation flag.
 */
export function dispatchTaskCommand(
  board: TaskBoard,
  verb: string | undefined,
  args: string[],
  shellName: string,
): TaskCommandResult {
  // No verb → board summary + verb list
  if (!verb) {
    const summary = getBoardSummary(board)
    return { output: `${summary}\ntasks > list add move claim block done trash detail board` }
  }

  switch (verb) {
    case 'list': {
      const colFilter = args[0] as TaskColumn | undefined
      if (colFilter && COLUMNS.includes(colFilter)) {
        const items = board.items.filter(i => i.column === colFilter)
        return { output: formatItemList(items) }
      }
      // Show all non-done, non-trash items grouped by column
      const active = board.items.filter(i => i.column !== 'done' && i.column !== 'trash')
      return { output: formatItemList(active, true) }
    }

    case 'add': {
      const { value: title, rest } = extractQuotedOrWord(args)
      if (!title) return { output: 'error: tasks add "title" [column]' }
      const col = (rest[0] as TaskColumn) || 'queued'
      if (!COLUMNS.includes(col)) return { output: `error: unknown column "${col}". columns: ${COLUMNS.join(', ')}` }
      const item = addTask(board, title, col)
      return { output: `#${item.id} added to ${col}`, mutated: true }
    }

    case 'move': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks move <id> <column> ["reason"]' }
      const col = args[1] as TaskColumn
      if (!col || !COLUMNS.includes(col)) return { output: `error: unknown column "${args[1]}". columns: ${COLUMNS.join(', ')}` }
      const { value: reason } = extractQuotedOrWord(args.slice(2))
      const item = moveTask(board, id, col, reason || undefined)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: `#${id} → ${col}`, mutated: true }
    }

    case 'claim': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks claim <id>' }
      const item = claimTask(board, id, shellName)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: `#${id} claimed by ${shellName}`, mutated: true }
    }

    case 'block': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks block <id> "reason"' }
      const { value: reason } = extractQuotedOrWord(args.slice(1))
      if (!reason) return { output: 'error: tasks block <id> "reason"' }
      const item = blockTask(board, id, reason)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: `#${id} blocked: ${reason}`, mutated: true }
    }

    case 'done': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks done <id>' }
      const item = doneTask(board, id)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: `#${id} done`, mutated: true }
    }

    case 'trash': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks trash <id>' }
      const item = trashTask(board, id)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: `#${id} trashed`, mutated: true }
    }

    case 'detail': {
      const id = parseInt(args[0])
      if (isNaN(id)) return { output: 'error: tasks detail <id>' }
      const item = getItemById(board, id)
      if (!item) return { output: `error: task #${id} not found` }
      return { output: formatItemDetail(item) }
    }

    case 'board': {
      return { output: JSON.stringify(getBoardJson(board)), boardJson: getBoardJson(board) }
    }

    default:
      return { output: `error: unknown verb "${verb}". tasks > list add move claim block done trash detail board` }
  }
}
