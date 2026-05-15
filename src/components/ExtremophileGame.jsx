import { useState, useEffect, useRef } from 'preact/hooks';
import {
  CATEGORIES,
  QUESTIONS,
  categoryById,
  checkAnswer,
  getDisplayAnswer,
} from '../lib/extremophile.js';
import {
  loadProgress,
  saveProgress,
  markCorrect,
  totalPercent,
  categoryComplete,
  mergeProgress,
  GAME_ID,
} from '../lib/extremophile-progress.js';
import { syncOnMount, pushToServer } from '../lib/minigame-progress-sync.js';
import { ExtremophileIcon } from './ExtremophileIcons.jsx';

export default function ExtremophileGame({ mode = 'play' }) {
  const [progress, setProgress] = useState(() => loadProgress());
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    syncOnMount({
      gameId: GAME_ID,
      localProgress: loadProgress(),
      merge: mergeProgress,
      saveLocal: saveProgress,
      onMerged: (merged) => setProgress(merged),
    });
  }, []);

  // Session-Quiz-State (resettet bei Kategorie-Wechsel).
  const [qIdx, setQIdx] = useState(0);
  const [input, setInput] = useState('');
  const [results, setResults] = useState(() => Array(QUESTIONS.length).fill(null));
  const [marker, setMarker] = useState(null); // 'check' | 'cross' | null
  const advanceTimer = useRef(null);
  const markerTimer = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    return () => {
      clearTimeout(advanceTimer.current);
      clearTimeout(markerTimer.current);
    };
  }, []);

  const enterCategory = (id) => {
    clearTimeout(advanceTimer.current);
    clearTimeout(markerTimer.current);
    setSelectedId(id);
    setQIdx(0);
    setInput('');
    setResults(Array(QUESTIONS.length).fill(null));
    setMarker(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const exitCategory = () => {
    clearTimeout(advanceTimer.current);
    clearTimeout(markerTimer.current);
    setSelectedId(null);
    setMarker(null);
  };

  const handleCheck = () => {
    if (!selectedId || !input.trim()) return;
    const cat = categoryById(selectedId);
    const q = QUESTIONS[qIdx];
    const correct = checkAnswer(cat, q, input);
    const correctAnswer = getDisplayAnswer(cat, q);

    setResults((prev) => {
      const next = [...prev];
      next[qIdx] = { correct, userAnswer: input.trim(), correctAnswer };
      return next;
    });

    setMarker(correct ? 'check' : 'cross');

    if (correct) {
      const updated = markCorrect(selectedId, q.id);
      setProgress(updated);
      pushToServer(GAME_ID, updated);
    }

    // Marker bleibt visuell bis Advance — das hält den Input gesperrt und
    // gibt bei falscher Antwort Zeit, die Loesung im Strip oben zu lesen.
    clearTimeout(markerTimer.current);
    clearTimeout(advanceTimer.current);
    const advanceDelay = correct ? 1100 : 3500;
    advanceTimer.current = setTimeout(() => {
      setMarker(null);
      setInput('');
      setQIdx((v) => v + 1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }, advanceDelay);
  };

  const quizDone = selectedId && qIdx >= QUESTIONS.length;
  const category = selectedId ? categoryById(selectedId) : null;
  const correctCount = results.filter((r) => r && r.correct).length;

  if (mode === 'practice') {
    return (
      <section className="ex-root">
        <header className="ex-header">
          <h1 className="ex-title">Extremophile — Uebung</h1>
          <p className="ex-sub">
            Alle Kategorien mit Loesungen. Keine Wertung, kein Speichern.
          </p>
        </header>
        <PracticeView />
        <Styles />
      </section>
    );
  }

  return (
    <section className="ex-root">
      <header className="ex-header">
        <h1 className="ex-title">Extremophile</h1>
        <p className="ex-sub">
          Sechs Lebensraum-Extreme, eine Beispielart pro Klasse. Klick auf ein Symbol — sechs
          Fragen pro Kategorie.
        </p>
        <div className="ex-progress-row">
          <span className="ex-progress-label">Gesamt</span>
          <span className="ex-progress-bar">
            <span
              className="ex-progress-fill"
              style={{ width: `${totalPercent(progress)} %` }}
            />
          </span>
          <span className="ex-progress-pct">{totalPercent(progress)}&nbsp;%</span>
        </div>
      </header>

      {!selectedId && (
        <div className="ex-grid">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`ex-tile ${categoryComplete(progress, cat.id) ? 'ex-tile--done' : ''}`}
              onClick={() => enterCategory(cat.id)}
            >
              <span className="ex-tile-icon">
                <ExtremophileIcon iconKey={cat.iconKey} size={88} />
              </span>
              <span className="ex-tile-title">{cat.title}</span>
              <span className="ex-tile-sub">
                {cat.parameter} ({cat.direction})
              </span>
              {categoryComplete(progress, cat.id) && (
                <span className="ex-tile-done" aria-label="alle Fragen richtig">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <div className="ex-quiz">
          <div className="ex-quiz-topline">
            <button type="button" className="ex-back" onClick={exitCategory}>
              &larr; Zurueck zur Auswahl
            </button>
            <span className="ex-quiz-category">
              {category.title}{' '}
              <span className="ex-quiz-category-sub">
                — {category.parameter} ({category.direction})
              </span>
            </span>
          </div>

          <ol className="ex-result-list" aria-label="Fragen-Fortschritt">
            {QUESTIONS.map((q, i) => {
              const r = results[i];
              const isCurrent = i === qIdx && r === null;
              const cls =
                r === null
                  ? isCurrent
                    ? 'ex-pill--current'
                    : 'ex-pill--pending'
                  : r.correct
                  ? 'ex-pill--ok'
                  : 'ex-pill--bad';
              const isSpecies = q.id === 'species';
              return (
                <li key={q.id} className="ex-result-row">
                  <span className={`ex-pill ${cls}`}>
                    {r === null ? i + 1 : r.correct ? '✓' : '✗'}
                  </span>
                  <span className="ex-result-text">
                    {r === null ? (
                      <span className="ex-result-prompt">{q.prompt}</span>
                    ) : r.correct ? (
                      <span className="ex-result-correct">
                        {isSpecies ? <em>{r.correctAnswer}</em> : r.correctAnswer}
                      </span>
                    ) : (
                      <>
                        <span className="ex-result-user-wrong">{r.userAnswer}</span>
                        <span className="ex-result-arrow" aria-hidden="true">→</span>
                        <span className="ex-result-correct">
                          {isSpecies ? <em>{r.correctAnswer}</em> : r.correctAnswer}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="ex-icon-stage">
            <ExtremophileIcon iconKey={category.iconKey} size={170} />
            {marker && (
              <span
                className={`ex-marker ex-marker--${marker}`}
                key={`${qIdx}-${marker}`}
                aria-hidden="true"
              >
                {marker === 'check' ? '✓' : '✗'}
              </span>
            )}
          </div>

          {!quizDone && (
            <div className="ex-question-block">
              <p className="ex-question-counter">
                Frage {qIdx + 1} von {QUESTIONS.length}
              </p>
              <p className="ex-question">{QUESTIONS[qIdx].prompt}</p>
              <div className="ex-input-row">
                <input
                  ref={inputRef}
                  type="text"
                  className="ex-input"
                  value={input}
                  disabled={marker !== null}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onInput={(e) => setInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && marker === null && input.trim()) {
                      handleCheck();
                    }
                  }}
                  placeholder="Antwort tippen…"
                />
                <button
                  type="button"
                  className="ex-check"
                  onClick={handleCheck}
                  disabled={!input.trim() || marker !== null}
                >
                  Pruefen
                </button>
              </div>
            </div>
          )}

          {quizDone && (
            <div className="ex-summary">
              <p className="ex-summary-title">
                {correctCount} von {QUESTIONS.length} richtig.
              </p>
              <p className="ex-summary-hint">
                Schau dir den Marker-Strip oben an, um zu sehen, welche Fragen sassen.
              </p>
              <button
                type="button"
                className="ex-check ex-check--secondary"
                onClick={exitCategory}
              >
                Zurueck zur Auswahl
              </button>
            </div>
          )}
        </div>
      )}

      <Styles />
    </section>
  );
}

function PracticeView() {
  return (
    <div className="ex-practice">
      {CATEGORIES.map((cat) => (
        <article key={cat.id} className="ex-practice-card">
          <div className="ex-practice-head">
            <span className="ex-practice-icon">
              <ExtremophileIcon iconKey={cat.iconKey} size={64} />
            </span>
            <div className="ex-practice-titles">
              <h2 className="ex-practice-title">{cat.title}</h2>
              <p className="ex-practice-subtitle">
                {cat.parameter} ({cat.direction})
              </p>
            </div>
          </div>
          <dl className="ex-practice-fields">
            <dt>Art</dt>
            <dd><em>{cat.species.name}</em></dd>
            <dt>Gruppe</dt>
            <dd>{cat.species.domain}</dd>
            <dt>Habitat</dt>
            <dd>{cat.species.habitat}</dd>
            <dt>Optimum</dt>
            <dd>{cat.species.optimum.display}</dd>
            <dt>Minimum</dt>
            <dd>{cat.species.min.display}</dd>
            <dt>Maximum</dt>
            <dd>{cat.species.max.display}</dd>
          </dl>
        </article>
      ))}
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .ex-root {
        width: 100%;
        max-width: 64rem;
        margin: 0 auto;
        padding: 0 1rem 4rem;
        box-sizing: border-box;
        color: var(--site-body-text);
      }
      .ex-header { margin: 0 0 1.4rem; }
      .ex-title {
        margin: 0 0 0.3rem;
        font-size: 1.85rem;
        font-weight: 700;
      }
      .ex-sub {
        margin: 0 0 0.8rem;
        color: var(--site-muted);
        line-height: 1.5;
      }
      .ex-progress-row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .ex-progress-label {
        color: var(--site-soft-muted);
      }
      .ex-progress-bar {
        flex: 1;
        height: 0.5rem;
        border-radius: 0.35rem;
        background: rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }
      .ex-progress-fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #6a8caf, #3d8a59);
        transition: width 0.4s ease;
      }
      .ex-progress-pct {
        color: var(--site-muted);
        font-variant-numeric: tabular-nums;
      }

      /* GRID */
      .ex-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.9rem;
      }
      @media (min-width: 38rem) {
        .ex-grid { grid-template-columns: repeat(3, 1fr); }
      }
      .ex-tile {
        appearance: none;
        font: inherit;
        color: inherit;
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 0.9rem 0.9rem 0.8rem;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
      }
      .ex-tile:hover {
        transform: translateY(-3px);
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .ex-tile:focus-visible {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 2px;
      }
      .ex-tile-icon {
        display: block;
        line-height: 0;
      }
      .ex-tile-title {
        font-weight: 700;
        text-align: center;
      }
      .ex-tile-sub {
        color: var(--site-soft-muted);
        font-size: 0.85rem;
        text-align: center;
      }
      .ex-tile--done {
        background: linear-gradient(180deg, rgba(61, 138, 89, 0.08), var(--site-card-bg));
      }
      .ex-tile-done {
        position: absolute;
        top: 0.6rem;
        right: 0.7rem;
        color: #2f7449;
        font-weight: 800;
        font-size: 1.1rem;
        line-height: 1;
      }

      /* QUIZ */
      .ex-quiz {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .ex-quiz-topline {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .ex-back {
        appearance: none;
        background: transparent;
        border: 0;
        cursor: pointer;
        color: var(--site-soft-muted);
        font: inherit;
        padding: 0;
      }
      .ex-back:hover { text-decoration: underline; }
      .ex-quiz-category {
        font-weight: 700;
      }
      .ex-quiz-category-sub {
        font-weight: 400;
        color: var(--site-muted);
      }

      .ex-result-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .ex-result-row {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        line-height: 1.3;
      }
      .ex-result-text {
        flex: 1;
        min-width: 0;
        font-size: 0.95rem;
      }
      .ex-result-prompt {
        color: var(--site-soft-muted);
      }
      .ex-result-user-wrong {
        text-decoration: line-through;
        color: #b94b4b;
        margin-right: 0.4rem;
      }
      .ex-result-arrow {
        color: var(--site-soft-muted);
        margin-right: 0.4rem;
      }
      .ex-result-correct {
        font-weight: 600;
        color: var(--site-body-text);
      }
      .ex-pill {
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.95rem;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-soft-muted);
        font-variant-numeric: tabular-nums;
      }
      .ex-pill--current {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 1px;
        color: var(--site-body-text);
      }
      .ex-pill--ok {
        background: rgba(61, 138, 89, 0.15);
        color: #2f7449;
        border-color: rgba(61, 138, 89, 0.35);
      }
      .ex-pill--bad {
        background: rgba(208, 69, 69, 0.12);
        color: #b94b4b;
        border-color: rgba(208, 69, 69, 0.35);
      }

      .ex-icon-stage {
        position: relative;
        align-self: center;
        width: 200px;
        height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ex-marker {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9rem;
        font-weight: 900;
        line-height: 1;
        pointer-events: none;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.18);
        animation: ex-marker-pop 0.9s cubic-bezier(0.18, 0.7, 0.3, 1) forwards;
      }
      .ex-marker--check { color: rgba(45, 130, 70, 0.92); }
      .ex-marker--cross { color: rgba(205, 55, 55, 0.92); }
      @keyframes ex-marker-pop {
        0%   { transform: scale(0.3); opacity: 0; }
        20%  { transform: scale(1.25); opacity: 1; }
        35%  { transform: scale(1); opacity: 1; }
        75%  { transform: scale(1); opacity: 1; }
        100% { transform: scale(1); opacity: 0; }
      }

      .ex-question-block {
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 1rem 1.1rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .ex-question-counter {
        margin: 0 0 0.4rem;
        color: var(--site-soft-muted);
        font-size: 0.85rem;
      }
      .ex-question {
        margin: 0 0 0.8rem;
        font-size: 1.15rem;
        font-weight: 600;
      }
      .ex-input-row {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .ex-input {
        flex: 1 1 16rem;
        padding: 0.55rem 0.8rem;
        border: 1px solid var(--site-card-border);
        border-radius: 0.6rem;
        background: var(--site-card-bg);
        color: var(--site-body-text);
        font: inherit;
        font-size: 1rem;
      }
      .ex-input:focus-visible {
        outline: 2px solid var(--site-accent, #6a8caf);
        outline-offset: 1px;
      }
      .ex-check {
        appearance: none;
        border: 1px solid var(--site-card-border);
        background: var(--site-card-bg);
        color: var(--site-body-text);
        padding: 0.55rem 1rem;
        font: inherit;
        font-weight: 600;
        border-radius: 0.6rem;
        cursor: pointer;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .ex-check:hover:not(:disabled) {
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow-hover);
      }
      .ex-check:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .ex-check--secondary {
        margin-top: 0.6rem;
      }

      .ex-summary {
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 1.5rem 1.1rem;
        text-align: center;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .ex-summary-title {
        margin: 0 0 0.4rem;
        font-size: 1.3rem;
        font-weight: 700;
      }
      .ex-summary-hint {
        margin: 0;
        color: var(--site-muted);
      }

      /* PRACTICE */
      .ex-practice {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.9rem;
      }
      @media (min-width: 40rem) {
        .ex-practice { grid-template-columns: 1fr 1fr; }
      }
      .ex-practice-card {
        background: var(--site-card-bg);
        border: 1px solid var(--site-card-border);
        border-radius: 1rem;
        padding: 0.9rem 1rem;
        box-shadow: var(--site-card-inset-soft), var(--site-card-shadow);
      }
      .ex-practice-head {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        margin-bottom: 0.6rem;
      }
      .ex-practice-icon {
        display: block;
        line-height: 0;
        flex-shrink: 0;
      }
      .ex-practice-titles { display: flex; flex-direction: column; }
      .ex-practice-title { margin: 0; font-size: 1.15rem; font-weight: 700; }
      .ex-practice-subtitle {
        margin: 0;
        color: var(--site-soft-muted);
        font-size: 0.85rem;
      }
      .ex-practice-fields {
        margin: 0;
        display: grid;
        grid-template-columns: max-content 1fr;
        column-gap: 0.8rem;
        row-gap: 0.25rem;
        font-size: 0.95rem;
      }
      .ex-practice-fields dt {
        color: var(--site-soft-muted);
        font-weight: 600;
      }
      .ex-practice-fields dd { margin: 0; }
    `}</style>
  );
}
