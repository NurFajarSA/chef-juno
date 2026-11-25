class UserRepo:
    def get(self, user_id):
        return {"id": user_id, "name": "Juno"}


def get_user(user_id):
    return UserRepo().get(user_id)


def greet(user_id):
    user = get_user(user_id)
    return "Halo " + user["name"]
