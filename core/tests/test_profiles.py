from __future__ import annotations

from pathlib import Path

from xray import profiles


def test_load_missing_returns_empty(tmp_path: Path):
    result = profiles.load(tmp_path / "missing.yml")
    assert result.profiles == {}


def test_save_and_load_round_trip(tmp_path: Path):
    path = tmp_path / "p.yml"
    src = profiles.ProfilesFile(
        profiles={
            "staging": profiles.Profile(
                vars={"base_url": "https://stg.example.com"},
                auth=profiles.AuthSpec(kind="bearer", config={"token_env": "STG_TOKEN"}),
            )
        }
    )
    profiles.save(src, path)
    loaded = profiles.load(path)
    assert loaded.profiles["staging"].vars["base_url"] == "https://stg.example.com"
    assert loaded.profiles["staging"].auth.kind == "bearer"


def test_get_returns_profile_or_none(tmp_path: Path):
    path = tmp_path / "p.yml"
    profiles.save(
        profiles.ProfilesFile(profiles={"local": profiles.Profile(vars={"x": 1})}),
        path,
    )
    assert profiles.get("local", path).vars == {"x": 1}
    assert profiles.get("nope", path) is None
