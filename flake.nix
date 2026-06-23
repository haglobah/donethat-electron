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
            version = "2.2.5";

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
        in
        {
          packages.default = donethat;
          packages.donethat = donethat;

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
