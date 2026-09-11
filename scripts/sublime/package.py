"""Deterministic packaging into supported CSS and frontend widget Code notes."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OWNER = "thg-sublime-phase1-v1"
MARKER = "thgSublimeOwner"
MODULES = ("typography", "tokens", "layout", "sidebar", "tabs", "editor", "status")
THEME_IDS = ("materialize", "spacegray", "soda-dark", "soda-light", "guna", "mariana",
             "cyberpunk-umbra", "cyberpunk-scarlet", "thg-sublime")


def stable_id(key):
    return "thgs" + hashlib.sha256((OWNER + ":" + key).encode()).hexdigest()[:24]


def theme_data():
    data = json.loads((ROOT / "sublime/themes.json").read_text())
    assert data["default"] == "thg-sublime"
    assert tuple(t["id"] for t in data["themes"]) == THEME_IDS
    for theme in data["themes"]:
        assert set(theme) == {"id", "name", "ui", "editor", "syntax"}
        for group, keys in (("ui", {"bg", "panel", "text", "muted", "border", "selection", "accent"}),
                            ("editor", {"bg", "text"}), ("syntax", {"comment", "keyword"})):
            assert set(theme[group]) == keys
            assert all(re.fullmatch(r"#[0-9a-fA-F]{6}", v) for v in theme[group].values())
    return data


def theme_css(data):
    def rule(theme, selector):
        variables = [f"    --thg-{group}-{key}: {value};" for group in ("ui", "editor", "syntax")
                     for key, value in theme[group].items()]
        # Syntax variables are a reserved mapping layer, not syntax integration.
        style = "light" if theme["id"] == "soda-light" else "dark"
        return selector + " {\n" + "\n".join(variables) + f"\n    color-scheme: {style};\n}}\n"
    default = next(t for t in data["themes"] if t["id"] == data["default"])
    return rule(default, ":root[data-thg-sublime]") + "\n".join(
        rule(t, f':root[data-thg-sublime="{t["id"]}"]') for t in data["themes"])


def package():
    data = theme_data()
    notes = [dict(key="root", title="THG Sublime — Phase 1", type="text", mime="text/html",
                  content="<p>Repo-managed THG Sublime customization. Disable using the reviewed operator tool. Knowledge notes are never deleted.</p>", activation=None)]
    for name in MODULES:
        notes.append(dict(key=name, title=f"THG Sublime / {name}", type="code", mime="text/css",
                          content=(ROOT / f"sublime/styles/{name}.css").read_text(), activation="appCss"))
    notes.append(dict(key="themes", title="THG Sublime / themes", type="code", mime="text/css",
                      content=theme_css(data), activation="appCss"))
    controller = ((ROOT / "sublime/language.js").read_text() + "\n" + (ROOT / "sublime/controller.js").read_text()).replace(
        "/*__THG_THEMES__*/ []", json.dumps([dict(id=t["id"], name=t["name"]) for t in data["themes"]]))
    notes.append(dict(key="controller", title="THG Sublime / status and themes", type="code",
                      mime="application/javascript;env=frontend", content=controller, activation="widget"))
    for note in notes:
        note["noteId"] = stable_id(note["key"])
    return notes
