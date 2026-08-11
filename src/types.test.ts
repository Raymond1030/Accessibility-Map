import { describe, it, expect } from 'vitest'
import { cellKey } from './types'

describe('cellKey', () => {
  it('把起点与档位拼成稳定的键', () => {
    expect(cellKey('o1', 30)).toBe('o1@30')
  })

  it('不同档位产生不同的键', () => {
    expect(cellKey('o1', 15)).not.toBe(cellKey('o1', 30))
  })
})
