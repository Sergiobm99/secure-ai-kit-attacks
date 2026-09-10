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


types = """// SPDX-License-Identifier: MIT
// src/types.ts — the types the isolation module and the attack catalogue need.
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

# ------------------------------------------------------- la valvula de doble licencia, comprobada
#
# El KIT-LICENSE dice que un fichero sale de su Acuerdo por DOS caminos: llevar cabecera permisiva,
# o estar publicado en este repositorio. Los dos tienen que seguir siendo ciertos de lo que hay aqui,
# y ninguno se comprueba solo: la auditoria del 2026-09-09 encontro `src/types.ts` —contenido
# literal del kit— publicado como MIT sin cabecera, y los tres transcripts, que son JSON y NO PUEDEN
# llevarla. Un fichero que no entra por ninguno de los dos caminos queda bajo dos licencias a la vez
# y sin nada que resuelva el conflicto.

# 1. Toda fuente publicada lleva la cabecera. Todas, no solo las tres que se portan.
for fuente in sorted(PUB.glob("src/**/*.ts")) + sorted(PUB.glob("*.ts")):
    if not fuente.read_text(encoding="utf-8").startswith("// SPDX-License-Identifier: MIT"):
        print(f"!! {fuente.relative_to(PUB)}: falta la cabecera SPDX-License-Identifier: MIT")
        failures += 1

# 2. Lo que no puede llevarla entra por el otro camino, y ese camino tiene que estar escrito.
licencia = (PUB / "KIT-LICENSE.txt").read_text(encoding="utf-8")
if "secure-ai-kit-attacks" not in licencia:
    print("!! KIT-LICENSE.txt: la valvula no nombra el repositorio publico, y los transcripts")
    print("   son JSON: no pueden llevar cabecera, asi que ese es su unico camino.")
    failures += 1

# 3. Y la copia publicada del KIT-LICENSE es la que se vende, byte a byte. Dos textos legales que se
#    separan son peores que uno: el comprador lee uno y firma el otro.
kit_licencia = (KIT / "LICENSE").read_bytes()
if kit_licencia != (PUB / "KIT-LICENSE.txt").read_bytes():
    print("!! KIT-LICENSE.txt no es byte a byte el LICENSE del kit; se han separado.")
    failures += 1

# 4. Los transcripts publicados son los del kit, que es lo que los hace prueba y no ilustracion.
for transcript in sorted(PUB.glob("transcripts/*.json")):
    origen = KIT / "attacks/transcripts" / transcript.name
    if not origen.exists():
        print(f"!! {transcript.name}: no existe en el kit; publicado no es lo mismo que grabado.")
        failures += 1
    elif origen.read_bytes() != transcript.read_bytes():
        print(f"!! {transcript.name}: difiere del grabado en el kit.")
        failures += 1

# ------------------------------------------------------------------ el suelo de Node, en un solo sitio
#
# `Requires Node X+` en el README y `engines.node` en package.json son la misma promesa escrita dos
# veces, y decian cosas distintas: 22.6 es donde aparecio `--experimental-strip-types` detras de una
# bandera, y 22.18 donde `node example.ts` corre sin ninguna. El suelo declarado no arrancaba con la
# orden que el propio README manda ejecutar. Auditoria del 2026-09-09.
import json as _json

readme = (PUB / "README.md").read_text(encoding="utf-8")
paquete = _json.loads((PUB / "package.json").read_text(encoding="utf-8"))
declarado = re.search(r"Requires \*\*Node ([0-9]+\.[0-9]+)\+\*\*", readme)
motor = re.search(r">=([0-9]+\.[0-9]+)", str(paquete.get("engines", {}).get("node", "")))
if not declarado or not motor:
    print("!! el suelo de Node no se encuentra en el README o en package.json")
    failures += 1
elif declarado.group(1) != motor.group(1):
    print(f"!! el README pide Node {declarado.group(1)}+ y package.json {motor.group(1)}+: la misma")
    print("   promesa escrita dos veces y en desacuerdo.")
    failures += 1

sys.exit(1 if failures else 0)
