{
  description = "DoneThat – AI activity tracker (Electron) packaged for NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        # "x86_64-darwin"
        # "aarch64-darwin"
      ];

      # Home Manager module. Usage in a home configuration:
      #
      #   imports = [ inputs.donethat.homeManagerModules.donethat ];
      #   programs.donethat = {
      #     enable = true;
      #     gnomeWindowTracker.enable = true;  # GNOME Wayland active-window tracking
      #     screenshotHelper.enable = true;    # Wayland screen capture helper
      #   };
      #
      # That installs the app and, opt-in, the bundled "DoneThat Window Tracker"
      # Shell extension (active-window tracking on GNOME Wayland) and the
      # donethat-screenshot helper (portal/PipeWire screen capture on Wayland).
      # Log out and back in once for the extension to load (Wayland cannot
      # hot-reload GNOME Shell).
      flake.homeManagerModules =
        let
          uuid = "donethat-window-tracker@donethat.ai";

          donethatModule =
            {
              config,
              lib,
              pkgs,
              ...
            }:
            let
              cfg = config.programs.donethat;
            in
            {
              options.programs.donethat = {
                enable = lib.mkEnableOption "DoneThat, the AI activity tracker";

                package = lib.mkOption {
                  type = lib.types.package;
                  default = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.donethat;
                  defaultText = lib.literalExpression "donethat.packages.\${system}.donethat";
                  description = "The DoneThat package to install.";
                };

                gnomeWindowTracker = {
                  enable = lib.mkOption {
                    type = lib.types.bool;
                    default = false;
                    example = true;
                    description = ''
                      Install the bundled GNOME Shell extension into the user
                      profile. Enable this on GNOME Wayland, where ordinary apps
                      cannot read the focused window and active-window tracking
                      depends on the extension. It is unnecessary (and inert) on
                      X11 and non-GNOME desktops.
                    '';
                  };

                  autoEnable = lib.mkOption {
                    type = lib.types.bool;
                    default = true;
                    description = ''
                      Enable the extension via dconf
                      (org/gnome/shell enabled-extensions).

                      Home Manager writes this key wholesale, so it overrides any
                      extensions you enabled outside Home Manager. If you manage
                      enabled-extensions yourself, set this to false and add
                      "${uuid}" to your own list instead.
                    '';
                  };
                };

                screenshotHelper = {
                  enable = lib.mkOption {
                    type = lib.types.bool;
                    default = false;
                    example = true;
                    description = ''
                      Install `donethat-screenshot`, a portal/PipeWire-based
                      screen capture helper for Wayland. gnome-screenshot and most
                      CLI capture tools are silent no-ops on GNOME Wayland; point
                      DoneThat's screenshot-tool setting at
                      `donethat-screenshot -f "%s"`. The first run pops a
                      screen-picker; later runs reuse the cached restore token.
                    '';
                  };

                  package = lib.mkOption {
                    type = lib.types.package;
                    default = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.donethat-screenshot;
                    defaultText = lib.literalExpression "donethat.packages.\${system}.donethat-screenshot";
                    description = "The donethat-screenshot helper package to install.";
                  };
                };
              };

              config = lib.mkIf cfg.enable (
                lib.mkMerge [
                  { home.packages = [ cfg.package ]; }

                  (lib.mkIf cfg.gnomeWindowTracker.enable {
                    # Symlink into the directory GNOME Shell ALWAYS searches, so
                    # this does not depend on the session having the Nix profile
                    # in XDG_DATA_DIRS (which standalone Home Manager + GNOME does
                    # not reliably provide for extensions).
                    home.file.".local/share/gnome-shell/extensions/${uuid}".source =
                      "${cfg.package}/share/gnome-shell/extensions/${uuid}";
                  })

                  (lib.mkIf (cfg.gnomeWindowTracker.enable && cfg.gnomeWindowTracker.autoEnable) {
                    dconf.settings."org/gnome/shell".enabled-extensions = [ uuid ];
                  })

                  (lib.mkIf cfg.screenshotHelper.enable {
                    home.packages = [ cfg.screenshotHelper.package ];
                  })
                ]
              );
            };
        in
        {
          donethat = donethatModule;
          default = donethatModule;
        };

      perSystem =
        { system, lib, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            # Electron is unfree.
            config.allowUnfree = true;
          };

          # get-windows ships ABI-stable N-API prebuilt binaries, so any recent
          # nixpkgs electron works regardless of the 41.x pinned in package.json.
          electron = pkgs.electron;

          # Runtime libraries Electron/Chromium and the bundled native modules
          # (get-windows prebuilds) need to be patched against / found at runtime.
          runtimeLibs = with pkgs; [
            stdenv.cc.cc.lib
            glib
            nss
            nspr
            atk
            at-spi2-atk
            at-spi2-core
            cups
            dbus
            expat
            libdrm
            libxkbcommon
            mesa
            pango
            cairo
            gtk3
            gdk-pixbuf
            alsa-lib
            # X11 / window-info stack used by get-windows on X11 sessions.
            xorg.libX11
            xorg.libXext
            xorg.libXrandr
            xorg.libXcomposite
            xorg.libXdamage
            xorg.libXfixes
            xorg.libXcursor
            xorg.libXi
            xorg.libXtst
            xorg.libxcb
            xorg.libXScrnSaver
          ];

          desktopItem = pkgs.makeDesktopItem {
            name = "donethat";
            desktopName = "DoneThat";
            exec = "donethat %U";
            icon = "donethat";
            comment = "AI activity tracker";
            categories = [ "Utility" ];
            startupWMClass = "donethat";
            mimeTypes = [ "x-scheme-handler/donethat" ];
          };

          donethat = pkgs.buildNpmPackage (finalAttrs: {
            pname = "donethat";
            version = "2.2.6";

            src = ./.;

            # Run `nix build` once with this set to lib.fakeHash, then replace it
            # with the sha256 Nix prints in the resulting error.
            npmDepsHash = "sha256-OHr4INsyOYZpTYde3rbkKobDu8vs+UA/OsdRbpBrDkA=";

            # Skip lifecycle scripts: `postinstall` runs build-os-helpers (macOS
            # only) or electron-builder install-app-deps (needs network). We do
            # the real build (css + webpack) explicitly in buildPhase instead.
            npmFlags = [ "--ignore-scripts" ];

            # Do not let any transitive script try to download an Electron binary;
            # we wrap nixpkgs' electron at install time.
            env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

            nativeBuildInputs = with pkgs; [
              makeWrapper
              python3
              autoPatchelfHook
            ];

            buildInputs = runtimeLibs;

            # buildNpmPackage's default build runs `npm run build`, which would
            # invoke electron-builder. We only need the renderer assets.
            dontNpmBuild = true;

            buildPhase = ''
              runHook preBuild
              npm run build:css
              npm run build:webpack
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              appdir=$out/share/donethat
              mkdir -p "$appdir"

              # Files electron-builder would package (see package.json "build.files").
              cp -r \
                main.js \
                firebase-config.js \
                package.json \
                src \
                build \
                resources \
                src-main \
                node_modules \
                "$appdir/"

              # Native helper binaries (macOS only) – copy if present.
              [ -d bin ] && cp -r bin "$appdir/" || true

              makeWrapper ${electron}/bin/electron $out/bin/donethat \
                --add-flags "$appdir" \
                --add-flags "--ozone-platform-hint=auto" \
                --add-flags "--enable-features=UseOzonePlatform,WaylandWindowDecorations" \
                --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath runtimeLibs}" \
                --set-default ELECTRON_IS_DEV 0

              install -Dm644 resources/icon-launcher.png \
                "$out/share/icons/hicolor/512x512/apps/donethat.png"

              mkdir -p "$out/share/applications"
              ln -s ${desktopItem}/share/applications/* "$out/share/applications/"

              # Ship the GNOME Shell extension that enables active-window tracking
              # on Wayland. Enable it per-user with:
              #   gnome-extensions enable donethat-window-tracker@donethat.ai
              ext=donethat-window-tracker@donethat.ai
              mkdir -p "$out/share/gnome-shell/extensions"
              cp -r "resources/gnome-extension/$ext" \
                "$out/share/gnome-shell/extensions/$ext"

              runHook postInstall
            '';

            meta = {
              description = "DoneThat – AI activity tracker (Electron)";
              homepage = "https://github.com/donethatai/donethat-electron";
              license = lib.licenses.gpl3Plus;
              platforms = lib.platforms.linux;
              mainProgram = "donethat";
            };
          });

          # Portal/PipeWire screen capture helper for Wayland, where
          # gnome-screenshot and most CLI tools are silent no-ops. Wired into
          # the Home Manager module via programs.donethat.screenshotHelper.
          donethat-screenshot = import ./nix/donethat-screenshot.nix { inherit pkgs; };
        in
        {
          packages.default = donethat;
          packages.donethat = donethat;
          packages.donethat-screenshot = donethat-screenshot;

          apps.default = {
            type = "app";
            program = lib.getExe donethat;
          };

          # `nix develop` – reproducible env to run `npm ci && npm run dev:linux`.
          devShells.default = pkgs.mkShell {
            packages =
              with pkgs;
              [
                nodejs_22
                electron
                python3
                pkg-config
              ]
              ++ runtimeLibs;

            # So `electron .` inside the shell prefers Wayland when available.
            ELECTRON_OZONE_PLATFORM_HINT = "auto";
            LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibs;

            shellHook = ''
              echo "DoneThat dev shell. Try:"
              echo "  npm ci"
              echo "  npm run build:prepare"
              echo "  electron . --ozone-platform-hint=auto"
            '';
          };
        };
    };
}
