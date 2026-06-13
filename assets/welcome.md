# Welcome to macno

macno is a clean, distraction-free Markdown editor for Windows — highly inspired by Typora.

## Getting Started

Open a file with **Ctrl+O**, or drag and drop a `.md` file onto the window.

## Features

- **WYSIWYG editing** — type Markdown, see the result instantly
- **Sidebar** — file tree, outline, and recent files (Ctrl+Shift+L)
- **Focus Mode** — blur everything except the current paragraph (F8)
- **Typewriter Mode** — keep the cursor centered on screen (F9)
- **Multiple themes** — Light, Dark, GitHub, Solarized
- **Export** — PDF and HTML via File menu

## Markdown Quick Reference

### Formatting

**Bold text** · *Italic text* · ~~Strikethrough~~ · `inline code`

### Headings

Use `#` through `######` for headings H1–H6.

### Lists

- Unordered item
- Another item
  - Nested item

1. Ordered item
2. Another item

- [ ] Task to do
- [x] Completed task

### Code Block

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```

### Blockquote

> Great things are not done by impulse, but by a series of small things brought together.

### Table

| Feature       | macno | Typora |
| ------------- | :---: | :----: |
| WYSIWYG       |  ✓    |   ✓    |
| File Tree     |  ✓    |   ✓    |
| Focus Mode    |  ✓    |   ✓    |
| Free          |  ✓    |   ✗    |

### Math (KaTeX)

Inline: $E = mc^2$

Block:

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

### Diagram (Mermaid)

```mermaid
graph LR
    A[Write] --> B[Preview]
    B --> C[Export]
    C --> D[Share]
```

---

**Keyboard Shortcuts**

| Action | Shortcut |
|--------|----------|
| New file | Ctrl+N |
| Open file | Ctrl+O |
| Save | Ctrl+S |
| Toggle sidebar | Ctrl+Shift+L |
| Toggle source mode | Ctrl+/ |
| Focus mode | F8 |
| Typewriter mode | F9 |
| Find | Ctrl+F |
| Find & Replace | Ctrl+H |
