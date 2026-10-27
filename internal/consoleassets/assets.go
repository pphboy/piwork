package consoleassets

import "embed"

// FS contains the independently built Console browser application.
//go:embed static/public/* static/browser/*.js static/browser/i18n/*.js
var FS embed.FS
