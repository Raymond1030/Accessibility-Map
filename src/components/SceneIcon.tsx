import type { Scene } from '../state/navigation'

/** 三个场景的线性图标：生活探索＝指南针，租房通勤＝房子，多点见面＝两个相交的圈。 */
export function SceneIcon({ scene, size = 18 }: { scene: Scene; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {scene === 'explore' ? <><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2z" /></> : scene === 'commute' ? <><path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7" /></> : <><circle cx="8.5" cy="12" r="6.5" /><circle cx="15.5" cy="12" r="6.5" /></>}
  </svg>
}
