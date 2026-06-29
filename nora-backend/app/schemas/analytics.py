from pydantic import BaseModel


class AppSummary(BaseModel):
    full_name: str
    stars: int
    updated_at: str | None = None
    has_release: bool
    topics: list[str]
    readme_hint: str | None = None


class KnowledgeInsight(BaseModel):
    title: str
    description: str
    source_repos: list[str]


class WorkflowInsight(BaseModel):
    name: str
    repositories: int
    description: str


class PolicyViolation(BaseModel):
    full_name: str
    violation_type: str
    detail: str
    severity: str
