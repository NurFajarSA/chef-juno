package handlers

import "example.com/sample/go/users"

func ProfileName(id string) string {
	return users.GetUser(id).Name
}
