/**
 * 高德的配置类错误——这些失败重试一万次也不会好，必须人去控制台改设置。
 * 与之相对，超时、NO_DATA 这类是运行时状况，只标记单格失败即可，不该弹全局横幅。
 */
const CONFIG_ERRORS: Array<{ code: string; explain: string }> = [
  {
    code: 'INVALID_USER_DOMAIN',
    explain: '当前域名不在该 Key 的白名单里。到高德控制台 → 应用管理 → 编辑 Key，' +
      '把当前域名加进「域名白名单」；本地开发需要加 localhost。',
  },
  {
    code: 'INVALID_USER_SCODE',
    explain: '安全密钥（securityJsCode）不正确，或与该 Key 不匹配。',
  },
  {
    code: 'INVALID_USER_KEY',
    explain: 'Key 无效或已被删除。',
  },
  {
    code: 'USERKEY_PLAT_NOMATCH',
    explain: 'Key 的平台类型不对。本应用需要「Web端（JS API）」类型的 Key，' +
      '不能用「Web服务」类型。',
  },
  {
    code: 'DAILY_QUERY_OVER_LIMIT',
    explain: '今日调用配额已用完。',
  },
  {
    code: 'SERVICE_NOT_AVAILABLE',
    explain: '该 Key 未开通所需的服务权限。',
  },
  {
    code: 'INSUFFICIENT_PRIVILEGES',
    explain: '权限不足，该 Key 无权调用此服务。',
  },
]

export function isConfigError(message: string): boolean {
  return CONFIG_ERRORS.some((e) => message.includes(e.code))
}

/** 把裸错误码翻译成能照着做的指引，同时保留原始码便于搜索 */
export function describeConfigError(message: string): string {
  const hit = CONFIG_ERRORS.find((e) => message.includes(e.code))
  if (!hit) return message
  return `${hit.explain}（原始错误：${hit.code}）`
}
