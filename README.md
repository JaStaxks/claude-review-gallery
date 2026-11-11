# Review gallery for Claude Code

A Claude Code mod that adds a side pane listing every image, video and other file Claude has sent you to review in the current session, newest first. Each session keeps its own list.

Each entry shows:

- the file name, its type and the time it was sent, plus Claude's caption if there was one;
- a sharp preview for images, and a frame from one second in (with a play mark) for videos;
- **Open**, which opens the file in its default app, and **Show in folder**, which opens its folder with the file selected.

A **Clear** button at the top empties the list.

The pane opens by itself the first time Claude sends you a file in a session. Type `/review-gallery` to open it any time.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install review-gallery --marketplace JaStaxks/claude-review-gallery
```

From a shell:

```
claude plugin install review-gallery --marketplace JaStaxks/claude-review-gallery
```

In the Claude desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `JaStaxks/claude-review-gallery`, then **Add plugin**.

## Requirements

- **ffmpeg and ffprobe** on your PATH, to make the previews. Without them the list still works, just without pictures.
- **Show in folder** with the file selected works on Windows, where it uses a small PowerShell script (`scripts/reveal.ps1`). On Linux it opens the folder with `xdg-open`.

## How it works

The mod watches Claude's send-file tool (`SendUserFile`). For each file sent, it adds an entry and makes a WebP preview, using the sharpest size that fits the pane's image limit. Desktop, the editor and the phone draw the preview as an SVG image; the terminal draws a PNG where the terminal supports pictures. Previews are kept in your system temp folder, under `claude-review-gallery`.

Files shown any other way, such as artifacts or browser screenshots, are not listed.

## License

MIT
