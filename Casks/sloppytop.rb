cask "sloppytop" do
  version "0.4.0"
  sha256 "29a6df8f3b45fb3b2264a6c344594fd3a226c9072f5b5a1e17602d68c132483c"

  url "https://github.com/syphrpunk/sloppytop/releases/download/v#{version}/sloppytop-macos-arm64.tar.gz"
  name "Sloppytop"
  desc "Terminal process monitor that stores a performance log"
  homepage "https://github.com/syphrpunk/sloppytop"

  depends_on arch: :arm64

  binary "sloppytop-macos-arm64", target: "sloppytop"

  # Seatbelt can create files inside a directory that already exists. ~/.config
  # is not guaranteed. Create the parents here, and leave the store directory
  # itself to sloppytop so an existing ~/.config/neohtop log stays in use.
  # This step is the only one allowed to write the rest of the home.
  preflight_steps do
    run "/bin/mkdir",
        args:           ["-p", "/Users/{{user}}/.config", "/Users/{{user}}/Library/LaunchAgents"],
        writable_paths: ["/Users/{{user}}"]
  end

  # Postflight runs with HOME set to a temporary directory and cannot read the
  # real home except paths this step marks writable. As of v0.4.0,
  # `service install` stores the initial sample itself.
  postflight_steps do
    run "bin/sloppytop",
        args:           ["service", "install"],
        base:           :homebrew_prefix,
        env:            {
          "HOME"            => "/Users/{{user}}",
          "XDG_CONFIG_HOME" => "/Users/{{user}}/.config",
        },
        print_stdout:   true,
        writable_paths: [
          "/Users/{{user}}/.config",
          "/Users/{{user}}/Library/LaunchAgents",
        ]
  end

  uninstall_preflight_steps do
    run "bin/sloppytop",
        args:           ["service", "uninstall"],
        base:           :homebrew_prefix,
        env:            {
          "HOME"            => "/Users/{{user}}",
          "XDG_CONFIG_HOME" => "/Users/{{user}}/.config",
        },
        must_succeed:   false,
        writable_paths: ["/Users/{{user}}/Library/LaunchAgents"]
  end

  zap trash: "~/Library/LaunchAgents/com.syphrpunk.sloppytop.record.plist"

  caveats <<~EOS
    A performance sample is stored at install. An hourly recorder keeps writing.
    Read it with `sloppytop history`, `sloppytop report`, or `sloppytop tui` and press v.
    To stop scheduled recording, run `sloppytop service uninstall`.
    Uninstall keeps your history. Run `sloppytop config` to see the database path,
    including the legacy ~/.config/neohtop location if it is in use.
  EOS
end
