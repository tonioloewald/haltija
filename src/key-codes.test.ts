import { describe, expect, test } from 'bun:test'
import { keyToCode } from './key-codes'

describe('keyToCode', () => {
  test('letters map to KeyX', () => {
    expect(keyToCode('a')).toBe('KeyA')
    expect(keyToCode('Z')).toBe('KeyZ')
  })

  test('digits map to DigitX', () => {
    expect(keyToCode('0')).toBe('Digit0')
    expect(keyToCode('9')).toBe('Digit9')
  })

  // Regression: the active getKeyCode previously dropped punctuation, so typing
  // "." emitted code "." instead of "Period". (Two getKeyCode methods existed;
  // the punctuation-aware one was shadowed.)
  test('punctuation characters map to their physical codes', () => {
    expect(keyToCode('.')).toBe('Period')
    expect(keyToCode(',')).toBe('Comma')
    expect(keyToCode('/')).toBe('Slash')
    expect(keyToCode(';')).toBe('Semicolon')
    expect(keyToCode("'")).toBe('Quote')
    expect(keyToCode('[')).toBe('BracketLeft')
    expect(keyToCode(']')).toBe('BracketRight')
    expect(keyToCode('\\')).toBe('Backslash')
    expect(keyToCode('-')).toBe('Minus')
    expect(keyToCode('=')).toBe('Equal')
    expect(keyToCode('`')).toBe('Backquote')
  })

  test('space maps to Space (both " " and "Space")', () => {
    expect(keyToCode(' ')).toBe('Space')
    expect(keyToCode('Space')).toBe('Space')
  })

  test('named keys pass through', () => {
    expect(keyToCode('Enter')).toBe('Enter')
    expect(keyToCode('Escape')).toBe('Escape')
    expect(keyToCode('Backspace')).toBe('Backspace')
    expect(keyToCode('ArrowLeft')).toBe('ArrowLeft')
    expect(keyToCode('PageDown')).toBe('PageDown')
  })

  test('function keys pass through', () => {
    expect(keyToCode('F1')).toBe('F1')
    expect(keyToCode('F12')).toBe('F12')
  })

  test('unknown keys fall back to the key itself', () => {
    expect(keyToCode('Unidentified')).toBe('Unidentified')
  })
})
