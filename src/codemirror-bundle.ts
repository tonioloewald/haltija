/**
 * CodeMirror 6 bundle entry point.
 * Built into an IIFE that exposes everything on window.CM.
 * Used by terminal.html for the file viewer pane.
 */

// Core
export { EditorState } from '@codemirror/state'
export { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view'
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
export {
  syntaxHighlighting,
  defaultHighlightStyle,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from '@codemirror/language'

// Theme
export { oneDark } from '@codemirror/theme-one-dark'

// Languages
export { javascript } from '@codemirror/lang-javascript'
export { html } from '@codemirror/lang-html'
export { css } from '@codemirror/lang-css'
export { json } from '@codemirror/lang-json'
export { markdown } from '@codemirror/lang-markdown'
export { python } from '@codemirror/lang-python'
