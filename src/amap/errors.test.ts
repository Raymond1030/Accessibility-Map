import { describe, it, expect } from 'vitest'
import { isConfigError, describeConfigError } from './errors'

describe('isConfigError', () => {
  it('域名未授权是配置问题', () => {
    expect(isConfigError('高德到达圈请求失败：INVALID_USER_DOMAIN')).toBe(true)
  })

  it('Key 无效是配置问题', () => {
    expect(isConfigError('INVALID_USER_KEY')).toBe(true)
  })

  it('安全密钥错误是配置问题', () => {
    expect(isConfigError('INVALID_USER_SCODE')).toBe(true)
  })

  it('Key 平台类型不匹配是配置问题', () => {
    expect(isConfigError('USERKEY_PLAT_NOMATCH')).toBe(true)
  })

  it('日配额超限是配置问题', () => {
    expect(isConfigError('DAILY_QUERY_OVER_LIMIT')).toBe(true)
  })

  it('超时不是配置问题——它可能只是这一次网络慢，不该弹全局横幅', () => {
    expect(isConfigError('等时圈请求超时（30 分钟档，等待 10000ms 无响应）')).toBe(false)
  })

  it('普通业务失败不是配置问题', () => {
    expect(isConfigError('高德到达圈请求失败：NO_DATA')).toBe(false)
  })
})

describe('describeConfigError', () => {
  it('域名未授权给出可操作的指引，而不是只丢一个错误码', () => {
    const msg = describeConfigError('高德到达圈请求失败：INVALID_USER_DOMAIN')
    expect(msg).toContain('白名单')
    expect(msg).toContain('INVALID_USER_DOMAIN')
  })

  it('安全密钥错误点明是密钥而非 Key', () => {
    expect(describeConfigError('INVALID_USER_SCODE')).toContain('安全密钥')
  })

  it('平台不匹配点明要用 Web端 JS API 类型', () => {
    expect(describeConfigError('USERKEY_PLAT_NOMATCH')).toContain('JS API')
  })

  it('无法识别的错误原样透出，不吞掉信息', () => {
    expect(describeConfigError('SOME_UNKNOWN_CODE')).toContain('SOME_UNKNOWN_CODE')
  })
})
