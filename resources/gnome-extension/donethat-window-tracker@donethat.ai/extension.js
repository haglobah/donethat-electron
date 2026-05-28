// DoneThat Window Tracker — GNOME Shell extension.
//
// GNOME Wayland deliberately prevents ordinary apps from reading which window is
// focused. This extension runs inside GNOME Shell (which does have that
// information) and exposes a minimal, read-only D-Bus interface that the
// DoneThat desktop app polls. Only window metadata (app name, title, geometry)
// is exposed — never window contents.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME = 'ai.donethat.WindowTracker';
const OBJECT_PATH = '/ai/donethat/WindowTracker';

const DBUS_INTERFACE = `
<node>
  <interface name="ai.donethat.WindowTracker">
    <method name="GetFocusedWindow">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="GetWindows">
      <arg type="s" direction="out" name="json"/>
    </method>
  </interface>
</node>`;

function windowToObject(win) {
  if (!win) return null;
  try {
    const rect = win.get_frame_rect();
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    return {
      id: win.get_id(),
      title: win.get_title() || '',
      wmClass: win.get_wm_class() || '',
      appName: app ? app.get_name() : (win.get_wm_class() || ''),
      pid: win.get_pid(),
      bounds: rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null,
    };
  } catch (_e) {
    return null;
  }
}

export default class DoneThatWindowTracker extends Extension {
  enable() {
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE, this);
    this._dbusImpl.export(Gio.DBus.session, OBJECT_PATH);
    this._nameOwnerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
      null
    );
  }

  disable() {
    if (this._nameOwnerId) {
      Gio.bus_unown_name(this._nameOwnerId);
      this._nameOwnerId = 0;
    }
    if (this._dbusImpl) {
      this._dbusImpl.unexport();
      this._dbusImpl = null;
    }
  }

  GetFocusedWindow() {
    const win = global.display.get_focus_window();
    return JSON.stringify(windowToObject(win) || {});
  }

  GetWindows() {
    let windows = [];
    try {
      windows = global
        .get_window_actors()
        .map((actor) => windowToObject(actor.meta_window))
        .filter((w) => w !== null);
    } catch (_e) {
      windows = [];
    }
    return JSON.stringify(windows);
  }
}
