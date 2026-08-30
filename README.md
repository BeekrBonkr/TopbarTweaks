# Topbar Tweaks

A GNOME Shell extension that shows the top bar on more than one monitor.

GNOME only puts its top bar on the primary monitor. Topbar Tweaks adds a
fully interactive top bar to your other monitors — not a mirror or a dumb
clone: each bar has its own working Activities button, clock/calendar/
notifications menu, and a complete Quick Settings menu that opens on the
monitor it belongs to.

## Features

- **Per-monitor bars** — add a bar to all secondary monitors, or pick
  specific monitors by connector (DP-1, HDMI-1, …).
- **Real panel items**
  - Activities button with live workspace dots (scroll it to switch
    workspaces), or a classic text label
  - Clock with the full calendar / notifications / world clock menu
  - Full Quick Settings (volume, brightness, network, Bluetooth, power,
    dark mode, …)
  - Optional accessibility menu and keyboard layout indicator
- **Extensive configuration**
  - Clock position: left / center / right
  - Bar position: top or bottom edge
  - Bar height, background opacity, custom background color
  - Hide in the overview, hide when a window is fullscreen
- Follows your shell theme by default; bars stay out of the way of
  maximized windows (proper struts) and support Ctrl+Alt+Tab focus.

## Requirements

GNOME Shell 48–50 (developed and tested on GNOME 50).

## Install

```bash
make install
```

Then log out and back in (required on Wayland) and enable it:

```bash
gnome-extensions enable topbar-tweaks@beekrbonkr.github.io
```

Open the settings with:

```bash
gnome-extensions prefs topbar-tweaks@beekrbonkr.github.io
```

## Testing in a nested shell

You can try the extension without logging out using a nested GNOME Shell
with two virtual monitors:

```bash
make test
```

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
