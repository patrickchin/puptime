# Repository workflow

- Submit and merge all changes through a GitHub pull request. Do not push directly to `main`.

# UI work in Codex

- Use labels, layout, and interaction states to make controls self-explanatory. Add instructional copy only for non-obvious actions, constraints, or consequences.
- When a heading clearly identifies the screen's only input, use it as the visible label rather than repeating the same wording above the field. Keep an accessible input name and show optional/required status once. Check the rendered screen for duplicated wording.
- After changing UI, run the affected screen and show fresh screenshots inline in the final response. If it cannot run, say why.
- When native verification needs a simulator or emulator, use one dedicated to this worktree and name it for the task or branch.
- On macOS, use iOS Simulator as the default for native runtime and UI verification. For shared app changes, assume Android behaves the same and avoid duplicating simulator tests. Run Android verification when the change introduces or touches Android-specific behavior, code, or configuration. Report which platform was actually tested; distinguish assumed parity from verified behavior.
- For interactions on data-heavy screens, test with populated history on the default verification platform and check that local editor or detail state does not redraw unchanged rows.
