import { ICONS, type IconName, type Part } from './iconPaths'

export type { IconName }

/** 그림 한 벌(iconPaths)을 그리는 부품 — 켜지면(active) 닫힌 면을 채운다 */
export function Icon({
  name,
  size = 22,
  active = false,
  className,
  title,
}: {
  name: IconName
  size?: number
  active?: boolean
  className?: string
  /** 그림만 있는 단추에는 단추 쪽 aria-label 을 쓴다. 이것은 그림이 뜻을 혼자 말할 때만 */
  title?: string
}) {
  const parts: readonly Part[] = ICONS[name]
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      data-icon={name}
    >
      {parts.map(([d, closed, knock], i) =>
        active && closed ? (
          <path key={i} d={d} fill="currentColor" />
        ) : active && knock ? (
          <path key={i} d={d} className="icon-knock" />
        ) : (
          <path key={i} d={d} />
        ),
      )}
    </svg>
  )
}
