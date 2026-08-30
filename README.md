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
- **Works with your other extensions**
  - Icons that other extensions add to the main top bar — app tray icons
    (AppIndicator/KStatusNotifierItem), clipboard managers, caffeine,
    drive menu, GSConnect, … — are mirrored onto every extra bar as live,
    clickable copies. Their menus open on the monitor you clicked;
    middle-click and scroll are forwarded to the real indicator, so
    tray-icon shortcuts keep working.
  - Toggles that extensions add to the main Quick Settings menu
    (Caffeine, GSConnect, …) show up in the extra bars' Quick Settings
    too, with live state.
  - Both mirrors can be turned off in the settings.
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

## Known limitations with other extensions

- Only button-like Quick Settings items are mirrored; custom sliders and
  widgets other extensions place in the main Quick Settings stay on the
  primary monitor (the extra bars have their own native volume/brightness
  sliders).
- A mirrored Quick Settings toggle triggers its main action; arrow
  submenus of such toggles open in the primary Quick Settings only.
- Extensions that restyle the main bar itself (e.g. Blur my Shell's panel
  blur) only affect the primary bar — use the opacity/color settings here
  to match the look.

## Testing in a nested shell

You can try the extension without logging out using a nested GNOME Shell
with two virtual monitors:

```bash
make test
```

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
