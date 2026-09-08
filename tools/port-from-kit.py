"""Copies from the kit into this repository, and PROVES the only change is an import line.

The promise on the site is that the isolation module and the attack suite published here are the
SAME ones that ship in the paid kit. A hand-written copy stops being that the day either side
changes — and it already happened: this repository sat on the `catalogue.ts` from before the wire
filter fix, which is to say on the two leak assertions the kit's own audit report declares broken.

So the files are copied by script, and the script prints the diff. If it ever grows past an import
line, you see it, and so does anyone reading the output.

    python tools/port-from-kit.py          # kit at the default path
    SAK_KIT=/path/to/kit python tools/...  # or wherever yours is

Exit code 1 if any file failed to port or if a diff touched something other than an import.
"""
import difflib
import os
import pathlib
import re
import sys

KIT = pathlib.Path(os.environ.get("SAK_KIT", r"C:\xampp\htdocs\secure-ai-kit-next"))
PUB = pathlib.Path(__file__).resolve().parent.parent

# (source in the kit, destination here, import rewrites)
FILES = [
    ("attacks/catalogue.ts", "src/attacks/catalogue.ts", [
        ('import type { Message } from "../lib/provider/types.ts";',
         'import type { Message } from "../types.ts";'),
    ]),
    ("lib/guardrails/types.ts", "src/guardrails/types.ts", [
        ('import type { ToolCall } from "../provider/types.ts";\n'
         'import type { RetrievedDocument } from "../retrieval/documents.ts";',
         'import type { ToolCall, RetrievedDocument } from "../types.ts";'),
    ]),
    ("lib/guardrails/context-isolation.ts", "src/guardrails/context-isolation.ts", [
        ('import type { RetrievedDocument } from "../retrieval/documents.ts";',
         'import type { RetrievedDocument } from "../types.ts";'),
    ]),
]

failures = 0
for source, destination, imports in FILES:
    original = (KIT / source).read_text(encoding="utf-8")
    ported = original
    for old, new in imports:
        if old not in ported:
            print(f"!! {source}: import not found\n   {old[:100]}")
            failures += 1
            continue
        ported = ported.replace(old, new, 1)

    (PUB / destination).parent.mkdir(parents=True, exist_ok=True)
    (PUB / destination).write_text(ported, encoding="utf-8", newline="\n")

    # La cabecera MIT es lo que ACTIVA la valvula de doble licencia del LICENSE del kit: sin ella,
    # esa clausula apunta a algo que no existe y el mismo fichero queda bajo dos licencias sin nada
    # que resuelva el conflicto. Se exige aqui para que no se pierda en el siguiente porte.
    if not ported.startswith("// SPDX-License-Identifier: MIT"):
        print(f"!! {destination}: falta la cabecera SPDX-License-Identifier: MIT")
        failures += 1

    diff = [line for line in difflib.unified_diff(
        original.split("\n"), ported.split("\n"), lineterm="", n=0)
        if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))]
    print(f"{destination}: {len(original.splitlines())} lines, {len(diff)}-line diff")
    for line in diff:
        print("   ", line)
    if any("import" not in line for line in diff):
        print(f"!! {destination}: the diff touches something that is NOT an import")
        failures += 1

# ------------------------------------------------------------------ the types, extracted
provider = (KIT / "lib/provider/types.ts").read_text(encoding="utf-8")
documents = (KIT / "lib/retrieval/documents.ts").read_text(encoding="utf-8")


def block(source: str, name: str) -> str:
    """One exported declaration with its docblock, exactly as the kit has it.

    It finds the DECLARATION and then walks backwards for the docblock, rather than putting an
    optional docblock prefix in the regex. That prefix looked harmless and was not: being
    `(?:.|\\n)*?` with backtracking, the engine stretched it until it swallowed the declaration in
    between, and `ToolCall` came back as the block for `Role`. The resulting file had `Role` twice
    and did not compile, which is how it was caught. Walking backwards cannot do that.

    A `type` ends at the first `;`; an `interface` ends at a line that is exactly `}`.
    """
    lines = source.split("\n")
    for i, line in enumerate(lines):
        if line.startswith(f"export type {name} ") or line.startswith(f"export type {name}="):
            end = next(j for j in range(i, len(lines)) if lines[j].rstrip().endswith(";"))
            break
        if line.startswith(f"export interface {name} ") or line.startswith(f"export interface {name}<"):
            end = next(j for j in range(i, len(lines)) if lines[j] == "}")
            break
    else:
        print(f"!! {name} not found")
        sys.exit(1)

    start = i
    if start > 0 and lines[start - 1].strip().endswith("*/"):
        j = start - 1
        while j > 0 and not lines[j].strip().startswith("/**"):
            j -= 1
        start = j
    return "\n".join(lines[start:end + 1])


types = """// src/types.ts — the types the isolation module and the attack catalogue need.
//
// Extracted by script from the kit's lib/provider/types.ts and lib/retrieval/documents.ts, not
// rewritten: a second hand-written definition diverges from the original the moment either one
// changes, and then this repository would publish a shape the kit no longer uses.

""" + "\n\n".join([
    block(provider, "Role"),
    block(provider, "ToolCall"),
    block(provider, "Message"),
    block(documents, "RetrievedDocument"),
]) + "\n"

(PUB / "src/types.ts").write_text(types, encoding="utf-8", newline="\n")
print(f"src/types.ts: {len(types.splitlines())} lines, extracted from two kit files")

sys.exit(1 if failures else 0)
