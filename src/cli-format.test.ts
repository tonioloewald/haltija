import { describe, test, expect } from 'bun:test'
import { formatTree } from '../bin/format-tree.mjs'

// Fixture matching real DomTreeNode structure from the Haltija server
const SIGNUP_FORM_FIXTURE = {
  tag: 'body',
  ref: '1',
  flags: { focused: true },
  children: [
    { tag: 'h1', ref: '2', text: 'Sign Up' },
    {
      tag: 'div',
      ref: '3',
      classes: ['form-row'],
      children: [
        { tag: 'label', ref: '4', text: 'Email:' },
        {
          tag: 'input',
          ref: '5',
          id: 'email-input',
          attrs: { type: 'email', placeholder: 'you@example.com' },
          flags: { interactive: true },
        },
      ],
    },
    {
      tag: 'div',
      ref: '6',
      classes: ['form-row'],
      children: [
        { tag: 'label', ref: '7', text: 'Password:' },
        {
          tag: 'input',
          ref: '8',
          attrs: { type: 'password' },
          flags: { interactive: true },
        },
      ],
    },
    {
      tag: 'button',
      ref: '9',
      id: 'btn-submit',
      text: 'Create Account',
      flags: { interactive: true },
    },
    {
      tag: 'p',
      ref: '10',
      children: [
        {
          tag: 'a',
          ref: '11',
          attrs: { href: '/login' },
          flags: { interactive: true },
          text: 'Already have an account?',
        },
      ],
    },
    {
      tag: 'div',
      ref: '12',
      flags: { hidden: true, hiddenReason: 'display' },
      text: 'Error: invalid email',
    },
  ],
}

// More complex fixture with form values, checkboxes, selects, truncation
const COMPLEX_FORM_FIXTURE = {
  tag: 'form',
  ref: '20',
  id: 'checkout',
  classes: ['checkout-form', 'validated'],
  children: [
    {
      tag: 'input',
      ref: '21',
      attrs: { type: 'text', name: 'name' },
      value: 'John Doe',
      flags: { interactive: true, required: true },
    },
    {
      tag: 'input',
      ref: '22',
      attrs: { type: 'checkbox' },
      checked: true,
      flags: { interactive: true },
    },
    {
      tag: 'input',
      ref: '23',
      attrs: { type: 'checkbox' },
      checked: false,
      flags: { interactive: true },
    },
    {
      tag: 'select',
      ref: '24',
      flags: { interactive: true },
      value: 'express',
      children: [
        { tag: 'option', ref: '25', attrs: { value: 'standard' }, text: 'Standard' },
        { tag: 'option', ref: '26', attrs: { value: 'express' }, text: 'Express' },
      ],
    },
    {
      tag: 'div',
      ref: '27',
      classes: ['items'],
      truncated: true,
      childCount: 15,
    },
    {
      tag: 'button',
      ref: '28',
      flags: { interactive: true, disabled: true },
      text: 'Place Order',
    },
    {
      tag: 'input',
      ref: '29',
      attrs: { type: 'text' },
      flags: { interactive: true, readOnly: true },
      value: 'readonly field',
    },
  ],
}

// Fixture with haltija widget (should be skipped)
const WITH_WIDGET_FIXTURE = {
  tag: 'body',
  ref: '1',
  children: [
    { tag: 'h1', ref: '2', text: 'Hello' },
    {
      tag: 'haltija-dev',
      ref: '99',
      id: 'haltija-widget',
      flags: { customElement: true, shadowRoot: true },
      shadowChildren: [
        { tag: 'div', ref: '100', classes: ['widget'] },
      ],
    },
  ],
}

// Fixture with long text and attribute values
const LONG_TEXT_FIXTURE = {
  tag: 'div',
  ref: '30',
  children: [
    {
      tag: 'p',
      ref: '31',
      text: 'This is a very long paragraph that should be truncated at some point because it exceeds the maximum length we want to display in the tree output format',
    },
    {
      tag: 'a',
      ref: '32',
      attrs: { href: 'https://example.com/very/long/path/that/goes/on/and/on/forever' },
      flags: { interactive: true },
      text: 'Click here',
    },
    {
      tag: 'div',
      ref: '33',
      attrs: { 'data-tooltip': 'This has spaces in the value' },
      text: 'Hover me',
    },
  ],
}

describe('formatTree', () => {
  test('formats basic signup form with paren hierarchy', () => {
    const output = formatTree(SIGNUP_FORM_FIXTURE)
    const lines = output.split('\n')

    // Root has children → push paren
    expect(lines[0]).toBe('( 1 body focused')
    // Leaf child (h1 has no children)
    expect(lines[1]).toBe('  2 h1 "Sign Up"')
    // Nested container with children
    expect(lines[2]).toBe('  ( 3 div.form-row')
    expect(lines[3]).toBe('    4 label "Email:"')
    expect(lines[4]).toBe('    5 input#email-input type=email placeholder=you@example.com interactive')
    expect(lines[5]).toBe('  )')
    expect(lines[6]).toBe('  ( 6 div.form-row')
    expect(lines[7]).toBe('    7 label "Password:"')
    expect(lines[8]).toBe('    8 input type=password interactive')
    expect(lines[9]).toBe('  )')
    // Leaf button (no children)
    expect(lines[10]).toBe('  9 button#btn-submit interactive "Create Account"')
    // p with one child
    expect(lines[11]).toBe('  ( 10 p')
    expect(lines[12]).toBe('    11 a href=/login interactive "Already have an account?"')
    expect(lines[13]).toBe('  )')
    // Hidden leaf
    expect(lines[14]).toBe('  12 div hidden:display "Error: invalid email"')
    // Close root
    expect(lines[15]).toBe(')')
    // Footer
    expect(lines[16]).toBe('---')
    expect(lines[17]).toBe('hj tree --json')
  })

  test('formats form values and checkboxes', () => {
    const output = formatTree(COMPLEX_FORM_FIXTURE)
    const lines = output.split('\n')

    // Form element with id and classes — has children so gets paren
    expect(lines[0]).toBe('( 20 form#checkout.checkout-form.validated')

    // Input with value and flags (bare, no brackets)
    expect(lines[1]).toContain('value="John Doe"')
    expect(lines[1]).toContain('interactive required')

    // Checked checkbox (bare word)
    expect(lines[2]).toContain('checked')
    expect(lines[2]).toContain('interactive')

    // Unchecked checkbox
    expect(lines[3]).toContain('unchecked')

    // Select with value (has children → paren)
    expect(lines[4]).toContain('( 24 select')
    expect(lines[4]).toContain('value="express"')

    // Truncated children
    expect(output).toContain('(15 children)')

    // Disabled button (bare flags)
    expect(output).toContain('interactive disabled')

    // Readonly input
    expect(output).toContain('interactive readonly')
  })

  test('skips haltija widget node', () => {
    const output = formatTree(WITH_WIDGET_FIXTURE)
    expect(output).not.toContain('haltija-dev')
    expect(output).not.toContain('99')
    expect(output).toContain('( 1 body')
    expect(output).toContain('2 h1 "Hello"')
  })

  test('truncates long text', () => {
    const output = formatTree(LONG_TEXT_FIXTURE)
    const lines = output.split('\n')

    // Long paragraph should be truncated
    const pLine = lines.find(l => l.includes('31 p'))
    expect(pLine).toBeDefined()
    expect(pLine!.includes('…')).toBe(true)
    expect(pLine!.length).toBeLessThan(200)
  })

  test('quotes attribute values with spaces', () => {
    const output = formatTree(LONG_TEXT_FIXTURE)
    expect(output).toContain('data-tooltip="This has spaces in the value"')
  })

  test('handles empty/null nodes', () => {
    expect(formatTree(null)).toBe('')
    expect(formatTree(undefined)).toBe('')
  })

  test('handles node with no children or text', () => {
    const output = formatTree({ tag: 'div', ref: '1', classes: ['container'] })
    // Leaf node, no parens
    expect(output).toContain('1 div.container')
    expect(output).toContain('---')
    expect(output).toContain('hj tree --json')
  })

  test('handles deeply nested structure', () => {
    const deep = {
      tag: 'div', ref: '1', children: [{
        tag: 'div', ref: '2', children: [{
          tag: 'div', ref: '3', children: [{
            tag: 'span', ref: '4', text: 'Deep'
          }]
        }]
      }]
    }
    const output = formatTree(deep)
    // Each level pushes 2 spaces
    expect(output).toContain('( 1 div')
    expect(output).toContain('  ( 2 div')
    expect(output).toContain('    ( 3 div')
    expect(output).toContain('      4 span "Deep"')
    expect(output).toContain('    )')
    expect(output).toContain('  )')
    expect(output).toContain(')')
  })

  test('includes ARIA flag as bare word', () => {
    const node = { tag: 'button', ref: '1', flags: { interactive: true, hasAria: true }, text: 'Close' }
    const output = formatTree(node)
    expect(output).toContain('interactive aria')
    // No brackets
    expect(output).not.toContain('[')
    expect(output).not.toContain(']')
  })

  test('shows offscreen flag when not hidden', () => {
    const node = { tag: 'div', ref: '1', flags: { offScreen: true }, text: 'Off' }
    expect(formatTree(node)).toContain('offscreen')
  })

  test('does not show offscreen when already hidden', () => {
    const node = { tag: 'div', ref: '1', flags: { hidden: true, hiddenReason: 'display', offScreen: true }, text: 'Off' }
    const output = formatTree(node)
    expect(output).toContain('hidden:display')
    expect(output).not.toContain('offscreen')
  })

  test('footer is always present', () => {
    const output = formatTree({ tag: 'div', ref: '1' })
    expect(output).toEndWith('---\nhj tree --json')
  })

  test('no colon after ref numbers', () => {
    const output = formatTree(SIGNUP_FORM_FIXTURE)
    // Should not have patterns like "1:" or "2:"
    expect(output).not.toMatch(/\d+:/)
  })

  test('no bracket-wrapped flags', () => {
    const output = formatTree(SIGNUP_FORM_FIXTURE)
    // Should not have [interactive] or [hidden:display] patterns
    expect(output).not.toMatch(/\[interactive\]/)
    expect(output).not.toMatch(/\[hidden:/)
    expect(output).not.toMatch(/\[focused\]/)
  })
})

describe('formatTree generates doc-compatible output', () => {
  test('signup form contains key elements', () => {
    const output = formatTree(SIGNUP_FORM_FIXTURE)
    expect(output).toContain('5 input#email-input')
    expect(output).toContain('interactive')
    expect(output).toContain('9 button#btn-submit')
    expect(output).toContain('"Create Account"')
    expect(output).toContain('hidden:display')
    expect(output).toContain('"Error: invalid email"')
  })
})

// Export fixtures for use in snapshot generation
export { SIGNUP_FORM_FIXTURE, COMPLEX_FORM_FIXTURE }
