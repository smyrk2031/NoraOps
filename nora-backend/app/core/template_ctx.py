"""Jinja2 TemplateResponse 用の root_path コンテキスト。"""

from __future__ import annotations

from fastapi import Request
from fastapi.templating import Jinja2Templates

from app.core.root_path import template_context

_templates = Jinja2Templates(directory="app/templates")


def get_templates() -> Jinja2Templates:
    return _templates


def render_template(request: Request, name: str, context: dict | None = None, **kwargs):
    return _templates.TemplateResponse(
        request=request,
        name=name,
        context=template_context(request, context),
        **kwargs,
    )
