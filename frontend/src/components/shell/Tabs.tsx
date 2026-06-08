type Tab = { id: string; label: string; pill?: number | string }

type Props = {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  trailing?: React.ReactNode
}

export function Tabs({ tabs, active, onChange, trailing }: Props) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab${active === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.pill != null && <span className="pill">{t.pill}</span>}
        </button>
      ))}
      {trailing && (
        <>
          <span style={{ flex: 1 }} />
          <div className="row" style={{ alignSelf: 'center', paddingBottom: 4 }}>
            {trailing}
          </div>
        </>
      )}
    </div>
  )
}
