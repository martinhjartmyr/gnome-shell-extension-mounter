"use strict";

const { Gio, Clutter, St, GLib, Shell, Meta } = imports.gi;

const Lang = imports.lang;
const Util = imports.misc.util;

const ExtensionUtils = imports.misc.extensionUtils;
const Local = ExtensionUtils.getCurrentExtension();

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const MOUNTER_ICON = "drive-harddisk-symbolic";
const MOUNT_ICON = "drive-harddisk-symbolic";
const UMOUNT_ICON = "media-eject-symbolic";
const FSTAB = "/etc/fstab";
const MTAB = "/etc/mtab";

// Settings (schema) names
const SCHEMA_ENABLE_KEYBINDING = "mounter-enable-keybinding";
const SCHEMA_TOGGLE_MENU = "mounter-toggle-menu";

class MounterIndicator {
  constructor(_mounter) {
    this.panelButton = new PanelMenu.Button(null, "MounterIndicator");
    this._mounter = _mounter;
    this._shortcutId = null;

    const icon = new St.Icon({icon_name: MOUNTER_ICON, style_class: "system-status-icon"});
    this.panelButton.add_actor(icon);
    this.buildMenu();

    if (this._mounter.enableShortcut) {
      this._bindShortcut();
    }
  }

  toggleMenu() {
    this.panelButton.menu.toggle();
  }

  buildMenu() {
    const menu = this.panelButton.menu;
    menu.removeAll();
    this._mounter.mountsAvail.forEach(mount => {
      const icon_name = mount.mounted ? UMOUNT_ICON : MOUNT_ICON;
      const item = new PopupMenu.PopupImageMenuItem(mount.mountPoint, icon_name);
      item.connect(
        "activate", function(mount) {
          menu.close();
          this._mounter.onAction(item, mount);
        }.bind(this, mount)
      );
      menu.addMenuItem(item);
    });
  }

  destroy() {
    this.panelButton.destroy();
    this._unbindShortcut();
  }

  _bindShortcut() {
    const name = SCHEMA_TOGGLE_MENU;
    this._shortcutId = name;

    Main.wm.addKeybinding(
      name,
      this._mounter.settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      Lang.bind(this, this.toggleMenu)
    );
  }

  _unbindShortcut() {
    if (this._shortcutId != null) {
      Main.wm.removeKeybinding(this._shortcutId)
    }

    this._shortcutId = null;
  }
}

class Mounter {
  constructor() {
    this.mountsAvail = []; // Contains all mounts found in fstab
    this.settings = ExtensionUtils.getSettings();
    this.enableShortcut = this.settings.get_boolean(SCHEMA_ENABLE_KEYBINDING);

    this._createMountMonitor();
    this._readFstab();
    this._readMounts();
    this._createIndicator();
  }

  // Callback from panelMenu item click
  onAction(_item, _mount) {
    if (_mount.mounted) {
      Util.spawn(["umount", _mount.mountPoint]);
      _mount.mounted = false;
      _item.setIcon(MOUNT_ICON);
    } else {
      Util.spawn(["mount", _mount.mountPoint]);
      _mount.mounted = true;
      _item.setIcon(UMOUNT_ICON);
    }
  }

  destroy() {
    if (this._mountsChangedId) {
      this._monitor.disconnect(this._mountsChangedId);
      this._mountsChangedId = 0;
    }

    this._destroyIndicator();
  }

  _destroyIndicator() {
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }
  }

  _createIndicator() {
    if (!this._indicator) {
      this._indicator = new MounterIndicator(this);
      Main.panel.addToStatusArea("MounterIndicator", this._indicator.panelButton);
    }
  }

  // Listen to system mount events
  _createMountMonitor() {
    this._monitor = Gio.UnixMountMonitor.get();
    this._mountsChangedId = this._monitor.connect("mounts-changed", () => {
      this._readMounts();
    });
  }

  // Only matches mounts with the options "noauto" and "user"
  _readFstab() {
    const [success, content] = GLib.file_get_contents(FSTAB);

    if (success) {
      const contentLines = imports.byteArray.toString(content);
      contentLines.split("\n").forEach(line => {
        const data = line.match(/\S+/g) || [];
        if (data.length == 6 &&
            data[3].match("noauto") !== null &&
            data[3].match("user") !== null) {
          const mountEntry = {
            mounted: false,
            device: data[0],
            mountPoint: data[1],
          };
          this.mountsAvail.push(mountEntry);
        }
      });
    }
  }

  // Read currently mounted entries
  _readMounts() {
    const [success, content] = GLib.file_get_contents(MTAB);

    if (success) {
      const contentLines = imports.byteArray.toString(content);
      this.mountsAvail.forEach(mount => {
        mount.mounted = (contentLines.indexOf(mount.mountPoint) === -1) ? false : true;
      });
    }

    // Rebuild the panel menu based on new values
    if (this._indicator) {
      this._indicator.buildMenu();
    }
  }
}

function init() {
  log(`Initializing ${Local.metadata.name} version ${Local.metadata.version}`);
}

let _mounter;

function enable() {
  log(`Enabling ${Local.metadata.name} version ${Local.metadata.version}`);
  _mounter = new Mounter();
}

function disable() {
  log(`Disabling ${Local.metadata.name} version ${Local.metadata.version}`);

  // Clean up
  if (_mounter !== null) {
    _mounter.destroy();
    _mounter = null;
  }
}
