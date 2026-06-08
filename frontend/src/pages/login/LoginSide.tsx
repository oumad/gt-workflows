export function LoginSide() {
  return (
    <aside className="login-side">
      <div className="login-brand">
        <div className="brand-mark" style={{ width: 36, height: 36, fontSize: 18 }}>
          ☕
        </div>
        <div>
          <div className="brand-name" style={{ fontSize: 18 }}>
            GT Coffee Maker
          </div>
          <div className="brand-sub">internal tools</div>
        </div>
      </div>

      <div className="login-side-art">
        <div className="login-art-blob" style={{ background: 'var(--accent)' }} />
        <div
          className="login-art-blob"
          style={{
            background: 'var(--pop-purple)',
            top: '55%',
            left: '8%',
            width: 180,
            height: 180,
          }}
        />
        <div
          className="login-art-blob"
          style={{
            background: 'var(--pop-cyan)',
            top: '10%',
            left: '55%',
            width: 140,
            height: 140,
          }}
        />
        <div className="login-art-grid" />
      </div>

      <div className="login-side-copy">
        <div className="kicker">Hub · v3.4</div>
        <h2>
          Run pipelines.
          <br />
          Train models.
          <br />
          Heal the cluster.
        </h2>
        <p>
          One door into all of the studio's internal tools — workflows, services, doctor and the
          rest.
        </p>
      </div>
    </aside>
  )
}
