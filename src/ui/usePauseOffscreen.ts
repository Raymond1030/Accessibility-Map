import { useEffect, type RefObject } from 'react'

/**
 * 首页的循环动画（光晕漂移、渐变标题、加载脉冲等）滚出屏幕后暂停，回到附近再继续，
 * 避免页面一直重绘耗电。匹配 selector 的元素离开视口（上下各留 150px 余量）时写入
 * data-offscreen，由 CSS 暂停其内部所有动画（见 Welcome.css）。
 */
export function usePauseOffscreen(root: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const element = root.current
    if (!element || !('IntersectionObserver' in window)) return
    const targets = [...element.querySelectorAll<HTMLElement>(selector)]
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) entry.target.toggleAttribute('data-offscreen', !entry.isIntersecting)
    }, { rootMargin: '150px 0px' })
    targets.forEach(target => observer.observe(target))
    return () => {
      observer.disconnect()
      targets.forEach(target => target.removeAttribute('data-offscreen'))
    }
  }, [root, selector])
}
