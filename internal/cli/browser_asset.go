package cli

import "piwork/internal/localweb"

// Browser modules are embedded build artifacts. Accept one plain filename,
// never a path supplied by the browser or a file from the host filesystem.
var nativeBrowserAsset = localweb.BrowserAsset
