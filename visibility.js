// SPDX-License-Identifier: GPL-3.0-or-later
//
// Animated fullscreen hide/show for top bars, plus pressure-triggered reveal.
//
// gnome-shell's LayoutManager hides trackFullscreen chrome by toggling
// `visible` — a hard cut. This module re-implements that policy with a slide
// animation on `translation_y`: the extension's secondary bars are always
// added with trackFullscreen disabled and managed here, and (when configured)
// the primary panelBox's tracking is taken over too by clearing the
// trackFullscreen flag on its tracked-actor record.
//
// The stock hide condition is replicated exactly:
//     hidden = window_group.visible && monitor.inFullscreen
// (window_group visibility already encodes "not in overview / session has
// windows", so watching it plus 'in-fullscreen-changed' covers overview,
// session-mode and fullscreen transitions.)
//
// Animations are interruptible: easing `translation_y` again simply retargets
// from the current position, so a bar reverses smoothly mid-slide.
//
// Pressure reveal: while a bar is hidden, a Meta.Barrier along its screen
// edge feeds the shell's own PressureBarrier; pushing past the configured
// pressure slides the bar in *as an overlay* (no strut changes, so windows
// don't shift). It slides back out after the pointer has left the bar and
// all of its menus are closed for the configured delay.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';

const ANIMATION_MODES = {
    'linear': Clutter.AnimationMode.LINEAR,
    'ease-in-quad': Clutter.AnimationMode.EASE_IN_QUAD,
    'ease-out-quad': Clutter.AnimationMode.EASE_OUT_QUAD,
    'ease-in-out-quad': Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    'ease-out-cubic': Clutter.AnimationMode.EASE_OUT_CUBIC,
    'ease-in-out-cubic': Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
    'ease-out-quart': Clutter.AnimationMode.EASE_OUT_QUART,
    'ease-out-quint': Clutter.AnimationMode.EASE_OUT_QUINT,
    'ease-out-expo': Clutter.AnimationMode.EASE_OUT_EXPO,
    'ease-in-out-sine': Clutter.AnimationMode.EASE_IN_OUT_SINE,
    'ease-out-circ': Clutter.AnimationMode.EASE_OUT_CIRC,
    'ease-out-back': Clutter.AnimationMode.EASE_OUT_BACK,
    'ease-out-elastic': Clutter.AnimationMode.EASE_OUT_ELASTIC,
    'ease-out-bounce': Clutter.AnimationMode.EASE_OUT_BOUNCE,
};

// How often the pointer position is checked while a bar is revealed
const POINTER_WATCH_INTERVAL_MS = 150;
// Extra pixels below/above the bar that still count as "on the bar", so tiny
// jitters at the bar's inner edge don't start the hide countdown
const POINTER_GRACE_PX = 2;

class ManagedBar {
    // params: {actor, isMain, getMonitor, isBottom, hasOpenMenu}
    constructor(manager, params) {
        this._manager = manager;
        this.actor = params.actor;
        this.isMain = params.isMain;
        this._getMonitor = params.getMonitor;
        this._isBottom = params.isBottom ?? (() => false);
        this._hasOpenMenu = params.hasOpenMenu ?? (() => false);

        // 'shown' | 'showing' | 'hiding' | 'hidden'
        this._state = 'shown';
        this._revealed = false;
        this._barrier = null;
        this._pressureBarrier = null;
        this._pointerWatchId = 0;
        this._pointerAwaySince = 0;
        this._destroyed = false;

        this.actor.connectObject(
            // Keep a hidden bar fully off-screen when its height changes
            // (e.g. the panel-height setting while a video is fullscreen)
            'notify::height', () => {
                if (this._state === 'hidden')
                    this.actor.translation_y = this._hiddenY();
            },
            'destroy', () => {
                this.actor = null;
                this.destroy();
            },
            this);
    }

    get monitor() {
        return this._getMonitor();
    }

    _shouldHide() {
        if (!global.window_group.visible)
            return false;
        const monitor = this.monitor;
        if (!monitor?.inFullscreen)
            return false;
        // The primary panel always hides on fullscreen (stock behavior);
        // the extension's bars follow the hide-on-fullscreen setting.
        if (!this.isMain && !this._manager.hideOnFullscreen)
            return false;
        return true;
    }

    _hiddenY() {
        const height = this.actor?.height ?? 0;
        return this._isBottom() ? height : -height;
    }

    _isAnimating() {
        return this._state === 'hiding' || this._state === 'showing';
    }

    needsUnredirect() {
        // Fullscreen windows may bypass the compositor; anything we want to
        // draw on top of them (a slide animation or a revealed bar) needs
        // unredirection turned off for the duration.
        return this._revealed ||
            (this._isAnimating() && this.monitor?.inFullscreen === true);
    }

    sync(animate = true) {
        if (this._destroyed)
            return;

        if (!this._shouldHide() && this._revealed)
            this._setRevealed(false);

        if (this._shouldHide() && !this._revealed)
            this._hide(animate);
        else
            this._show(animate);

        this._updateBarrier();
    }

    _hide(animate) {
        const box = this.actor;

        if (this._state === 'hidden') {
            const target = this._hiddenY();
            if (box.translation_y !== target)
                box.translation_y = target;
            return;
        }
        if (this._state === 'hiding')
            return;

        this._state = 'hiding';
        this._manager.updateUnredirect();
        box.show();
        box.ease({
            translation_y: this._hiddenY(),
            duration: animate ? this._manager.hideDurationFor(this) : 0,
            mode: this._manager.animationMode,
            onStopped: finished => {
                if (!finished || this._state !== 'hiding' || this._destroyed)
                    return;
                this._state = 'hidden';
                box.hide();
                this._updateBarrier();
                this._manager.updateUnredirect();
                this._manager.queueRegionsUpdate();
            },
        });
    }

    _show(animate) {
        const box = this.actor;

        if (this._state === 'shown' || this._state === 'showing')
            return;

        this._state = 'showing';
        this._removeBarrier();
        box.show();
        this._manager.updateUnredirect();
        box.ease({
            translation_y: 0,
            duration: animate ? this._manager.showDurationFor(this) : 0,
            mode: this._manager.animationMode,
            onStopped: finished => {
                if (!finished || this._state !== 'showing' || this._destroyed)
                    return;
                this._state = 'shown';
                this._manager.updateUnredirect();
                // A revealed bar overlays the fullscreen window; recomputing
                // work areas would be pointless churn, so only do it for a
                // real show (translation-only changes never queue one).
                if (!this._revealed)
                    this._manager.queueRegionsUpdate();
            },
        });
    }

    // --- Pressure reveal -----------------------------------------------

    _updateBarrier() {
        const wanted = !this._destroyed &&
            this._state === 'hidden' &&
            this._shouldHide() &&
            this._manager.revealEnabledFor(this);

        if (wanted && !this._barrier)
            this._createBarrier();
        else if (!wanted && this._barrier)
            this._removeBarrier();
    }

    _createBarrier() {
        const monitor = this.monitor;
        if (!monitor)
            return;

        const bottom = this._isBottom();
        const y = bottom ? monitor.y + monitor.height : monitor.y;
        this._barrier = new Meta.Barrier({
            backend: global.backend,
            x1: monitor.x,
            x2: monitor.x + monitor.width,
            y1: y,
            y2: y,
            // List the direction the pointer is allowed to pass through;
            // pushing the other way builds up pressure.
            directions: bottom
                ? Meta.BarrierDirection.NEGATIVE_Y
                : Meta.BarrierDirection.POSITIVE_Y,
        });

        this._pressureBarrier = new Layout.PressureBarrier(
            this._manager.pressureThreshold,
            this._manager.pressureTimeout,
            Shell.ActionMode.NORMAL);
        this._pressureBarrier.addBarrier(this._barrier);
        this._pressureBarrier.connect('trigger', () => this._onPressureTrigger());
    }

    _removeBarrier() {
        if (!this._barrier)
            return;
        this._pressureBarrier.removeBarrier(this._barrier);
        this._pressureBarrier.destroy();
        this._pressureBarrier = null;
        this._barrier.destroy();
        this._barrier = null;
    }

    // Settings that shape the barrier changed; rebuild it if present
    refreshBarrier() {
        this._removeBarrier();
        this._updateBarrier();
    }

    _onPressureTrigger() {
        if (!this._shouldHide() || this._revealed)
            return;
        this._setRevealed(true);
        this.sync();
    }

    _setRevealed(revealed) {
        if (this._revealed === revealed)
            return;
        this._revealed = revealed;
        if (revealed) {
            this._startPointerWatch();
        } else {
            this._stopPointerWatch();
            // A reveal that turns into a real show (fullscreen ended while
            // the bar was revealed) skipped the strut update on purpose;
            // catch up now that the bar counts as normally shown.
            if (this._state === 'shown' || this._state === 'showing')
                this._manager.queueRegionsUpdate();
        }
        this._manager.updateUnredirect();
    }

    _startPointerWatch() {
        if (this._pointerWatchId)
            return;
        this._pointerAwaySince = 0;
        this._pointerWatchId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, POINTER_WATCH_INTERVAL_MS, () => {
                this._checkPointer();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopPointerWatch() {
        if (this._pointerWatchId) {
            GLib.source_remove(this._pointerWatchId);
            this._pointerWatchId = 0;
        }
    }

    _checkPointer() {
        if (!this._revealed)
            return;

        if (this._pointerOnBar() || this._hasOpenMenu()) {
            this._pointerAwaySince = 0;
            return;
        }

        const now = GLib.get_monotonic_time() / 1000;
        if (this._pointerAwaySince === 0) {
            this._pointerAwaySince = now;
            return;
        }
        if (now - this._pointerAwaySince >= this._manager.revealHideDelay) {
            this._setRevealed(false);
            this.sync();
        }
    }

    _pointerOnBar() {
        const monitor = this.monitor;
        if (!monitor)
            return false;

        const [x, y] = global.get_pointer();
        if (x < monitor.x || x >= monitor.x + monitor.width)
            return false;

        const barHeight = (this.actor?.height ?? 0) + POINTER_GRACE_PX;
        if (this._isBottom())
            return y >= monitor.y + monitor.height - barHeight;
        return y < monitor.y + barHeight;
    }

    // Reset the bar to its natural state (used before handing the primary
    // panelBox back to the shell, and when a bar goes away).
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._removeBarrier();
        this._stopPointerWatch();
        this._revealed = false;
        this._state = 'shown';

        if (this.actor) {
            this.actor.disconnectObject(this);
            this.actor.remove_transition('translation-y');
            this.actor.translation_y = 0;
            this.actor.show();
        }

        this._manager.updateUnredirect();
    }
}

export class BarVisibilityManager {
    constructor(settings) {
        this._settings = settings;
        this._secondaryBars = [];
        this._mainBar = null;
        this._mainTrackedData = null;
        this._unredirectDisabled = false;
        this._startupId = 0;

        global.display.connectObject('in-fullscreen-changed',
            () => this._syncAll(), this);
        global.window_group.connectObject('notify::visible',
            () => this._syncAll(), this);

        // During startup the shell animates panelBox itself; don't take the
        // primary panel over until that's finished.
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete',
                () => {
                    this._startupId = 0;
                    this._updateMainBar();
                });
        } else {
            this._updateMainBar();
        }
    }

    // --- Settings ------------------------------------------------------

    get hideOnFullscreen() {
        return this._settings.get_boolean('hide-on-fullscreen');
    }

    get animationMode() {
        return ANIMATION_MODES[
            this._settings.get_string('animation-interpolation')] ??
            Clutter.AnimationMode.EASE_OUT_QUAD;
    }

    get pressureThreshold() {
        return this._settings.get_int('pressure-threshold');
    }

    get pressureTimeout() {
        return this._settings.get_int('pressure-timeout');
    }

    get revealHideDelay() {
        return this._settings.get_int('reveal-hide-delay');
    }

    _animationEnabledFor(bar) {
        const mode = this._settings.get_string('animate-fullscreen-bars');
        if (mode === 'all')
            return true;
        return bar.isMain ? mode === 'main' : mode === 'secondary';
    }

    hideDurationFor(bar) {
        return this._animationEnabledFor(bar)
            ? this._settings.get_int('animation-duration-hide') : 0;
    }

    showDurationFor(bar) {
        return this._animationEnabledFor(bar)
            ? this._settings.get_int('animation-duration-show') : 0;
    }

    revealEnabledFor(bar) {
        if (!this._settings.get_boolean('pressure-reveal'))
            return false;
        const mode = this._settings.get_string('pressure-reveal-bars');
        if (mode === 'all')
            return true;
        return bar.isMain ? mode === 'main' : mode === 'secondary';
    }

    _manageMain() {
        return this._animationEnabledFor({isMain: true}) ||
            this.revealEnabledFor({isMain: true});
    }

    // --- Bar registration ----------------------------------------------

    // bars: [{actor, getMonitor, isBottom, hasOpenMenu}]
    setSecondaryBars(bars) {
        for (const bar of this._secondaryBars)
            bar.destroy();

        this._secondaryBars = bars.map(params => new ManagedBar(this, {
            ...params,
            isMain: false,
        }));
        for (const bar of this._secondaryBars)
            bar.sync(false);

        // Monitor layout may have changed; re-snap the primary bar too
        if (this._mainBar) {
            this._mainBar.sync(false);
            this._mainBar.refreshBarrier();
        }
    }

    _updateMainBar() {
        const manage = this._manageMain();
        if (manage && !this._mainBar) {
            if (Main.layoutManager._startingUp)
                return;

            const panelBox = Main.layoutManager.panelBox;
            const data = Main.layoutManager._trackedActors?.find(
                d => d.actor === panelBox);
            if (!data)
                return; // unexpected shell internals; leave the panel alone

            this._mainTrackedData = data;
            data.trackFullscreen = false;

            this._mainBar = new ManagedBar(this, {
                actor: panelBox,
                isMain: true,
                getMonitor: () => Main.layoutManager.primaryMonitor,
                isBottom: () => false,
                hasOpenMenu: () => Main.panel.menuManager?.activeMenu != null,
            });
            this._mainBar.sync(false);
        } else if (!manage && this._mainBar) {
            this._releaseMainBar();
        }
    }

    _releaseMainBar() {
        if (!this._mainBar)
            return;

        this._mainBar.destroy();
        this._mainBar = null;

        if (this._mainTrackedData) {
            this._mainTrackedData.trackFullscreen = true;
            this._mainTrackedData = null;
        }
        // Hand visibility policy back to the shell
        Main.layoutManager._updateVisibility();
        this.queueRegionsUpdate();
    }

    _allBars() {
        return this._mainBar
            ? [...this._secondaryBars, this._mainBar]
            : this._secondaryBars;
    }

    _syncAll() {
        for (const bar of this._allBars())
            bar.sync();
    }

    // Called when any animation/reveal-related setting changed
    updateSettings() {
        this._updateMainBar();
        for (const bar of this._allBars()) {
            bar.refreshBarrier();
            bar.sync();
        }
    }

    // --- Shared services for bars --------------------------------------

    queueRegionsUpdate() {
        // Struts and input regions follow get_transformed_position(), but
        // translation changes don't queue a recompute on their own
        Main.layoutManager._queueUpdateRegions?.();
    }

    updateUnredirect() {
        const needed = this._allBars().some(bar => bar.needsUnredirect());
        if (needed && !this._unredirectDisabled) {
            this._unredirectDisabled = true;
            global.compositor.disable_unredirect();
        } else if (!needed && this._unredirectDisabled) {
            this._unredirectDisabled = false;
            global.compositor.enable_unredirect();
        }
    }

    destroy() {
        if (this._startupId) {
            Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
        }
        global.display.disconnectObject(this);
        global.window_group.disconnectObject(this);

        for (const bar of this._secondaryBars)
            bar.destroy();
        this._secondaryBars = [];
        this._releaseMainBar();

        if (this._unredirectDisabled) {
            this._unredirectDisabled = false;
            global.compositor.enable_unredirect();
        }
        this._settings = null;
    }
}
