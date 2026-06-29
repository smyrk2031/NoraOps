from app.noraops.services.concierge_prompt_template import (
    render_copilot_prompt_from_template,
)


def test_render_template_substitution():
    t = "A{{problem}}B\n{{repo_guidance}}C"
    out = render_copilot_prompt_from_template(
        t,
        {"problem": "X", "repo_guidance": "Y"},
    )
    assert out == "AXB\nYC"
