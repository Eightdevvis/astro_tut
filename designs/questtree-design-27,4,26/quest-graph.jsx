// Quest Graph — central canvas with nodes (shape-by-children-count) and
// edges with progress fill. Subnodes can expand/collapse inline like a skill tree.

// Geometry helpers (lifted from existing rpg-tree-svg.js)
function nodeShapePath(childCount, r) {
  const c = Math.max(0, Math.floor(childCount || 0));
  if (c === 0) return null; // circle
  if (c === 1) {
    const top = -r * 1.08, bot = r * 1.02, side = r * 0.78;
    return `M0 ${top} Q ${side} ${-r * 0.2} ${side * 0.55} ${bot} Q 0 ${r * 1.18} ${-side * 0.55} ${bot} Q ${-side} ${-r * 0.2} 0 ${top} Z`;
  }
  if (c === 2) {
    const l = -r * 1.08, rg = r * 1.08, b = r * 0.7;
    return `M${l} 0 Q 0 ${-b} ${rg} 0 Q 0 ${b} ${l} 0 Z`;
  }
  let d = '';
  for (let i = 0; i < c; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / c;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    d += `${i === 0 ? 'M' : 'L'}${x} ${y} `;
  }
  return d + 'Z';
}

// Recursive progress: leaf = done?1:0; container = avg of children
function nodeProgress(node) {
  if (node.state === 'done') return 1;
  const kids = node.children || [];
  if (kids.length === 0) {
    if (node.state === 'active') return node.progress ?? 0.5;
    return 0;
  }
  return kids.reduce((s, k) => s + nodeProgress(k), 0) / kids.length;
}

function nodeStateClass(node) {
  if (node.state === 'done') return 'qg-node--done';
  if (node.state === 'active') return 'qg-node--active';
  if (node.state === 'locked') return 'qg-node--locked';
  if (node.state === 'unlocked-not-added') return 'qg-node--unadded';
  return 'qg-node--idle';
}

// Layered layout: root at top, children fan downward
function layoutQuest(quest, originX, originY, opts = {}) {
  const layerH = opts.layerH || 110;
  const sib = opts.siblingGap || 110;
  const positions = [];
  const edges = [];

  function place(node, depth, xCenter) {
    const kids = node.children || [];
    if (kids.length === 0) {
      positions.push({ node, x: xCenter, y: originY + depth * layerH, depth });
      return { x: xCenter, width: sib };
    }
    let totalW = 0;
    const childInfos = [];
    for (const k of kids) {
      const w = subtreeWidth(k);
      childInfos.push({ k, w });
      totalW += w;
    }
    let cursor = xCenter - totalW / 2;
    for (const { k, w } of childInfos) {
      const ckx = cursor + w / 2;
      place(k, depth + 1, ckx);
      cursor += w;
      edges.push({ from: node, to: k, fromXY: [xCenter, originY + depth * layerH], toXY: [ckx, originY + (depth + 1) * layerH] });
    }
    positions.push({ node, x: xCenter, y: originY + depth * layerH, depth });
    return { x: xCenter, width: totalW };
  }
  function subtreeWidth(node) {
    const kids = node.children || [];
    if (kids.length === 0) return sib;
    return kids.reduce((s, k) => s + subtreeWidth(k), 0);
  }

  place(quest, 0, originX);
  return { positions, edges };
}

function QuestGraph({ quests, selectedId, onSelect, expanded, onToggleExpand, edgeStyle = 'curve' }) {
  // Distribute quests horizontally; each quest gets a column
  const layout = React.useMemo(() => {
    const all = { positions: [], edges: [], questBounds: {} };
    let cursorX = 240;
    const COLW = 360;
    const ROOT_Y = 120;
    quests.forEach((q) => {
      // build local tree from quest children if expanded
      const isExpanded = expanded[q.id] !== false;
      const treeRoot = {
        id: q.id, title: q.title, state: q.status,
        children: isExpanded ? (q.children || []) : [],
      };
      const { positions, edges } = layoutQuest(treeRoot, cursorX, ROOT_Y, { layerH: 110, siblingGap: 130 });
      all.positions.push(...positions);
      all.edges.push(...edges);
      const xs = positions.map(p => p.x);
      const ys = positions.map(p => p.y);
      all.questBounds[q.id] = {
        minX: Math.min(...xs) - 80, maxX: Math.max(...xs) + 80,
        minY: Math.min(...ys) - 80, maxY: Math.max(...ys) + 80,
      };
      cursorX += COLW;
    });
    return all;
  }, [quests, expanded]);

  function nodeRadius(node) {
    if (node.id && quests.find(q => q.id === node.id)) return 36; // root quest
    const kc = (node.children || []).length;
    if (kc === 0) return 18;
    return 22 + Math.min(kc, 4) * 2;
  }

  function edgePath(e) {
    const [x1, y1] = e.fromXY;
    const [x2, y2] = e.toXY;
    if (edgeStyle === 'straight') return `M ${x1} ${y1} L ${x2} ${y2}`;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }

  return (
    <svg className="qg-svg" viewBox="0 0 2000 1000" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="edgeFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,220,140,0.95)" />
          <stop offset="100%" stopColor="rgba(255,160,80,0.85)" />
        </linearGradient>
        <radialGradient id="nodeGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(255,220,140,0.5)" />
          <stop offset="100%" stopColor="rgba(255,220,140,0)" />
        </radialGradient>
        <filter id="goldShadow"><feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbe6a0" floodOpacity="0.6"/></filter>
        <pattern id="parchTex" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill="transparent"/>
          <circle cx="8" cy="12" r="0.6" fill="rgba(200,160,90,0.06)"/>
          <circle cx="28" cy="32" r="0.4" fill="rgba(200,160,90,0.05)"/>
        </pattern>
      </defs>

      {/* Edges first */}
      {layout.edges.map((e, i) => {
        const prog = nodeProgress(e.to);
        const path = edgePath(e);
        return (
          <g key={'e' + i} className="qg-edge">
            <path d={path} stroke="rgba(120,90,40,0.32)" strokeWidth="2" fill="none" strokeLinecap="round" />
            {prog > 0 && (
              <path d={path} stroke="url(#edgeFill)" strokeWidth="2.4" fill="none"
                strokeLinecap="round"
                strokeDasharray="1000"
                strokeDashoffset={1000 - prog * 1000}
                style={{ filter: 'drop-shadow(0 0 4px rgba(255,200,120,0.7))' }}
              />
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {layout.positions.map((p, i) => {
        const isQuestRoot = quests.some(q => q.id === p.node.id);
        const r = isQuestRoot ? 38 : nodeRadius(p.node);
        const kc = (p.node.children || []).length;
        const path = nodeShapePath(kc, r);
        const isSelected = selectedId === p.node.id;
        const stateCls = nodeStateClass(p.node);
        const hasChildren = kc > 0;
        const isExpanded = expanded[p.node.id] !== false;
        const prog = nodeProgress(p.node);

        return (
          <g key={'n' + i} className={`qg-node ${stateCls} ${isSelected ? 'qg-node--selected' : ''} ${isQuestRoot ? 'qg-node--root' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            onClick={(e) => { e.stopPropagation(); onSelect(p.node.id); }}
          >
            {/* Glow halo for active */}
            {(p.node.state === 'active' || p.node.status === 'active') && (
              <circle r={r + 14} fill="url(#nodeGlow)" />
            )}
            {/* Shape */}
            {path ? (
              <path d={path} className="qg-node__shape" />
            ) : (
              <circle r={r} className="qg-node__shape" />
            )}
            {/* Inner ring for root */}
            {isQuestRoot && <circle r={r - 6} className="qg-node__inner-ring" />}

            {/* Lock glyph */}
            {p.node.state === 'locked' && (
              <text className="qg-node__lock" textAnchor="middle" dominantBaseline="middle" y="1">🜔</text>
            )}
            {/* Done sigil */}
            {p.node.state === 'done' && (
              <text className="qg-node__done" textAnchor="middle" dominantBaseline="middle" y="2">✓</text>
            )}
            {/* Progress arc for active */}
            {p.node.state === 'active' && prog > 0 && prog < 1 && (
              <circle r={r + 4} fill="none" stroke="rgba(255,200,120,0.85)" strokeWidth="2"
                strokeDasharray={`${prog * 2 * Math.PI * (r + 4)} ${2 * Math.PI * (r + 4)}`}
                transform="rotate(-90)"
                style={{ filter: 'drop-shadow(0 0 3px rgba(255,200,120,0.8))' }}
              />
            )}

            {/* Urgent dot */}
            {p.node.urgent && (
              <circle cx={r * 0.7} cy={-r * 0.7} r="4" fill="#e5484d" stroke="rgba(0,0,0,0.6)" strokeWidth="0.6" />
            )}

            {/* Label */}
            <text className="qg-node__label" y={r + 18} textAnchor="middle">
              {(p.node.title || '').length > 26 ? (p.node.title || '').slice(0, 24) + '…' : p.node.title}
            </text>

            {/* Expand toggle for nodes with children */}
            {hasChildren && !isQuestRoot && (
              <g className="qg-node__toggle"
                transform={`translate(${r + 6},${-r - 6})`}
                onClick={(e) => { e.stopPropagation(); onToggleExpand(p.node.id); }}
              >
                <circle r="8" fill="rgba(20,14,6,0.92)" stroke="#c8932f" strokeWidth="1" />
                <text textAnchor="middle" dominantBaseline="middle" y="1" fontSize="11" fill="#fbe6a0">
                  {isExpanded ? '−' : '+'}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

window.QuestGraph = QuestGraph;
window.nodeProgress = nodeProgress;
