package consoleassets

import "embed"

// FS contains the independently built Console browser application.
//go:embed static/public/* static/browser/*
var FS embed.FS
