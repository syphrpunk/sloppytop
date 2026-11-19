cask "sloppytop" do
  version "0.3.0"
  sha256 "c5825779a0e77836c72545b812a290e999a9972e0b058ca4223993ff38e2c684"

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
  # real home except paths this step marks writable. The published binary's
  # `record` stores the sample; `service install` starts the hourly agent.
  postflight_steps do
    run "bin/sloppytop",
        args:           ["record"],
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
