package contracts

// CoreStatus is the public, non-secret projection used by native clients and
// the browser control plane. HasUsers is deliberately separate from readiness:
// disabling an administrator must never reopen first-user creation.
type CoreStatus struct {
	State  string `json:"state"`
	Ready  bool   `json:"ready"`
	Checks struct {
		Administrator            bool `json:"administrator"`
		RuntimeConfigured        bool `json:"runtimeConfigured"`
		RuntimeAvailable         bool `json:"runtimeAvailable"`
		FilesystemMigrationReady bool `json:"filesystemMigrationReady"`
	} `json:"checks"`
}

type PreparationComponent struct {
	State             string  `json:"state"`
	Attempt           int     `json:"attempt"`
	RetryAfterSeconds *int    `json:"retryAfterSeconds"`
	Code              *string `json:"code"`
}

type Preparation struct {
	Version    int                             `json:"version"`
	Ready      bool                            `json:"ready"`
	Components map[string]PreparationComponent `json:"components"`
}

type ControlStatus struct {
	CoreStatus
	HasUsers    bool        `json:"hasUsers"`
	Preparation Preparation `json:"preparation"`
}

type BootstrapResult struct {
	UserID  string `json:"userId"`
	Account string `json:"account"`
}
