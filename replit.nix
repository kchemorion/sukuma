{pkgs}: {
  deps = [
    pkgs.rpm
    pkgs.nodejs
    pkgs.nodePackages.typescript-language-server
    pkgs.postgresql
  ];
}
