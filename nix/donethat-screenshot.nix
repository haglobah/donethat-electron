# Wayland screenshot helper for DoneThat.
#
# gnome-screenshot and most CLI capture tools are silent no-ops on GNOME
# Wayland. This wraps a portal/PipeWire-based capture script so DoneThat can
# grab screenshots there. Point DoneThat's screenshot-tool setting at:
#   donethat-screenshot -f "%s"
{ pkgs }:
let
  python = pkgs.python3.withPackages (
    ps: with ps; [
      pygobject3
      pillow
    ]
  );

  # gst_all_1.gstreamer's default output is "bin"; typelibs and plugins live in "out".
  gstreamerOut = pkgs.gst_all_1.gstreamer.out;

  gstPluginPath = pkgs.lib.makeSearchPath "lib/gstreamer-1.0" [
    gstreamerOut
    pkgs.gst_all_1.gst-plugins-base
    pkgs.gst_all_1.gst-plugins-good
    pkgs.pipewire
  ];

  typelibPath = pkgs.lib.makeSearchPath "lib/girepository-1.0" [
    gstreamerOut
    pkgs.gst_all_1.gst-plugins-base
    pkgs.gobject-introspection
  ];

  script = pkgs.writeText "donethat-screenshot.py" ''
    #!${python}/bin/python3
    """
    Wayland screenshot helper for DoneThat.

    Uses xdg-desktop-portal's ScreenCast interface (not Screenshot) so that the
    user only consents once: the first run pops a screen-picker; subsequent
    runs reuse the restore_token cached at ~/.cache/portal-screenshot/.

    Based on Recursing's gist linked from donethat.ai/install/linux:
    https://gist.github.com/Recursing/813aee5bfa27b521a720d7c1eba3cb03
    """
    import argparse
    import json
    import sys
    from pathlib import Path
    from PIL import Image
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gio, GLib, Gst

    Gst.init(None)

    PORTAL = "org.freedesktop.portal.Desktop"
    PORTAL_PATH = "/org/freedesktop/portal/desktop"
    SCREENCAST = "org.freedesktop.portal.ScreenCast"
    REQUEST = "org.freedesktop.portal.Request"
    TOKEN_PATH = Path.home() / ".cache" / "portal-screenshot" / "token.json"

    def load_token():
        try:
            return (
                json.loads(TOKEN_PATH.read_text()).get("restore_token")
                if TOKEN_PATH.exists()
                else None
            )
        except (json.JSONDecodeError, OSError):
            return None

    def save_token(token):
        try:
            TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
            TOKEN_PATH.write_text(json.dumps({"restore_token": token}))
        except OSError:
            pass

    def main():
        parser = argparse.ArgumentParser(description="Take a screenshot on Wayland")
        parser.add_argument(
            "-f", "--file",
            type=Path,
            default=Path("screenshot.png"),
            help="Output file path (default: screenshot.png)",
        )
        args = parser.parse_args()
        output_path = args.file

        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        loop = GLib.MainLoop()
        state = {"session": None, "token": load_token()}

        def call(method, signature, call_args, callback, options=None):
            token = f"tok_{GLib.get_monotonic_time()}"
            sender = bus.get_unique_name().replace(".", "_").lstrip(":")
            bus.signal_subscribe(
                PORTAL, REQUEST, "Response",
                f"{PORTAL_PATH}/request/{sender}/{token}",
                None, 0, callback,
            )

            opts = {"handle_token": GLib.Variant("s", token)}
            if method == "CreateSession":
                opts["session_handle_token"] = GLib.Variant(
                    "s", f"sess_{GLib.get_monotonic_time()}"
                )
            if options:
                opts.update(options)

            bus.call_sync(
                PORTAL, PORTAL_PATH, SCREENCAST, method,
                GLib.Variant(signature, (*call_args, opts)),
                None, 0, -1, None,
            )

        def on_session(*callback_args):
            response, results = callback_args[-1].unpack()
            if response != 0:
                print("Failed to create session", file=sys.stderr)
                return loop.quit()

            state["session"] = results["session_handle"]
            options = {
                "types": GLib.Variant("u", 3),
                "multiple": GLib.Variant("b", False),
                "persist_mode": GLib.Variant("u", 2),
            }
            if state["token"]:
                options["restore_token"] = GLib.Variant("s", state["token"])

            call("SelectSources", "(oa{sv})", (state["session"],), on_sources, options)

        def on_sources(*callback_args):
            if callback_args[-1].unpack()[0] != 0:
                print("Source selection failed or was cancelled", file=sys.stderr)
                return loop.quit()

            call("Start", "(osa{sv})", (state["session"], ""), on_start)

        def on_start(*callback_args):
            response, results = callback_args[-1].unpack()
            if response != 0 or not results.get("streams"):
                print("Failed to start stream", file=sys.stderr)
                return loop.quit()

            if token := results.get("restore_token"):
                save_token(token)

            node = results["streams"][0][0]
            fd_result = bus.call_with_unix_fd_list_sync(
                PORTAL, PORTAL_PATH, SCREENCAST, "OpenPipeWireRemote",
                GLib.Variant("(oa{sv})", (state["session"], {})),
                None, 0, -1, None, None,
            )

            fd = fd_result[1].get(fd_result[0].unpack()[0])
            pipeline = Gst.parse_launch(
                f"pipewiresrc fd={fd} path={node} ! videoconvert ! "
                "video/x-raw,format=RGB ! appsink name=sink emit-signals=true max-buffers=1 drop=true"
            )

            def on_frame(sink):
                sample = sink.emit("pull-sample")
                if not sample:
                    return Gst.FlowReturn.OK

                buf = sample.get_buffer()
                caps = sample.get_caps()
                width = caps.get_structure(0).get_value("width")
                height = caps.get_structure(0).get_value("height")

                success, map_info = buf.map(Gst.MapFlags.READ)
                if success:
                    Image.frombytes("RGB", (width, height), map_info.data).save(output_path)
                    print(f"Saved: {output_path}")
                    buf.unmap(map_info)

                def cleanup():
                    pipeline.set_state(Gst.State.NULL)
                    loop.quit()
                    return False

                GLib.idle_add(cleanup)
                return Gst.FlowReturn.EOS

            pipeline.get_by_name("sink").connect("new-sample", on_frame)
            pipeline.set_state(Gst.State.PLAYING)

        call("CreateSession", "(a{sv})", (), on_session)
        loop.run()

    if __name__ == "__main__":
        main()
  '';
in
pkgs.writeShellApplication {
  name = "donethat-screenshot";
  text = ''
    # Set at exec time so xdg-desktop-portal sees it in /proc/<pid>/environ
    # (in-process os.environ updates don't propagate there).
    export DESKTOP_FILE_ID=donethat-screenshot
    export GST_PLUGIN_SYSTEM_PATH_1_0="${gstPluginPath}''${GST_PLUGIN_SYSTEM_PATH_1_0:+:$GST_PLUGIN_SYSTEM_PATH_1_0}"
    export GI_TYPELIB_PATH="${typelibPath}''${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
    exec ${python}/bin/python3 ${script} "$@"
  '';
}
