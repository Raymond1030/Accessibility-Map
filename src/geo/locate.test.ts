import { describe, it, expect } from 'vitest'
import { describeGeolocationError, GEO_UNSUPPORTED, OUT_OF_CHINA_HINT } from './locate'

describe('describeGeolocationError', () => {
  it('权限被拒时告诉用户去哪儿改，并给出替代路径', () => {
    const msg = describeGeolocationError({ code: 1, message: '' })
    expect(msg).toContain('权限')
    expect(msg).toContain('搜索')
  })

  it('信号不可用时说明常见场景，避免用户以为是程序坏了', () => {
    const msg = describeGeolocationError({ code: 2, message: '' })
    expect(msg).toContain('信号')
    expect(msg).toContain('搜索')
  })

  it('超时提示可以重试', () => {
    const msg = describeGeolocationError({ code: 3, message: '' })
    expect(msg).toContain('超时')
    expect(msg).toContain('再试')
  })

  it('未知错误码不会得到空文案', () => {
    const msg = describeGeolocationError({ code: 99, message: '' })
    expect(msg.length).toBeGreaterThan(0)
    expect(msg).toContain('搜索')
  })

  it('每类失败都指出补救办法——失败不该变成无头公案', () => {
    for (const code of [1, 2, 3, 99]) {
      expect(describeGeolocationError({ code, message: '' })).toContain('搜索')
    }
  })
})

describe('固定文案', () => {
  it('不支持定位时提示改用搜索', () => {
    expect(GEO_UNSUPPORTED).toContain('搜索')
  })

  it('境外提示点明本工具只覆盖国内——否则用户只会看到空结果而困惑', () => {
    expect(OUT_OF_CHINA_HINT).toContain('中国大陆')
  })
})
