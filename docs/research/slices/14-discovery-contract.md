# 14 — Local discovery provider contract

Tasklens `crates/tl-collect/src/sysroot.rs` caps file reads and reports
truncation separately; NetWatch-alt `src/ui/connections.rs` separates
collector coverage from its rows. Sloppytop's independent implementation
uses a provider envelope with a source, platform, UTC observation time,
rows, and stable issue codes. `empty` means a successful zero-row read;
`unavailable` means no usable observation; `partial` retains useful rows
alongside an issue; `truncated` takes precedence over other issues.

File reads require a regular file and stop at 512 KiB plus one byte.
Native commands use fixed argument lists, a 1.5-second timeout, and a
512 KiB output cap; they do not invoke a shell. The envelope retains
at most 4096 rows and excludes a clipped final line. No socket, DNS,
storage, or existing CLI code is in the provider layer. Unit fixtures
cover empty, permission and missing-tool outcomes, malformed input,
partial rows, and both byte and row clipping.
