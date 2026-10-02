// Package desktopassets contains the browser UI compiled into the Go CLI.
// The source stays in apps/desktop-webui; Node is used only at build time.
package desktopassets

import "embed"

//go:embed static/browser/*.js static/public/*
var FS embed.FS
