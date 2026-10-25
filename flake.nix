{
  description = "Open source documentation platform for OpenAPI specs and markdown";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
      in {
        packages.default = pkgs.buildNpmPackage {
          pname = "sourcey";
          inherit version;
          src = self;

          npmDepsFetcherVersion = 2;
          npmDepsHash = "sha256-yBc6guOTTDVm3cnzH/vN+v1E/yjOXGEX6BhEMMcELCY=";
          makeCacheWritable = true;
          npmFlags = [ "--legacy-peer-deps" ];
          dontNpmPrune = true;

          meta = with pkgs.lib; {
            description = "Open source documentation platform for OpenAPI specs and markdown";
            homepage = "https://sourcey.com";
            license = licenses.agpl3Only;
            platforms = platforms.linux ++ platforms.darwin;
            mainProgram = "sourcey";
          };
        };

        apps.default = flake-utils.lib.mkApp {
          drv = self.packages.${system}.default;
          exePath = "/bin/sourcey";
        };
      });
}
