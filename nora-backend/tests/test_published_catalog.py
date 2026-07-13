"""Published catalog filters."""

from app.noraops.services.published_catalog import PublishedCatalogService


def test_filter_by_full_names_intersection():
    svc = PublishedCatalogService()
    items = [
        {"full_name": "alice/app-a", "name": "app-a", "topics": ["nora-published"]},
        {"full_name": "bob/app-b", "name": "app-b", "topics": ["nora-published"]},
        {"full_name": "alice/app-c", "name": "app-c", "topics": ["nora-published"]},
    ]
    allowed = {"alice/app-a", "alice/app-c"}
    out = svc.filter_by_full_names(items, allowed)
    names = {i["full_name"] for i in out}
    assert names == {"alice/app-a", "alice/app-c"}


def test_filter_by_full_names_owner_object():
    svc = PublishedCatalogService()
    items = [
        {"owner": {"login": "alice"}, "name": "app-a", "topics": ["nora-published"]},
    ]
    out = svc.filter_by_full_names(items, {"alice/app-a"})
    assert len(out) == 1


def test_scope_mine_empty_when_no_overlap():
    svc = PublishedCatalogService()
    published, _ = svc.filter_items(
        [{"full_name": "alice/app-a", "topics": ["nora-published"]}],
        topic="nora-published",
    )
    out = svc.filter_by_full_names(published, {"bob/other"})
    assert out == []
