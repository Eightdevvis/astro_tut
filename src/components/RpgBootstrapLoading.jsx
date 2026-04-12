import './rpg-bootstrap-loading.css';

/** Volle Fläche: zentrierter Kreis-Spinner bis RPG-State vom Server da ist. */
export default function RpgBootstrapLoading() {
  return (
    <div class="rpg-bootstrap-loading" role="status" aria-live="polite" aria-busy="true">
      <span class="rpg-bootstrap-loading__ring" aria-hidden="true" />
      <span class="rpg-bootstrap-loading__sr">Lädt …</span>
    </div>
  );
}
