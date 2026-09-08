"""In-memory subset of the v0.104.1 ETAPI contract. No network or credentials."""
from copy import deepcopy
from urllib.parse import urlsplit, parse_qs
from etapi import Refused
from package import MARKER


class Fixture:
    def __init__(self):
        self.notes = {"fixtureParent": dict(noteId="fixtureParent", title="Fixture parent", type="text",
                      mime="text/html", content="Knowledge stays intact", parentNoteIds=["root"],
                      attributes=[], isProtected=False)}
        self.attrs = {}
        self.writes = []
        self.version = "0.104.1"

    def request(self, method, path, body=None, text=False, missing=False):
        parts = urlsplit(path)
        route = parts.path.strip("/").split("/")
        if method == "GET":
            if route == ["app-info"]:
                return {"appVersion": self.version}
            if route == ["notes"]:
                query = parse_qs(parts.query)
                assert query["search"] == ["#" + MARKER]
                assert query["includeArchivedNotes"] == ["true"]
                return {"results": [deepcopy(n) for n in self.notes.values()
                                    if any(a["name"] == MARKER for a in n["attributes"])][:1000]}
            target = self.notes if route[0] == "notes" else self.attrs
            found = target.get(route[1])
            if found is None:
                if missing:
                    return None
                raise Refused("Fixture entity not found")
            return deepcopy(found["content"] if len(route) == 3 else found)
        self.writes.append((method, path, deepcopy(body)))
        if method == "POST" and route == ["create-note"]:
            assert set(body) == {"noteId", "parentNoteId", "title", "type", "mime", "content"}
            assert body["noteId"] not in self.notes
            assert body["parentNoteId"] in self.notes
            note = {k: v for k, v in body.items() if k != "parentNoteId"}
            note.update(parentNoteIds=[body["parentNoteId"]], attributes=[], isProtected=False)
            self.notes[note["noteId"]] = note
            return {"note": deepcopy(note), "branch": {}}
        if method == "POST" and route == ["attributes"]:
            assert body["attributeId"] not in self.attrs
            assert body["noteId"] in self.notes
            self.attrs[body["attributeId"]] = deepcopy(body)
            self.notes[body["noteId"]]["attributes"].append(self.attrs[body["attributeId"]])
            return deepcopy(body)
        if method == "DELETE" and route[0] == "attributes":
            attr = self.attrs.pop(route[1])
            self.notes[attr["noteId"]]["attributes"].remove(attr)
            return None
        if method == "PATCH" and route[0] == "notes":
            assert set(body) == {"title"}
            self.notes[route[1]].update(body)
            return deepcopy(self.notes[route[1]])
        if method == "PUT" and route[0] == "notes" and route[2] == "content":
            assert text
            self.notes[route[1]]["content"] = body
            return None
        raise AssertionError("Unsupported fixture operation")
