# pi-bar

Configurable [pi](https://pi.dev) status bar extension.

![pi-bar screenshot](./screenshot.png)

## Install

```sh
pi install npm:@npm-ken/pi-bar
```

pi-bar works immediately after install using the bundled default config.

## Customize

Create this file and edit it:

```text
~/.pi/pi-bar/config.toml
```

To start from the default config, copy `config.toml` from this repository or from the installed npm package and paste it to ~/.pi/pi-bar/config.toml

## Common edits

### Colors

```toml
[colors]
text_fg = "#cdd6f4"
model_bg = "#005b95"
thinking_bg = "#005b95"
activity_bg = "#313244"
activity_fg = "#2dd4bf"
ok = "#006b1d"
warn = "#a17a00"
alert = "#972e2d"
```

Use `#rrggbb` hex colors. Segments use these names with `fg` and `bg`.

### Separators

Powerline/Nerd Font separators:

```toml
[statusbar.separators]
leading = "\uE0BA"
trailing = "\uE0BC"
```

Plain separators:

```toml
[statusbar.separators]
leading = ""
trailing = ""
```

### Segments

Segments are listed as `[[statusbar.segments]]`. Reorder, remove, or add them in
that file.

```toml
[[statusbar.segments]]
type = "value"
eval = "model?.id ?? 'no model'"
fg = "text_fg"
bg = "model_bg"
```

Segment types:

- `value` — text from `eval`
- `meter` — numeric value with threshold colors
- `status` — pi extension status, like MCP or LSP
- `activity` — tool activity / working spinner

Status segments can set `ignore = ["regex"]` to skip matching status text. This is useful on `key = "*"` catch-all segments when a known status should not be rendered.

### Adaptive / Responsive Collapsing

pi-bar supports optional configuration attributes to gracefully scale down the status bar on constrained terminal widths instead of truncating abruptly:

- `priority`: integer (higher priority = kept longer; default is `5`).
- `collapsed_eval`: alternative JS expression evaluated when the segment is collapsed.
- `hide_if_collapsed`: boolean indicating if the segment should be hidden entirely when collapsed.

#### Example Config

```toml
# A high-priority context utilization meter that collapses to a shorter format
[[statusbar.segments]]
type = "meter"
value_eval = "ctx.getContextUsage()?.percent ?? 0"
eval = "`${Math.round(value)}% of ${humanReadable(model?.contextWindow)}`"
fg = "text_fg"
priority = 4
collapsed_eval = "`${Math.round(value)}%`"

# A medium-priority thinking indicator that hides entirely when space is limited
[[statusbar.segments]]
type = "value"
eval = "pi.getThinkingLevel()"
show_if = "model?.reasoning"
fg = "text_fg"
bg = "thinking_bg"
priority = 2
hide_if_collapsed = true

# A low-priority active tool spinner that collapses to just the spinner glyph
[[statusbar.segments]]
type = "activity"
fg = "activity_fg"
bg = "activity_bg"
min_width = 11
eval = "`${activity.spinner} ${activity.value}`"
collapsed_eval = "activity.spinner"
priority = 5
```


