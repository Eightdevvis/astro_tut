#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateRpgGraphToV2, walkStepsPreOrder } from '../src/lib/rpg-quest-steps.js';

/**
 * @param {unknown} value
 */
function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * @param {unknown} input
 */
function pickGraph(input) {
  const obj = asObject(input);
  if (!obj) return null;
  if (Array.isArray(obj.quests) && Array.isArray(obj.edges)) return obj;
  const g = asObject(obj.graph);
  if (g && Array.isArray(g.quests) && Array.isArray(g.edges)) return g;
  return null;
}

/**
 * @param {any} quest
 */
function collectLegacyNodeRows(quest) {
  /** @type {{ id: string; label: string; optional: boolean; dependsOn: string[]; timeDueAt: string; reward: string }[]} */
  const out = [];
  const walk = (rows) => {
    for (const row of rows || []) {
      const id = typeof row?.id === 'string' ? row.id : '';
      if (!id) continue;
      out.push({
        id,
        label: typeof row?.label === 'string' ? row.label : '',
        optional: !!row?.optional,
        dependsOn: Array.isArray(row?.dependsOn) ? row.dependsOn.map(String) : [],
        timeDueAt: typeof row?.timeDueAt === 'string' ? row.timeDueAt : '',
        reward: JSON.stringify(row?.reward ?? null),
      });
      const children = Array.isArray(row?.children) ? row.children : row?.substeps;
      if (Array.isArray(children) && children.length) walk(children);
    }
  };
  const roots = Array.isArray(quest?.children) ? quest.children : quest?.steps;
  walk(roots);
  return out;
}

/**
 * @param {any} quest
 */
function collectMigratedNodeRows(quest) {
  /** @type {{ id: string; parentId: string | null; label: string; optional: boolean; dependsOn: string[]; timeDueAt: string; reward: string; childCount: number }[]} */
  const out = [];
  walkStepsPreOrder(quest?.children || [], (row) => {
    out.push({
      id: row.id,
      parentId: row.parentId ?? null,
      label: typeof row?.label === 'string' ? row.label : '',
      optional: !!row?.optional,
      dependsOn: Array.isArray(row?.dependsOn) ? row.dependsOn.map(String) : [],
      timeDueAt: typeof row?.timeDueAt === 'string' ? row.timeDueAt : '',
      reward: JSON.stringify(row?.reward ?? null),
      childCount: Array.isArray(row?.children) ? row.children.length : 0,
    });
  });
  return out;
}

/**
 * @param {any} graph
 */
function validateMigratedGraph(graph) {
  /** @type {string[]} */
  const issues = [];
  for (const quest of graph.quests || []) {
    if (quest.parentId !== null) issues.push(`Quest ${quest.id}: parentId muss null sein.`);
    const rows = collectMigratedNodeRows(quest);
    const idSet = new Set(rows.map((r) => r.id));
    for (const row of rows) {
      if (row.parentId !== quest.id && !idSet.has(String(row.parentId || ''))) {
        issues.push(`Quest ${quest.id}: Node ${row.id} hat ungültiges parentId ${row.parentId}.`);
      }
      for (const dep of row.dependsOn) {
        if (!idSet.has(dep)) {
          issues.push(`Quest ${quest.id}: dependsOn ${dep} in Node ${row.id} liegt außerhalb der Quest.`);
        }
      }
    }
  }
  return issues;
}

/**
 * @param {any} before
 * @param {any} after
 */
function compareGraphs(before, after) {
  /** @type {string[]} */
  const issues = [];
  const beforeById = new Map((before.quests || []).map((q) => [q.id, q]));
  const afterById = new Map((after.quests || []).map((q) => [q.id, q]));
  if (beforeById.size !== afterById.size) {
    issues.push(`Quest-Anzahl geändert: ${beforeById.size} -> ${afterById.size}`);
  }
  for (const [qid, beforeQuest] of beforeById.entries()) {
    const afterQuest = afterById.get(qid);
    if (!afterQuest) {
      issues.push(`Quest fehlt nach Migration: ${qid}`);
      continue;
    }
    const bRows = collectLegacyNodeRows(beforeQuest);
    const aRows = collectMigratedNodeRows(afterQuest);
    const bMap = new Map(bRows.map((r) => [r.id, r]));
    const aMap = new Map(aRows.map((r) => [r.id, r]));
    if (bMap.size !== aMap.size) {
      issues.push(`Quest ${qid}: Node-Anzahl geändert: ${bMap.size} -> ${aMap.size}`);
    }
    for (const [id, b] of bMap.entries()) {
      const a = aMap.get(id);
      if (!a) {
        issues.push(`Quest ${qid}: Node fehlt nach Migration: ${id}`);
        continue;
      }
      if (b.label !== a.label) issues.push(`Quest ${qid}: label geändert bei Node ${id}`);
      if (b.optional !== a.optional) issues.push(`Quest ${qid}: optional geändert bei Node ${id}`);
      if (b.timeDueAt !== a.timeDueAt) issues.push(`Quest ${qid}: timeDueAt geändert bei Node ${id}`);
      if (b.reward !== a.reward) issues.push(`Quest ${qid}: reward geändert bei Node ${id}`);
      if (JSON.stringify(b.dependsOn) !== JSON.stringify(a.dependsOn)) {
        issues.push(`Quest ${qid}: dependsOn geändert bei Node ${id}`);
      }
    }
  }
  return issues;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/check_rpg_tree_migration.js <path-to-json>');
    process.exit(2);
  }
  const filePath = path.resolve(process.cwd(), arg);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const graph = pickGraph(parsed);
  if (!graph) {
    console.error('Input enthält kein gültiges graph-Objekt mit quests + edges.');
    process.exit(2);
  }
  const migrated = migrateRpgGraphToV2(graph);
  const compareIssues = compareGraphs(graph, migrated);
  const shapeIssues = validateMigratedGraph(migrated);
  const issues = [...compareIssues, ...shapeIssues];
  if (issues.length > 0) {
    console.error('Migration-Check fehlgeschlagen:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`OK: ${migrated.quests.length} Quests geprüft, keine Strukturverletzungen gefunden.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
