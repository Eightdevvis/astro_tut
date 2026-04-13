import { canSetStepDone, buildRewardDisplayList } from '../lib/rpg-quest-steps.js';
import { questProgress } from '../lib/rpg-quest-graph.js';

function RewardCubeIcon() {
  return (
    <svg
      class="rpg-reward-pill__cube"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.35"
        d="M8 1 2 4v6l6 3 6-3V4L8 1zm0 1.2 4.2 2.1L8 6.4 3.8 4.4 8 2.2zM3 5.2l4 2v4.5l-4-2V5.2zm10 0v4.5l-4 2V7.2l4-2z"
      />
    </svg>
  );
}

function RewardHeartIcon() {
  return (
    <svg
      class="rpg-reward-pill__points-icon rpg-reward-pill__points-icon--heart"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.9"
        d="M8 13.2 2.2 7.4c-1.1-1.1-1.1-2.9 0-4 1.1-1.1 2.9-1.1 4 0l1.8 1.8 1.8-1.8c1.1-1.1 2.9-1.1 4 0 1.1 1.1 1.1 2.9 0 4L8 13.2z"
      />
    </svg>
  );
}

/** Achtzack-Stern (zwei überlagerte Quadrate). */
function RewardManaStarIcon() {
  return (
    <svg
      class="rpg-reward-pill__points-icon rpg-reward-pill__points-icon--mana"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillOpacity="0.9"
        d="M8.00,1.80L9.07,5.41L12.38,3.62L10.59,6.93L14.20,8.00L10.59,9.07L12.38,12.38L9.07,10.59L8.00,14.20L6.93,10.59L3.62,12.38L5.41,9.07L1.80,8.00L5.41,6.93L3.62,3.62L6.93,5.41Z"
      />
    </svg>
  );
}

/**
 * @param {{
 *   quest: import('../lib/rpg-quest-graph.js').RpgGraphQuest;
 *   stepDone: Record<string, Record<string, boolean>>;
 *   onToggleStep: (questId: string, stepId: string) => void;
 *   interactive?: boolean;
 *   stepsClass?: string;
 *   rewardsClass?: string;
 *   graph?: import('../lib/rpg-quest-graph.js').RpgGraph | null;
 *   itemCatalog?: Record<string, { title?: string }>;
 * }} props
 */
export default function RpgQuestStepsView({
  quest,
  stepDone,
  onToggleStep,
  interactive = true,
  stepsClass = 'rpg-steps',
  rewardsClass = 'rpg-rewards',
  graph = null,
  itemCatalog = {},
}) {
  const doneFor = stepDone[quest.id] || {};
  const rewardProgressPct = graph ? questProgress(quest, stepDone, graph) : undefined;

  return (
    <>
      <ul class={stepsClass}>
        {(quest.steps || []).map((s) => (
          <StepBranch
            key={s.id}
            quest={quest}
            step={s}
            depth={0}
            doneFor={doneFor}
            stepDone={stepDone}
            onToggleStep={onToggleStep}
            interactive={interactive}
          />
        ))}
      </ul>
      <p class="rpg-section-label">Rewards</p>
      <div class={rewardsClass}>
        {buildRewardDisplayList(quest, stepDone, rewardProgressPct, itemCatalog).map((row, i) => (
          <span
            key={`${row.source}-${i}-${row.kind}-${row.kind === 'points' && row.pointKind ? row.pointKind : ''}-${row.label.slice(0, 24)}`}
            class={`rpg-reward-pill${row.kind === 'item' ? ' rpg-reward-pill--item' : ''}${
              row.kind === 'points' ? ' rpg-reward-pill--points' : ''
            }${row.unlocked ? '' : ' rpg-reward-pill--locked'}`}
            title={
              row.source === 'quest' && typeof row.unlockAtPercent === 'number'
                ? `Ab ${row.unlockAtPercent} % Quest-Fortschritt (inkl. Subgraph)`
                : row.source === 'step'
                  ? row.unlocked
                    ? 'Schritt erledigt'
                    : 'Nach Erledigung des Schritts'
                  : undefined
            }
          >
            {row.kind === 'item' ? (
              <>
                <RewardCubeIcon />
                <span class="rpg-reward-pill__label">{row.label}</span>
              </>
            ) : row.kind === 'points' ? (
              <>
                {row.pointKind === 'mana' ? <RewardManaStarIcon /> : <RewardHeartIcon />}
                <span class="rpg-reward-pill__label rpg-reward-pill__label--points">{row.label}</span>
              </>
            ) : (
              row.label
            )}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * @param {{
 *   quest: import('../lib/rpg-quest-graph.js').RpgGraphQuest;
 *   step: Record<string, unknown> & { id: string; label: string; substeps?: unknown[]; optional?: boolean };
 *   depth: number;
 *   doneFor: Record<string, boolean>;
 *   stepDone: Record<string, Record<string, boolean>>;
 *   onToggleStep: (q: string, s: string) => void;
 *   interactive: boolean;
 * }} props
 */
function StepBranch({ quest, step, depth, doneFor, stepDone, onToggleStep, interactive }) {
  const hasSubs = Array.isArray(step.substeps) && step.substeps.length > 0;

  if (hasSubs) {
    return (
      <li
        key={step.id}
        class="rpg-step rpg-step--group"
        style={{ '--rpg-step-depth': String(depth) }}
      >
        <details class="rpg-step__details" open={depth < 1}>
          <summary class="rpg-step__summary">
            <span class="rpg-step__summary-text">{step.label}</span>
            {step.optional ? (
              <span class="rpg-step-badge" title="Optional">
                optional
              </span>
            ) : null}
          </summary>
          <ul class="rpg-steps rpg-steps--nested">
            {step.substeps.map((ch) => (
              <StepBranch
                key={ch.id}
                quest={quest}
                step={ch}
                depth={depth + 1}
                doneFor={doneFor}
                stepDone={stepDone}
                onToggleStep={onToggleStep}
                interactive={interactive}
              />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  const checked = !!doneFor[step.id];
  const depBlocked = interactive && !checked && !canSetStepDone(quest, step.id, stepDone, true);

  const toggle = () => {
    if (checked) {
      onToggleStep(quest.id, step.id);
      return;
    }
    if (canSetStepDone(quest, step.id, stepDone, true)) onToggleStep(quest.id, step.id);
  };

  return (
    <li
      key={step.id}
      class={`rpg-step rpg-step--leaf${step.optional ? ' rpg-step--optional' : ''}`}
      style={{ '--rpg-step-depth': String(depth) }}
    >
      <label class={`rpg-step__label${!interactive ? ' rpg-step__label--readonly' : ''}`}>
        {interactive ? (
          <input
            type="checkbox"
            checked={checked}
            disabled={depBlocked}
            onChange={toggle}
          />
        ) : null}
        <span class="rpg-step__text">{step.label}</span>
        {step.optional ? (
          <span class="rpg-step-badge" title="Optional">
            optional
          </span>
        ) : null}
        {step.timeDueAt && String(step.timeDueAt).trim() ? (
          <span class="rpg-step-badge rpg-step-badge--due" title="Frist">
            bis {String(step.timeDueAt).trim().slice(0, 10)}
          </span>
        ) : null}
        {depBlocked ? (
          <span class="rpg-step-hint" title="Zuerst abhängige Schritte erledigen">
            gesperrt
          </span>
        ) : null}
      </label>
    </li>
  );
}
