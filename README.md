# pi-bar

Configurable [pi](https://pi.dev) status bar extension.

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

To start from the default config, copy `config.toml` from this repository or
from the installed npm package:

```sh
mkdir -p ~/.pi/pi-bar
cp config.toml ~/.pi/pi-bar/config.toml
$EDITOR ~/.pi/pi-bar/config.toml
```

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

## Development

```sh
npm run deploy
```

Installs the local extension and copies `config.toml` to
`~/.pi/pi-bar/config.toml`.
