# Grid Component - Verwendung

Der Masonry-Grid ist ein responsives, chaotisches Mosaik-Layout, das sich automatisch anpasst.

## Basis-Verwendung

### Methode 1: Mit Items-Array

```astro
---
import Grid from '../components/Grid.astro';

const gridItems = [
  { size: 'square', content: 'Quadrat', color: '#ff6b6b' },
  { size: 'portrait', content: 'Hochkant', color: '#4ecdc4' },
  { size: 'landscape', content: 'Querformat', color: '#45b7d1' },
  { size: 'wide', content: 'Breites Feld', color: '#f9ca24' },
  { size: 'tall', content: 'Hohes Feld', color: '#6c5ce7' },
  { size: 'vertical', content: 'Vertikal', color: '#a29bfe' },
  { size: 'small', content: 'Klein', color: '#fd79a8' },
];
---

<Grid items={gridItems} />
```

### Methode 2: Mit Slots (flexibler)

```astro
---
import Grid from '../components/Grid.astro';
---

<Grid>
  <div class="grid-item small" style="background: #ff6b6b;">
    <h3>Titel 1</h3>
    <p>Inhalt...</p>
  </div>
  
  <div class="grid-item large" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <img src="/bild.jpg" alt="Bild" />
    <p>Bildtext</p>
  </div>
  
  <div class="grid-item medium" style="background: #4ecdc4;">
    <article>Dein Content hier</article>
  </div>
  
  <div class="grid-item wide" style="background: rgba(255, 107, 107, 0.3);">
    <h2>Breiter Bereich</h2>
  </div>
</Grid>
```

## Verfügbare Größen

### Nach Höhe:
- **`tiny`** - Sehr klein (120px min)
- **`small`** - Klein (180px min)
- **`medium`** - Mittel (280px min) - *Standard*
- **`large`** - Groß (380px min)
- **`tall`** - Hoch (480px min)
- **`huge`** - Sehr groß (600px min)

### Nach Proportionen:
- **`square`** - Quadratisch (1:1)
- **`landscape`** - Querformat (4:3)
- **`portrait`** - Hochkant (3:4)
- **`wide`** - Breit (16:9)
- **`vertical`** - Vertikal (2:3)

**Wichtig:** Die tatsächliche Höhe variiert automatisch durch:
- `nth-child` Selektoren die zufällige Höhen addieren/subtrahieren
- JavaScript das jedem Element eine zufällige Variation gibt
- Der natürliche Masonry-Flow passt sich automatisch an

Die Felder sind bewusst NICHT auf einer Linie - sie stapeln sich wie echte Mauersteine!

## Farben hinzufügen

Du kannst jedem Feld eine eigene Farbe geben:

### Mit Items-Array:
```javascript
const items = [
  { 
    size: 'large', 
    content: 'Buntes Feld',
    color: '#ff6b6b' // Hex
  },
  { 
    size: 'medium', 
    content: 'Gradient',
    color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' // Gradient
  },
  { 
    size: 'small', 
    content: 'Transparent',
    color: 'rgba(255, 107, 107, 0.5)' // Transparent
  },
];
```

### Mit Slots:
```astro
<div class="grid-item large" style="background: #4ecdc4;">
  Dein Inhalt
</div>
```

## Mosaik-Effekt

Der chaotische Look wird erreicht durch:
- **CSS Column Layout** statt Grid - Felder stapeln sich vertikal wie Mauersteine
- Stark variierende Höhen (120px bis 600px+)
- Automatische zufällige Höhenvariationen durch nth-child
- JavaScript fügt jedem Element -30px bis +30px zufällig hinzu
- Felder hängen natürlich runter und stehen hoch - keine perfekte Ausrichtung!
- Responsive: 1-4 Spalten je nach Bildschirmbreite

## Beispiel: Blog mit Grid

```astro
---
import Grid from '../components/Grid.astro';
import BlogPost from '../components/BlogPost.astro';

const posts = await Astro.glob('../pages/posts/*.md');
---

<Grid>
  {posts.map((post, index) => {
    // Zufällige Größen für Variation
    const sizes = ['small', 'medium', 'large', 'wide', 'tall'];
    const randomSize = sizes[index % sizes.length];
    
    return (
      <div class={`grid-item ${randomSize}`}>
        <BlogPost post={post} />
      </div>
    );
  })}
</Grid>
```

## Anpassungen

### Eigene Größen hinzufügen

Bearbeite `Grid.astro` und füge neue CSS-Klassen hinzu:

```css
.grid-item.custom {
  grid-column: span 3;
  grid-row: span 2;
  min-height: 300px;
}
```

### Farben/Styling anpassen

Die Grid-Items verwenden CSS-Variablen und können über dein Theme gestylt werden:

```css
.grid-item {
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
}
```

## Responsive Verhalten

- **Mobile** (<768px): Alle Felder werden auf 1 Spalte reduziert, keine Offsets
- **Desktop** (768px-1200px): Standard Grid
- **Large** (>1200px): Größere Spalten und mehr Abstand
