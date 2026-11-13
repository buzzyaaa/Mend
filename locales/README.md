# Locales (Native Shell / rust-i18n v1)

UI translations for the Native Shell (nsh) build of Mend. These files are the
rust-i18n v1 source of truth for the nsh runtime.

- **Format**: rust-i18n v1 - plain nested JSON, one file per locale. The file
  name is the locale code: `en.json` maps to `en`, `zh-CN.json` maps to
  `zh-CN`.
- **No `_version`**: v1 is rust-i18n's default and already means "one locale per
  file", so `_version` is omitted. Only add it if the format version changes.
- **Nested keys**: a flat key such as `entry.title` is stored as
  `{ "entry": { "title": "..." } }`. The `t!` call still uses
  `t!("entry.title")`.
- **Interpolation**: rust-i18n / NSH syntax is `%{name}`, not `{name}`. Literal
  braces that are not placeholders must be left alone.
- **Locale list**: the nsh manifest at the repo root, `nsh.json`, declares
  `"locales": ["en", "zh-CN"]`.
- **Key parity**: both files must keep exactly the same flattened key set
  (currently 210 leaf keys each). Do not add new UI keys here before they exist
  in the app.
- **Encoding**: UTF-8, 2-space indentation, trailing newline.

These files were migrated from `src/locales/*.json` by nesting the flat keys and
converting `{name}` placeholders to `%{name}`; the original files were not
modified.
