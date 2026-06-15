# π Digits Challenge

A kid-friendly memorization game for the digits of pi — up to 300 digits. Built for George.

## Modes

- **📚 Learn** — Drill new chunks of 5 digits at a time, starting from where you left off. Study, hide, recall.
- **🎯 Test** — Recall run from digit 1. One mistake ends the run; tracks best streak.
- **⌨️ Type-Ahead** — Guided practice: type the next digit; wrong reveals the answer and continues.
- **❓ Fill Blanks** — Random ~25% of digits hidden in your mastered range; fill them in.

## Run locally

```bash
cd ~/Documents/pi
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

- `index.html` — markup and mode buttons
- `styles.css` — kid-friendly theme (dark purple + gold/pink accents)
- `app.js` — all game logic, pi constant (320 digits stored, target 300), confetti, Web Audio tones, localStorage progress

## Progress storage

Progress is saved in `localStorage` under keys:
- `pidg_mastered` — highest digit position cleared in Learn (1-indexed; digit 1 = "3")
- `pidg_best_run` — best Test recall streak
- `pidg_sound` — `"on"` or `"off"`

"Reset progress" on the home screen clears all three.

## Digit-counting convention

Position 1 = "3", position 2 = "1", position 3 = "4", … position 200 = "9", position 300 = "7".
