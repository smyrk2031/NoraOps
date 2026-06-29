"""Auth identity errors (kept separate to avoid import cycles)."""


class IdentityCollisionError(Exception):
    """Two Gitea users share the same verified email; manual merge required."""

    def __init__(self, email: str, gitea_logins: list[str]) -> None:
        self.email = email
        self.gitea_logins = gitea_logins
        super().__init__(
            f"Email {email} is linked to multiple Gitea users: {', '.join(gitea_logins)}. "
            "Contact an administrator to merge accounts."
        )
