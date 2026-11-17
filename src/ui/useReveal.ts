import { useLayoutEffect, type RefObject } from 'react'

/**
 * 滚动入场：root 内带 data-reveal 的元素进入视口时写入 data-revealed，动画由 CSS 完成
 * （见 App.css 的 reveal-in）。root 加上 reveal-ready 之前内容始终可见；
 * 浏览器不支持 IntersectionObserver 或用户选择减少动态效果时，直接全部显示。
 */
export function useReveal(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const targets = [...element.querySelectorAll<HTMLElement>('[data-reveal]')]
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!('IntersectionObserver' in window) || reduceMotion) {
      targets.forEach(target => target.setAttribute('data-revealed', ''))
      return
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.setAttribute('data-revealed', '')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    targets.forEach(target => observer.observe(target))
    element.classList.add('reveal-ready')
    return () => {
      observer.disconnect()
      element.classList.remove('reveal-ready')
    }
  }, [root])
}
