from app.users import get_user


def profile_name(user_id):
    return get_user(user_id)["name"]
