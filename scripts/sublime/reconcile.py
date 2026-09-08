"""Preflight the whole ownership set before any mutation. No note deletions."""
import re
from urllib.parse import urlencode
from etapi import Refused
from package import MARKER, OWNER, package, stable_id


def attribute(note, name, value=""):
    return dict(attributeId=stable_id(note["key"] + ":" + name), noteId=note["noteId"],
                type="label", name=name, value=value, isInheritable=False)


def check_attribute(actual, expected):
    if any(actual.get(key) != value for key, value in expected.items()):
        raise Refused("Conflicting or inherited customization attribute")


def plan(api, parent_id, mode):
    if not re.fullmatch(r"[A-Za-z0-9_]{4,128}", parent_id) or parent_id == "root":
        raise Refused("Select an existing unique parent note ID, not the universal root")
    if api.request("GET", "/app-info").get("appVersion") != "0.104.1":
        raise Refused("Target must be Trilium v0.104.1")
    parent = api.request("GET", "/notes/" + parent_id)
    if parent.get("isProtected") or parent.get("noteId") != parent_id:
        raise Refused("Target parent is unavailable or protected")
    if any(a["name"] in (MARKER, "appCss", "widget", "run") or a["name"].startswith("child:")
           or a.get("isInheritable") for a in parent.get("attributes", [])):
        raise Refused("Target parent has activation, inherited or child-copy attributes")
    notes = package()
    ids = {n["noteId"] for n in notes}
    if parent_id in ids:
        raise Refused("Target parent cannot be part of the managed package")
    found = api.request("GET", "/notes?" + urlencode(dict(search="#" + MARKER,
                        includeArchivedNotes="true", limit=1000)))["results"]
    if len(found) >= 1000 or any(n["noteId"] not in ids for n in found):
        raise Refused("Ambiguous ownership search; foreign or excessive marked notes")
    current = {}
    for note in notes:
        actual = api.request("GET", "/notes/" + note["noteId"], missing=True)
        expected_parent = parent_id if note["key"] == "root" else stable_id("root")
        attrs = [attribute(note, MARKER, OWNER)]
        if note["activation"]:
            attrs.append(attribute(note, note["activation"]))
        # IDs in the global attribute namespace must also be unambiguous before writes.
        for expected in attrs:
            existing = api.request("GET", "/attributes/" + expected["attributeId"], missing=True)
            if existing:
                check_attribute(existing, expected)
                if actual is None:
                    raise Refused("Orphaned customization attribute")
        if actual:
            if (actual.get("parentNoteIds") != [expected_parent] or actual.get("isProtected")
                    or actual.get("type") != note["type"] or actual.get("mime") != note["mime"]):
                raise Refused("Owned note moved, cloned, protected or changed kind")
            owned = actual.get("attributes", [])
            markers = [a for a in owned if a["name"] == MARKER]
            if len(markers) != 1:
                raise Refused("Missing or duplicate ownership marker; manual inspection required")
            check_attribute(markers[0], attrs[0])
            for existing in owned:
                matches = [a for a in attrs if a["attributeId"] == existing["attributeId"]]
                if len(matches) != 1:
                    raise Refused("Unexpected owned/inherited attribute; refusing to overwrite")
                check_attribute(existing, matches[0])
            actual["content"] = api.request("GET", "/notes/" + note["noteId"] + "/content", text=True)
        elif any(n["noteId"] == note["noteId"] for n in found):
            raise Refused("Ownership changed during preflight")
        current[note["noteId"]] = actual
    operations = []
    if mode == "disable":
        for note in notes:
            actual = current[note["noteId"]]
            if actual and note["activation"]:
                for a in actual["attributes"]:
                    if a["name"] == note["activation"]:
                        operations.append(("DELETE", "/attributes/" + a["attributeId"], None, False))
        return operations
    changed = any(not current[n["noteId"]] or any(current[n["noteId"]][k] != n[k]
                  for k in ("title", "content")) for n in notes)
    # A failed update stays disabled for new sessions; do not activate incomplete source.
    if changed:
        for note in notes:
            actual = current[note["noteId"]]
            if actual and note["activation"]:
                for a in actual["attributes"]:
                    if a["name"] == note["activation"]:
                        operations.append(("DELETE", "/attributes/" + a["attributeId"], None, False))
    for note in notes:
        actual = current[note["noteId"]]
        if actual is None:
            body = {k: note[k] for k in ("noteId", "title", "type", "mime", "content")}
            body["parentNoteId"] = parent_id if note["key"] == "root" else stable_id("root")
            operations.append(("POST", "/create-note", body, False))
            operations.append(("POST", "/attributes", attribute(note, MARKER, OWNER), False))
        else:
            if actual["title"] != note["title"]:
                operations.append(("PATCH", "/notes/" + note["noteId"], {"title": note["title"]}, False))
            if actual["content"] != note["content"]:
                operations.append(("PUT", "/notes/" + note["noteId"] + "/content", note["content"], True))
    for note in notes:
        actual = current[note["noteId"]]
        if note["activation"] and (changed or actual is None or not any(
                a["name"] == note["activation"] for a in actual["attributes"])):
            operations.append(("POST", "/attributes", attribute(note, note["activation"]), False))
    return operations


def execute(api, operations):
    for method, path, body, text in operations:
        api.request(method, path, body, text=text)
    return dict(operations=len(operations), created=sum(path == "/create-note" for _, path, _, _ in operations))
