// quest-panel.jsx — rechtes Detail-Panel im Codex-Stil (qpanel__* / qrow* CSS).

const { useState: qpUseState } = React;

function flatLeaves(node, out = []) {
  const kids = node.children || [];
  if (!kids.length) { out.push(node); return out; }
  for (const k of kids) flatLeaves(k, out);
  return out;
}

function nodeIsDone(n) {
  if (n.state === 'done') return true;
  if (!n.children?.length) return false;
  return n.children.every(nodeIsDone);
}

function nodeIsLocked(n) {
  return n.state === 'locked';
}

function questProgressPct(quest) {
  if (typeof quest.progress === 'number') return Math.round(quest.progress * 100);
  const leaves = flatLeaves(quest);
  if (!leaves.length) return 0;
  const done = leaves.filter((l) => l.state === 'done').length;
  return Math.round((done / leaves.length) * 100);
}

function statusEyebrow(status) {
  return ({
    active: 'Aktive Quest',
    'unlocked-not-added': 'Verfügbar',
    locked: 'Verschlossen',
    done: 'Vollendet',
  })[status] || 'Quest';
}

function QRow({ node, depth, selectedNodeId, onSelectNode }) {
  const hasKids = !!node.children?.length;
  const [open, setOpen] = qpUseState(true);
  const done = nodeIsDone(node);
  const locked = nodeIsLocked(node);
  const active = node.state === 'active';
  const unadded = node.state === 'unlocked-not-added';
  const sel = selectedNodeId === node.id;

  const cls = [
    'qrow',
    sel && 'qrow--sel',
    done && 'qrow--done qg-node--done',
    locked && 'qg-node--locked',
  ].filter(Boolean).join(' ');

  return (
    <li className={cls}>
      <div
        className="qrow__line"
        onClick={() => onSelectNode?.(node.id)}
      >
        <button
          type="button"
          className="qrow__caret"
          onClick={(e) => { e.stopPropagation(); if (hasKids) setOpen((o) => !o); }}
          disabled={!hasKids}
          aria-label={hasKids ? (open ? 'Einklappen' : 'Ausklappen') : ''}
        >
          {hasKids ? (open ? '▾' : '▸') : '·'}
        </button>
        <div className="qrow__icon" aria-hidden="true">
          {done ? <span className="qrow__check">✓</span>
            : locked ? <span className="qrow__lock">🔒</span>
            : active ? <span className="qrow__active" />
            : unadded ? <span className="qrow__unadded" />
            : <span className="qrow__bullet" />}
        </div>
        <div className="qrow__body">
          <div className="qrow__title">{node.title}</div>
          {node.desc && <div className="qrow__desc">{node.desc}</div>}
        </div>
        <div className="qrow__meta">
          {typeof node.progress === 'number' && node.progress > 0 && node.progress < 1 && (
            <span className="qrow__pct">{Math.round(node.progress * 100)}%</span>
          )}
          {node.urgent && <span className="qrow__urgent">!</span>}
        </div>
      </div>
      {hasKids && open && (
        <ul className="qpanel__branch qrow__children">
          {node.children.map((c) => (
            <QRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function QuestPanel({ quest, onClose, onSelectNode, selectedNodeId }) {
  if (!quest) return null;
  const pct = questProgressPct(quest);

  return (
    <aside className="qpanel" aria-label="Quest-Details">
      <div className="qpanel__rim" />
      <button type="button" className="qpanel__close" onClick={onClose} aria-label="Schließen">×</button>

      <header className="qpanel__crest">
        <svg className="qpanel__sigil" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
          <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.35" />
          <path d="M30 8 L34 26 L52 30 L34 34 L30 52 L26 34 L8 30 L26 26 Z" fill="currentColor" opacity="0.85" />
        </svg>
        <div className="qpanel__title-block">
          <div className="qpanel__eyebrow">{statusEyebrow(quest.status)} · {quest.cityLocation || '—'}</div>
          <h2 className="qpanel__title">{quest.title}</h2>
          {quest.questmaker && <p className="qpanel__sub">{quest.questmaker}</p>}
        </div>
      </header>

      {quest.status === 'active' && (
        <div className="qpanel__meter">
          <div className="qpanel__meter-rail">
            <div className="qpanel__meter-fill" style={{ width: `${pct}%` }} />
            <div className="qpanel__meter-glow" style={{ width: `${pct}%` }} />
          </div>
          <div className="qpanel__meter-label">
            <span>Fortschritt</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}

      {quest.rewards?.length > 0 && (
        <div className="qpanel__rewards">
          <div className="qpanel__section-label">Belohnungen</div>
          <div className="qpanel__rewards-row">
            {quest.rewards.map((r, i) => (
              <span key={i} className={`reward reward--${r.kind}`}>
                <span className="reward__icon">{r.icon}</span>
                <span>{r.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="qpanel__tree">
        <div className="qpanel__section-label">Zweige</div>
        <ul className="qpanel__branch qpanel__branch--d0">
          {(quest.children || []).map((c) => (
            <QRow
              key={c.id}
              node={c}
              depth={0}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
          {(!quest.children || quest.children.length === 0) && (
            <li className="qrow">
              <div className="qrow__line">
                <span className="qrow__caret" aria-hidden="true">·</span>
                <div className="qrow__icon"><span className="qrow__bullet" /></div>
                <div className="qrow__body">
                  <div className="qrow__title" style={{ fontStyle: 'italic', opacity: 0.7 }}>Noch keine Zweige.</div>
                </div>
              </div>
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

window.QuestPanel = QuestPanel;
