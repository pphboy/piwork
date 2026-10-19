package coreapp

import (
	"errors"
	"piwork/internal/identity"
)

func InitializationFromEnvironment(values map[string]string) (Initialization, error) {
	var initialization Initialization
	account, hasAccount := values["PIWORK_ADMIN_ACCOUNT"]
	password, hasPassword := values["PIWORK_ADMIN_PASSWORD"]
	if hasAccount != hasPassword {
		return initialization, errors.New("PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD must be provided together")
	}
	if hasAccount {
		if !regexpAccount(account) {
			return initialization, errors.New("PIWORK_ADMIN_ACCOUNT is invalid")
		}
		if identity.ValidatePassword(password) != nil {
			return initialization, errors.New("PIWORK_ADMIN_PASSWORD must contain at least 12 characters")
		}
		initialization.Administrator = &struct{ Account, Password string }{account, password}
	}
	return initialization, nil
}
