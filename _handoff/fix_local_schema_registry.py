from pathlib import Path
ROOT=Path(r'E:\Google-flow-skills')
p=ROOT/'src'/'gfs'/'artifact_store.py'
s=p.read_text(encoding='utf-8')
s=s.replace('from jsonschema import Draft202012Validator, RefResolver\n','from jsonschema import Draft202012Validator\nfrom referencing import Registry, Resource\n')
s=s.replace('''        self.root = root or repo_root()\n        self._docs: dict[tuple[str, str], Any] = {}\n''','''        self.root = root or repo_root()\n        self._docs: dict[tuple[str, str], Any] = {}\n        self._schema_registry = self._build_schema_registry()\n''')
insert='''\n    def _build_schema_registry(self) -> Registry:\n        registry = Registry()\n        for path in sorted((self.root / "schemas").glob("*.schema.json")):\n            data = json.loads(path.read_text(encoding="utf-8"))\n            resource = Resource.from_contents(data)\n            schema_id = data.get("$id")\n            if schema_id:\n                registry = registry.with_resource(schema_id, resource)\n            registry = registry.with_resource(path.resolve().as_uri(), resource)\n        return registry\n'''
marker='''    def _key(self, schema_name: str, artifact_key: str) -> tuple[str, str]:\n'''
if insert.strip() not in s:
 s=s.replace(marker,insert+'\n'+marker)
old='''        full_schema = json.loads(resolved.schema_path.read_text(encoding="utf-8"))\n        # RefResolver is deprecated upstream but remains the compatibility path in jsonschema\n        # 4.x for relative file refs; keeping it local avoids network resolution.\n        resolver = RefResolver(base_uri=resolved.schema_path.resolve().as_uri(), referrer=full_schema)\n        validator = Draft202012Validator(resolved.node, resolver=resolver)\n        errors = sorted(validator.iter_errors(value), key=lambda e: list(e.path))\n'''
new='''        full_schema = json.loads(resolved.schema_path.read_text(encoding="utf-8"))\n        base_id = full_schema.get("$id") or resolved.schema_path.resolve().as_uri()\n        # Validate through an absolute reference into the registered full schema. All\n        # referenced schemas are preloaded from /schemas, so validation can never fall\n        # back to DNS/HTTP.\n        target_uri = base_id + "#" + resolved.pointer\n        wrapper = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": target_uri}\n        validator = Draft202012Validator(wrapper, registry=self._schema_registry)\n        errors = sorted(validator.iter_errors(value), key=lambda e: list(e.path))\n'''
if old not in s: raise RuntimeError('old validator block not found')
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('ArtifactStore now resolves all schema references through a local-only registry')
