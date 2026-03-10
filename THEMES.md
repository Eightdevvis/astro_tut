# Theme Usage Guide

## Available Themes

Your blog now has 6 predefined themes in `src/styles/themes.css`:

1. **Default** (Pink Gradient)
2. **Dark** (Purple Dark Mode)
3. **Ocean** (Blue/Teal)
4. **Sunset** (Orange/Red)
5. **Forest** (Green)
6. **Purple** (Purple Dream)

## How to Switch Themes

### Theme Switcher Button

The theme icon button in your navigation automatically cycles through all 6 themes. Just click it to switch between:
Default → Dark → Ocean → Sunset → Forest → Purple → (back to Default)

The selected theme is saved in localStorage, so it persists across page loads.

### Manual Theme Setting

#### Method 1: Change in BaseLayout.astro

Edit `src/layouts/BaseLayout.astro`:

```astro
<html lang="en" class="ocean">  <!-- Change "ocean" to any theme -->
```

### Method 2: Dynamic Theme Switching (JavaScript)

For custom theme switching logic, you can programmatically change themes:

```javascript
// Switch to a specific theme
document.documentElement.className = 'sunset';
localStorage.setItem('theme', 'sunset');

// The theme switcher cycles through: '', 'dark', 'ocean', 'sunset', 'forest', 'purple'
```

## Creating New Themes

Add a new theme block in `src/styles/themes.css`:

```css
html.mytheme {
  --color-bg: #yourcolor;
  --color-nav-start: #yourcolor;
  --color-nav-end: #yourcolor;
  --color-text: #yourcolor;
  --color-accent: #yourcolor;
  --color-menu-bg: #yourcolor;
  --color-menu-text: #yourcolor;
  --color-link: #yourcolor;
  --color-link-hover: #yourcolor;
  --font-family: 'Your Font', sans-serif;
  --font-weight: 400;
  --font-weight-bold: 700;
}
```

Then activate with `class="mytheme"` on the html element.

## Available CSS Variables

### Colors
- `--color-bg` - Page background color
- `--color-nav-start` - Navigation gradient start color
- `--color-nav-end` - Navigation gradient end color
- `--color-text` - Main text color
- `--color-accent` - Accent color for highlights
- `--color-menu-bg` - Mobile menu button background
- `--color-menu-text` - Mobile menu button text
- `--color-link` - Link color
- `--color-link-hover` - Link hover/focus color

### Typography
- `--font-family` - Base font family for body text
- `--font-weight` - Normal font weight (typically 300-500)
- `--font-weight-bold` - Bold font weight for headings and emphasis (typically 600-800)
