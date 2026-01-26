/**
 * <task-board> Web Component
 * 
 * A Trello-like kanban board for managing tasks.
 * Connects to a Haltija server for data persistence.
 * 
 * Usage:
 *   <task-board server="http://localhost:8700"></task-board>
 * 
 * Attributes:
 *   server - Base URL of the Haltija server (default: http://localhost:8700)
 *   filter - Text filter for task titles
 *   assignee - Filter by assignee metadata
 */

// Column definitions with display names
const COLUMNS = [
  { id: 'icebox', name: 'Icebox', icon: '❄️' },
  { id: 'queued', name: 'Queued', icon: '📋' },
  { id: 'in_progress', name: 'In Progress', icon: '🔄' },
  { id: 'blocked', name: 'Blocked', icon: '🚧' },
  { id: 'review', name: 'Review', icon: '👀' },
  { id: 'done', name: 'Done', icon: '✅' },
  { id: 'trash', name: 'Trash', icon: '🗑️' },
] as const

type ColumnId = typeof COLUMNS[number]['id']

interface TaskItem {
  id: number
  title: string
  column: ColumnId
  metadata: Record<string, string>
}

const STYLES = `
  :host {
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --bg: #1a1a2e;
    --surface: #252540;
    --surface-hover: #2a2a4a;
    --border: #333;
    --text: #fff;
    --text-muted: #888;
    --accent: #6366f1;
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #ef4444;
  }

  * {
    box-sizing: border-box;
  }

  .board {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: var(--bg);
    min-height: 400px;
    overflow-x: auto;
  }

  .column {
    flex: 0 0 240px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 8px;
    border: 1px solid var(--border);
    max-height: 100%;
  }

  .column-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    color: var(--text);
  }

  .column-header .icon {
    font-size: 16px;
  }

  .column-header .count {
    margin-left: auto;
    background: var(--bg);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .column-items {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 100px;
  }

  .column-items.drag-over {
    background: rgba(99, 102, 241, 0.1);
  }

  .task-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    cursor: grab;
    transition: transform 0.1s, box-shadow 0.1s;
  }

  .task-card:hover {
    border-color: var(--accent);
  }

  .task-card.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .task-card.drag-preview {
    transform: rotate(3deg);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
  }

  .task-title {
    color: var(--text);
    font-size: 13px;
    line-height: 1.4;
    margin-bottom: 6px;
  }

  .task-title[contenteditable] {
    outline: none;
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 2px 4px;
    margin: -3px -5px;
  }

  .task-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .task-tag {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--surface);
    color: var(--text-muted);
  }

  .task-tag.assignee {
    background: rgba(99, 102, 241, 0.2);
    color: var(--accent);
  }

  .task-tag.priority-high {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger);
  }

  .task-tag.priority-medium {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning);
  }

  .task-actions {
    display: none;
    gap: 4px;
    margin-top: 8px;
  }

  .task-card:hover .task-actions {
    display: flex;
  }

  .task-action {
    padding: 4px 8px;
    font-size: 11px;
    border: none;
    border-radius: 3px;
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .task-action:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .task-action.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger);
  }

  /* Quick add */
  .quick-add {
    padding: 8px;
    border-top: 1px solid var(--border);
  }

  .quick-add-btn {
    width: 100%;
    padding: 8px;
    border: 1px dashed var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
  }

  .quick-add-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .quick-add-input {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    outline: none;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  .filter-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-size: 12px;
    outline: none;
    max-width: 200px;
  }

  .filter-input:focus {
    border-color: var(--accent);
  }

  .filter-input::placeholder {
    color: var(--text-muted);
  }

  .refresh-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
  }

  .refresh-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  /* Empty state */
  .empty-column {
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    padding: 20px;
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 1000;
    min-width: 150px;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
  }

  .context-menu-item:hover {
    background: var(--surface-hover);
  }

  .context-menu-item.danger {
    color: var(--danger);
  }

  .context-menu-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
`

export class TaskBoard extends HTMLElement {
  private shadow: ShadowRoot
  private items: TaskItem[] = []
  private filter = ''
  private assigneeFilter = ''
  private draggedItem: TaskItem | null = null
  private contextMenu: HTMLElement | null = null

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  static get observedAttributes() {
    return ['server', 'filter', 'assignee']
  }

  get server(): string {
    return this.getAttribute('server') || 'http://localhost:8700'
  }

  connectedCallback() {
    this.render()
    this.loadTasks()
    this.connectWebSocket()
    
    // Close context menu on click outside
    document.addEventListener('click', () => this.hideContextMenu())
  }

  disconnectedCallback() {
    // Cleanup if needed
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === 'filter') {
      this.filter = newValue || ''
      this.renderBoard()
    } else if (name === 'assignee') {
      this.assigneeFilter = newValue || ''
      this.renderBoard()
    }
  }

  private async loadTasks() {
    try {
      const resp = await fetch(`${this.server}/terminal/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tasks', command: 'board' })
      })
      const result = await resp.json()
      if (result.boardJson?.items) {
        this.items = result.boardJson.items
        this.renderBoard()
      }
    } catch (err) {
      console.error('[task-board] Failed to load tasks:', err)
    }
  }

  private connectWebSocket() {
    const wsUrl = this.server.replace('http', 'ws') + '/ws/terminal'
    const ws = new WebSocket(wsUrl)
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'task-changed') {
          // Reload tasks when board changes
          this.loadTasks()
        }
      } catch {}
    }
    
    ws.onclose = () => {
      // Reconnect after delay
      setTimeout(() => this.connectWebSocket(), 3000)
    }
  }

  private render() {
    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="toolbar">
        <input type="text" class="filter-input" placeholder="Filter tasks..." value="${this.escapeHtml(this.filter)}">
        <button class="refresh-btn" title="Refresh">↻</button>
      </div>
      <div class="board"></div>
    `
    
    // Filter input handler
    const filterInput = this.shadow.querySelector('.filter-input') as HTMLInputElement
    filterInput?.addEventListener('input', (e) => {
      this.filter = (e.target as HTMLInputElement).value
      this.renderBoard()
    })
    
    // Refresh button
    const refreshBtn = this.shadow.querySelector('.refresh-btn')
    refreshBtn?.addEventListener('click', () => this.loadTasks())
    
    this.renderBoard()
  }

  private renderBoard() {
    const board = this.shadow.querySelector('.board')
    if (!board) return

    const filteredItems = this.items.filter(item => {
      if (this.filter && !item.title.toLowerCase().includes(this.filter.toLowerCase())) {
        return false
      }
      if (this.assigneeFilter && item.metadata.assignee !== this.assigneeFilter) {
        return false
      }
      return true
    })

    board.innerHTML = COLUMNS.map(col => {
      const colItems = filteredItems.filter(i => i.column === col.id)
      return `
        <div class="column" data-column="${col.id}">
          <div class="column-header">
            <span class="icon">${col.icon}</span>
            <span class="name">${col.name}</span>
            <span class="count">${colItems.length}</span>
          </div>
          <div class="column-items" data-column="${col.id}">
            ${colItems.length === 0 
              ? `<div class="empty-column">No tasks</div>`
              : colItems.map(item => this.renderCard(item)).join('')
            }
          </div>
          <div class="quick-add">
            <button class="quick-add-btn" data-column="${col.id}">+ Add task</button>
          </div>
        </div>
      `
    }).join('')

    // Attach event listeners
    this.attachDragListeners()
    this.attachCardListeners()
    this.attachQuickAddListeners()
  }

  private renderCard(item: TaskItem): string {
    const tags: string[] = []
    
    if (item.metadata.assignee) {
      tags.push(`<span class="task-tag assignee">@${this.escapeHtml(item.metadata.assignee)}</span>`)
    }
    if (item.metadata.priority === 'high') {
      tags.push(`<span class="task-tag priority-high">High</span>`)
    } else if (item.metadata.priority === 'medium') {
      tags.push(`<span class="task-tag priority-medium">Medium</span>`)
    }
    for (const [key, value] of Object.entries(item.metadata)) {
      if (!['assignee', 'priority'].includes(key)) {
        tags.push(`<span class="task-tag">${this.escapeHtml(key)}: ${this.escapeHtml(value)}</span>`)
      }
    }

    return `
      <div class="task-card" draggable="true" data-id="${item.id}">
        <div class="task-title">${this.escapeHtml(item.title)}</div>
        ${tags.length ? `<div class="task-meta">${tags.join('')}</div>` : ''}
        <div class="task-actions">
          <button class="task-action edit-btn" data-id="${item.id}">Edit</button>
          <button class="task-action danger delete-btn" data-id="${item.id}">Delete</button>
        </div>
      </div>
    `
  }

  private attachDragListeners() {
    const cards = this.shadow.querySelectorAll('.task-card')
    const columns = this.shadow.querySelectorAll('.column-items')

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        const id = parseInt((e.target as HTMLElement).dataset.id || '0')
        this.draggedItem = this.items.find(i => i.id === id) || null
        ;(e.target as HTMLElement).classList.add('dragging')
      })

      card.addEventListener('dragend', (e) => {
        (e.target as HTMLElement).classList.remove('dragging')
        this.draggedItem = null
      })
    })

    columns.forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).closest('.column-items')?.classList.add('drag-over')
      })

      col.addEventListener('dragleave', (e) => {
        (e.target as HTMLElement).closest('.column-items')?.classList.remove('drag-over')
      })

      col.addEventListener('drop', async (e) => {
        e.preventDefault()
        const colEl = (e.target as HTMLElement).closest('.column-items')
        colEl?.classList.remove('drag-over')
        
        if (this.draggedItem && colEl) {
          const newColumn = colEl.dataset.column as ColumnId
          if (newColumn && newColumn !== this.draggedItem.column) {
            await this.moveTask(this.draggedItem.id, newColumn)
          }
        }
      })
    })
  }

  private attachCardListeners() {
    // Edit buttons
    this.shadow.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = parseInt((e.target as HTMLElement).dataset.id || '0')
        this.editTask(id)
      })
    })

    // Delete buttons
    this.shadow.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = parseInt((e.target as HTMLElement).dataset.id || '0')
        this.deleteTask(id)
      })
    })

    // Context menu on right-click
    this.shadow.querySelectorAll('.task-card').forEach(card => {
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        const id = parseInt((e.target as HTMLElement).closest('.task-card')?.dataset.id || '0')
        this.showContextMenu(e as MouseEvent, id)
      })
    })
  }

  private attachQuickAddListeners() {
    this.shadow.querySelectorAll('.quick-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const column = (e.target as HTMLElement).dataset.column as ColumnId
        this.showQuickAdd(e.target as HTMLElement, column)
      })
    })
  }

  private showQuickAdd(btn: HTMLElement, column: ColumnId) {
    const container = btn.parentElement!
    container.innerHTML = `<input type="text" class="quick-add-input" placeholder="Task title..." autofocus>`
    
    const input = container.querySelector('.quick-add-input') as HTMLInputElement
    input.focus()

    const finish = async () => {
      const title = input.value.trim()
      if (title) {
        await this.addTask(title, column)
      }
      container.innerHTML = `<button class="quick-add-btn" data-column="${column}">+ Add task</button>`
      this.attachQuickAddListeners()
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish()
      if (e.key === 'Escape') {
        container.innerHTML = `<button class="quick-add-btn" data-column="${column}">+ Add task</button>`
        this.attachQuickAddListeners()
      }
    })

    input.addEventListener('blur', finish)
  }

  private showContextMenu(e: MouseEvent, taskId: number) {
    this.hideContextMenu()
    
    const item = this.items.find(i => i.id === taskId)
    if (!item) return

    const menu = document.createElement('div')
    menu.className = 'context-menu'
    menu.style.left = `${e.clientX}px`
    menu.style.top = `${e.clientY}px`

    // Move to column options
    const moveOptions = COLUMNS
      .filter(c => c.id !== item.column)
      .map(c => `<button class="context-menu-item" data-action="move" data-column="${c.id}">${c.icon} Move to ${c.name}</button>`)
      .join('')

    menu.innerHTML = `
      ${moveOptions}
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" data-action="edit">✏️ Edit</button>
      <button class="context-menu-item danger" data-action="delete">🗑️ Delete</button>
    `

    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        const action = (e.target as HTMLElement).dataset.action
        const column = (e.target as HTMLElement).dataset.column as ColumnId
        
        if (action === 'move' && column) {
          await this.moveTask(taskId, column)
        } else if (action === 'edit') {
          this.editTask(taskId)
        } else if (action === 'delete') {
          await this.deleteTask(taskId)
        }
        
        this.hideContextMenu()
      })
    })

    this.shadow.appendChild(menu)
    this.contextMenu = menu
  }

  private hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove()
      this.contextMenu = null
    }
  }

  private editTask(taskId: number) {
    const card = this.shadow.querySelector(`.task-card[data-id="${taskId}"]`)
    const titleEl = card?.querySelector('.task-title')
    if (!titleEl) return

    titleEl.setAttribute('contenteditable', 'true')
    ;(titleEl as HTMLElement).focus()

    // Select all text
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)

    const finish = async () => {
      titleEl.removeAttribute('contenteditable')
      const newTitle = titleEl.textContent?.trim()
      const item = this.items.find(i => i.id === taskId)
      if (newTitle && item && newTitle !== item.title) {
        await this.updateTaskTitle(taskId, newTitle)
      }
    }

    titleEl.addEventListener('blur', finish, { once: true })
    titleEl.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault()
        ;(titleEl as HTMLElement).blur()
      }
      if ((e as KeyboardEvent).key === 'Escape') {
        const item = this.items.find(i => i.id === taskId)
        titleEl.textContent = item?.title || ''
        ;(titleEl as HTMLElement).blur()
      }
    })
  }

  // API Methods

  private async addTask(title: string, column: ColumnId) {
    try {
      await fetch(`${this.server}/terminal/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tasks', command: `add ${title}` })
      })
      // If not adding to default column (queued), move it
      if (column !== 'queued') {
        // We need to reload to get the new item's ID, then move it
        await this.loadTasks()
        const newItem = this.items.find(i => i.title === title && i.column === 'queued')
        if (newItem) {
          await this.moveTask(newItem.id, column)
        }
      } else {
        await this.loadTasks()
      }
    } catch (err) {
      console.error('[task-board] Failed to add task:', err)
    }
  }

  private async moveTask(taskId: number, column: ColumnId) {
    try {
      await fetch(`${this.server}/terminal/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tasks', command: `move ${taskId} ${column}` })
      })
      await this.loadTasks()
    } catch (err) {
      console.error('[task-board] Failed to move task:', err)
    }
  }

  private async updateTaskTitle(taskId: number, newTitle: string) {
    try {
      await fetch(`${this.server}/terminal/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tasks', command: `edit ${taskId} ${newTitle}` })
      })
      await this.loadTasks()
    } catch (err) {
      console.error('[task-board] Failed to update task:', err)
    }
  }

  private async deleteTask(taskId: number) {
    try {
      await fetch(`${this.server}/terminal/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'tasks', command: `trash ${taskId}` })
      })
      await this.loadTasks()
    } catch (err) {
      console.error('[task-board] Failed to delete task:', err)
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}

// Register the custom element
customElements.define('task-board', TaskBoard)
