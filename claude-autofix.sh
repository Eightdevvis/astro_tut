#!/bin/bash
# ============================================================
# claude-autofix.sh
# Lässt Claude Code mehrere Runden autonom über den Code gehen,
# Fehler suchen und fixen. Perfekt für "über Nacht laufen lassen".
#
# Nutzung:
#   ./claude-autofix.sh          → 3 Runden (Standard)
#   ./claude-autofix.sh 7        → 7 Runden
#   ./claude-autofix.sh 5 "Nur tests fixen"  → 5 Runden mit Custom-Prompt
#
# Voraussetzung:
#   - claude CLI muss installiert und eingeloggt sein
#   - Wird im Projektverzeichnis ausgeführt
#
# WARNUNG: --dangerously-skip-permissions überspringt ALLE
# Sicherheitsabfragen. Nur in vertrauenswürdiger Umgebung nutzen!
# ============================================================

# Anzahl Runden (Standard: 3)
RUNS="${1:-3}"

# Optionaler Custom-Prompt (Standard: allgemeiner Bugfix-Prompt)
CUSTOM_PROMPT="${2:-}"

# Standard-Prompt wenn keiner angegeben
DEFAULT_PROMPT="Geh über den gesamten Code im Projekt, such nach Bugs, Inkonsistenzen, \
toten Referenzen und Verbesserungsmöglichkeiten. Fixe alles was du findest. \
Führe danach die Tests aus mit 'npm run test:quality' und stelle sicher dass alles grün ist. \
Fasse am Ende zusammen was du geändert hast."

PROMPT="${CUSTOM_PROMPT:-$DEFAULT_PROMPT}"

# Log-Datei mit Zeitstempel
LOGFILE="claude-autofix-$(date +%Y%m%d-%H%M%S).log"

echo "========================================"
echo "  Claude Autofix"
echo "  Runden: $RUNS"
echo "  Log:    $LOGFILE"
echo "========================================"
echo ""

# Jede Runde in die Log-Datei + Terminal schreiben
for i in $(seq 1 "$RUNS"); do
  echo "=== Runde $i von $RUNS === $(date)" | tee -a "$LOGFILE"
  echo "" | tee -a "$LOGFILE"

  # Claude non-interaktiv ausführen, Ausgabe in Log + Terminal
  claude --dangerously-skip-permissions -p "$PROMPT" 2>&1 | tee -a "$LOGFILE"

  echo "" | tee -a "$LOGFILE"
  echo "=== Runde $i fertig === $(date)" | tee -a "$LOGFILE"
  echo "" | tee -a "$LOGFILE"
done

echo "========================================"
echo "  Fertig! $RUNS Runden abgeschlossen."
echo "  Log gespeichert: $LOGFILE"
echo "  Änderungen prüfen: git diff"
echo "========================================"
