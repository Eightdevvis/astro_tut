import { useState, useEffect } from 'preact/hooks';

export default function VerandaRpgLink() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch('/api/user')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user?.canUseRpg) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;

  return (
    <a href="/rpg" class="veranda-rpg-link">
      quests
    </a>
  );
}
