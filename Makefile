UUID = topbar-tweaks@beekrbonkr.github.io
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC = extension.js panel.js quickSettingsButton.js mirrors.js prefs.js metadata.json stylesheet.css

.PHONY: all install uninstall pack clean test

all: schemas/gschemas.compiled

schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.topbar-tweaks.gschema.xml
	glib-compile-schemas schemas/

install: all
	mkdir -p $(INSTALL_DIR)/schemas
	cp $(SRC) $(INSTALL_DIR)/
	cp schemas/*.gschema.xml schemas/gschemas.compiled $(INSTALL_DIR)/schemas/
	@echo "Installed. Log out and back in (Wayland), then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf $(INSTALL_DIR)

pack: all
	gnome-extensions pack --force \
		--extra-source=panel.js \
		--extra-source=quickSettingsButton.js \
		--extra-source=mirrors.js \
		.

clean:
	rm -f schemas/gschemas.compiled *.shell-extension.zip

# Run a nested gnome-shell with two virtual monitors to test the extension
test: install
	MUTTER_DEBUG_NUM_DUMMY_MONITORS=2 MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x720 \
		dbus-run-session -- gnome-shell --nested --wayland
