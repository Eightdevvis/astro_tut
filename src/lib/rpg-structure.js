/**
 * Kapitel/Abschnitt/Unterabschnitt-Struktur (v3) für Hybrid-Unlocks.
 * `graph` bleibt für Quest-Kanten; `structure` trägt Container + Unlock-Regeln.
 */

function s(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * @param {unknown} raw
 * @returns {{ requires: string[] }}
 */
export function normalizeStructureUnlock(raw) {
  const req = arr(raw && typeof raw === 'object' ? raw.requires : null)
    .map((x) => s(x))
    .filter(Boolean);
  return { requires: [...new Set(req)] };
}

/**
 * @param {unknown} raw
 * @returns {{ id: string; title: string; role: 'fundament' | 'folgebar' | 'standalone' | 'bridge'; unlock: { requires: string[] } } | null}
 */
function normalizeSubsection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = s(raw.id);
  if (!id) return null;
  const roleRaw = s(raw.role).toLowerCase();
  const role =
    roleRaw === 'fundament' || roleRaw === 'folgebar' || roleRaw === 'bridge' ? roleRaw : 'standalone';
  return {
    id,
    title: s(raw.title) || id,
    role,
    unlock: normalizeStructureUnlock(raw.unlock),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ id: string; title: string; unlock: { requires: string[] }; subsections: { id: string; title: string; role: 'fundament' | 'folgebar' | 'standalone' | 'bridge'; unlock: { requires: string[] } }[] } | null}
 */
function normalizeSection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = s(raw.id);
  if (!id) return null;
  const subs = arr(raw.subsections).map(normalizeSubsection).filter(Boolean);
  return {
    id,
    title: s(raw.title) || id,
    unlock: normalizeStructureUnlock(raw.unlock),
    subsections: dedupeById(subs),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ id: string; title: string; unlock: { requires: string[] }; sections: { id: string; title: string; unlock: { requires: string[] }; subsections: { id: string; title: string; role: 'fundament' | 'folgebar' | 'standalone' | 'bridge'; unlock: { requires: string[] } }[] }[] } | null}
 */
function normalizeChapter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = s(raw.id);
  if (!id) return null;
  const sections = arr(raw.sections).map(normalizeSection).filter(Boolean);
  return {
    id,
    title: s(raw.title) || id,
    unlock: normalizeStructureUnlock(raw.unlock),
    sections: dedupeById(sections),
  };
}

/**
 * @template {{ id: string }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
function dedupeById(rows) {
  /** @type {Map<string, T>} */
  const m = new Map();
  for (const r of rows) m.set(r.id, r);
  return [...m.values()];
}

/**
 * @param {unknown} raw
 * @returns {{ questId: string; chapterId: string; sectionId: string; subsectionId: string } | null}
 */
function normalizeQuestContainerRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const questId = s(raw.questId);
  const chapterId = s(raw.chapterId);
  const sectionId = s(raw.sectionId);
  const subsectionId = s(raw.subsectionId);
  if (!questId || !chapterId || !sectionId || !subsectionId) return null;
  return { questId, chapterId, sectionId, subsectionId };
}

/**
 * @param {unknown} raw
 * @returns {{ chapters: { id: string; title: string; unlock: { requires: string[] }; sections: { id: string; title: string; unlock: { requires: string[] }; subsections: { id: string; title: string; role: 'fundament' | 'folgebar' | 'standalone' | 'bridge'; unlock: { requires: string[] } }[] }[] }[]; questContainerRefs: { questId: string; chapterId: string; sectionId: string; subsectionId: string }[] }}
 */
export function normalizeRpgStructure(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { chapters: [], questContainerRefs: [] };
  }
  const chapters = dedupeById(arr(raw.chapters).map(normalizeChapter).filter(Boolean));
  const refs = dedupeById(
    arr(raw.questContainerRefs)
      .map(normalizeQuestContainerRef)
      .filter(Boolean)
      .map((x) => ({ ...x, id: x.questId }))
  ).map(({ id: _id, ...rest }) => rest);
  return { chapters, questContainerRefs: refs };
}

/**
 * @param {{ quests?: { id?: unknown }[]; edges?: { from?: unknown; to?: unknown }[] }} graph
 */
export function buildDefaultRpgStructureFromGraph(graph) {
  const quests = Array.isArray(graph?.quests) ? graph.quests : [];
  return {
    chapters: [
      {
        id: 'chapter:general',
        title: 'General',
        unlock: { requires: [] },
        sections: [
          {
            id: 'section:general',
            title: 'General',
            unlock: { requires: [] },
            subsections: [
              { id: 'subsection:main', title: 'Main', role: 'fundament', unlock: { requires: [] } },
              { id: 'subsection:side', title: 'Side', role: 'standalone', unlock: { requires: [] } },
            ],
          },
        ],
      },
    ],
    questContainerRefs: quests
      .map((q) => s(q?.id))
      .filter(Boolean)
      .map((questId) => ({
        questId,
        chapterId: 'chapter:general',
        sectionId: 'section:general',
        subsectionId: questId.startsWith('main-') ? 'subsection:main' : 'subsection:side',
      })),
  };
}

/**
 * @param {{ from: string; to: string }[]} edges
 */
function edgeKeySet(edges) {
  return new Set(edges.map((e) => `${e.from}=>${e.to}`));
}

/**
 * @param {{ quests?: { id?: unknown }[]; edges?: { from?: unknown; to?: unknown }[] }} graph
 * @param {{ chapters: { id: string; sections: { id: string; subsections: { id: string; unlock: { requires: string[] } }[]; unlock: { requires: string[] } }[]; unlock: { requires: string[] } }[]; questContainerRefs: { questId: string; chapterId: string; sectionId: string; subsectionId: string }[] }} structure
 * @returns {{ ok: true } | { ok: false; errorCode: string; message: string; detail?: string }}
 */
export function validateRpgStructureAgainstGraph(graph, structure) {
  const questIds = new Set((graph?.quests || []).map((q) => s(q?.id)).filter(Boolean));
  const edgeKeys = edgeKeySet(
    (graph?.edges || [])
      .map((e) => ({ from: s(e?.from), to: s(e?.to) }))
      .filter((e) => e.from && e.to && e.from !== e.to)
  );

  /** @type {Set<string>} */
  const chapterIds = new Set();
  /** @type {Set<string>} */
  const sectionIds = new Set();
  /** @type {Set<string>} */
  const subsectionIds = new Set();
  /** @type {Map<string, string>} */
  const subsectionRole = new Map();

  for (const ch of structure.chapters) {
    if (chapterIds.has(ch.id)) {
      return { ok: false, errorCode: 'structure_duplicate_chapter', message: 'Doppelte Kapitel-ID.', detail: ch.id };
    }
    chapterIds.add(ch.id);
    for (const sec of ch.sections) {
      if (sectionIds.has(sec.id)) {
        return { ok: false, errorCode: 'structure_duplicate_section', message: 'Doppelte Abschnitt-ID.', detail: sec.id };
      }
      sectionIds.add(sec.id);
      for (const sub of sec.subsections) {
        if (subsectionIds.has(sub.id)) {
          return {
            ok: false,
            errorCode: 'structure_duplicate_subsection',
            message: 'Doppelte Unterabschnitt-ID.',
            detail: sub.id,
          };
        }
        subsectionIds.add(sub.id);
        subsectionRole.set(sub.id, sub.role);
      }
    }
  }

  const seenQuestRef = new Set();
  for (const ref of structure.questContainerRefs) {
    if (!questIds.has(ref.questId)) {
      return {
        ok: false,
        errorCode: 'structure_unknown_quest_ref',
        message: 'questContainerRef referenziert unbekannte Quest.',
        detail: ref.questId,
      };
    }
    if (!chapterIds.has(ref.chapterId) || !sectionIds.has(ref.sectionId) || !subsectionIds.has(ref.subsectionId)) {
      return {
        ok: false,
        errorCode: 'structure_unknown_container_ref',
        message: 'questContainerRef referenziert unbekannten Container.',
        detail: `${ref.chapterId}/${ref.sectionId}/${ref.subsectionId}`,
      };
    }
    if (seenQuestRef.has(ref.questId)) {
      return {
        ok: false,
        errorCode: 'structure_duplicate_quest_ref',
        message: 'Eine Quest darf nur einem Container zugeordnet sein.',
        detail: ref.questId,
      };
    }
    seenQuestRef.add(ref.questId);
  }
  for (const qid of questIds) {
    if (!seenQuestRef.has(qid)) {
      return {
        ok: false,
        errorCode: 'structure_missing_quest_ref',
        message: 'Jede Quest braucht einen Container-Ref.',
        detail: qid,
      };
    }
  }

  // Keine doppelte Wahrheit: unlock requires darf keine vorhandene Quest-Edge duplizieren.
  for (const ch of structure.chapters) {
    const reqs = ch.unlock?.requires || [];
    for (const req of reqs) {
      if (edgeKeys.has(`${req}=>${ch.id}`)) {
        return {
          ok: false,
          errorCode: 'structure_unlock_edge_conflict',
          message: 'Unlock-Regel dupliziert vorhandene Edge-Semantik.',
          detail: `${req}=>${ch.id}`,
        };
      }
    }
    for (const sec of ch.sections) {
      for (const req of sec.unlock?.requires || []) {
        if (edgeKeys.has(`${req}=>${sec.id}`)) {
          return {
            ok: false,
            errorCode: 'structure_unlock_edge_conflict',
            message: 'Unlock-Regel dupliziert vorhandene Edge-Semantik.',
            detail: `${req}=>${sec.id}`,
          };
        }
      }
      for (const sub of sec.subsections) {
        for (const req of sub.unlock?.requires || []) {
          if (edgeKeys.has(`${req}=>${sub.id}`)) {
            return {
              ok: false,
              errorCode: 'structure_unlock_edge_conflict',
              message: 'Unlock-Regel dupliziert vorhandene Edge-Semantik.',
              detail: `${req}=>${sub.id}`,
            };
          }
        }
      }
    }
  }

  // Basisregel: folgebar sollte nicht auf standalone referenzieren.
  for (const ch of structure.chapters) {
    for (const sec of ch.sections) {
      for (const sub of sec.subsections) {
        if (sub.role !== 'folgebar') continue;
        const hasStandaloneReq = (sub.unlock?.requires || []).some((id) => subsectionRole.get(id) === 'standalone');
        if (hasStandaloneReq) {
          return {
            ok: false,
            errorCode: 'structure_followbar_depends_on_standalone',
            message: 'Folgebar-Unterabschnitt darf nicht von Standalone-Unterabschnitt abhängen.',
            detail: sub.id,
          };
        }
      }
    }
  }

  return { ok: true };
}
