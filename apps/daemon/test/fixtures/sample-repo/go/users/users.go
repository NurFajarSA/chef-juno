package users

type User struct {
	ID   string
	Name string
}

func GetUser(id string) *User {
	return &User{ID: id, Name: "Juno"}
}

func Greet(id string) string {
	u := GetUser(id)
	return "Halo " + u.Name
}
