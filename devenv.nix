{ pkgs, lib, config, ... }:
let
  pnpmRun = import ./devenv/pnpm-run.nix { inherit lib; };
  syncDocsExec = import ./devenv/sync-docs.nix { inherit pkgs lib config; };
in
{
  packages = [ pkgs.git ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
    pnpm.enable = true;
  };

  scripts = {
    build = {
      description = "pnpm run build : vite build";
      exec = pnpmRun "build";
    };
    dev = {
      description = "pnpm run dev : vite";
      exec = pnpmRun "dev";
    };
    fmt = {
      description = "pnpm run fmt : prettier --write";
      exec = pnpmRun "fmt";
    };
    typecheck = {
      description = "pnpm run typecheck : void prepare && tsrs --noEmit";
      exec = pnpmRun "typecheck";
    };
    test = {
      description = "pnpm run test";
      exec = pnpmRun "test";
    };
    sync-docs = {
      description = "devenvのscriptsからdocs/scripts.mdを更新。";
      exec = syncDocsExec;
    };
  };

  enterShell = ''
    echo "scripts や説明を変更したら、シェルを終了して入り直し、sync-docs を実行し, docs/scripts.md を更新してください。"
  '';
}
