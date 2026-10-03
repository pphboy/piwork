package cli

import "regexp"

// Browser modules are embedded build artifacts. Accept one plain filename,
// never a path supplied by the browser or a file from the host filesystem.
var nativeBrowserAsset = regexp.MustCompile(`^[a-z][a-z0-9-]*\.js$`)
