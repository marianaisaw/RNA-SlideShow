"""Build data/sensors.json from the Structural Analysis PDF extract.

Uses the RNAfold MFE structures in the notes, colored the same way as
Radar-Scout: ViennaRNA base-pair probabilities, red = likely MFE
assignment, blue = uncertain. The in-frame UAG is the codon of interest.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import RNA

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEXT = Path(
    "/Users/marianaisabelgonzalezreyes/.cursor/projects/"
    "Users-marianaisabelgonzalezreyes-RNA-SlideShow/attachments/"
    "ee323e5f-eef7-4311-a8a7-95b6fa455987/StructuralAnalysis_-_RADAR__9_.pdf"
)
OUT = ROOT / "data" / "sensors.json"
OUT_JS = ROOT / "data" / "sensors.js"

GENE_ALIASES = {"SRFP4": "SFRP4", "SFRP4": "SFRP4"}


def hsb_to_hex(h: float, s: float, v: float) -> str:
    h = h % 1.0
    i = int(h * 6.0)
    f = h * 6.0 - i
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i %= 6
    r, g, b = (
        (v, t, p),
        (q, v, p),
        (p, v, t),
        (p, q, v),
        (t, p, v),
        (v, p, q),
    )[i]
    return f"#{int(round(r * 255)):02x}{int(round(g * 255)):02x}{int(round(b * 255)):02x}"


def probability_to_hex(p: float) -> str:
    p = min(1.0, max(0.0, float(p)))
    return hsb_to_hex(0.8 * (1.0 - p), 1.0, 1.0)


def load_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        import subprocess

        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.replace("\f", "\n")
    return path.read_text(encoding="utf-8").replace("\f", "\n")


def grab_sequence_and_structure(body: str) -> tuple[str, str]:
    seq_parts: list[str] = []
    struct_parts: list[str] = []
    for line in body.splitlines():
        if "Results for thermodynamic" in line:
            break
        raw = line.strip()
        if not raw:
            continue
        token = raw.replace("\u200b", "").lstrip("●•-").strip().replace(" ", "").replace(",", "")
        if re.fullmatch(r"[ACGU]+", token):
            seq_parts.append(token)
        elif re.fullmatch(r"[.()]+", token):
            struct_parts.append(token)
    return "".join(seq_parts), "".join(struct_parts)


def parse_notes(text: str) -> list[dict]:
    sensors = []
    parts = re.split(r"(?m)^(?=.+ - RNAfold -)", text)
    for part in parts:
        title = re.match(r"(.+?) - RNAfold -", part)
        if title is None or "Colored by base-pairing probability:" not in part:
            continue
        name = title.group(1).strip()
        body = part.split("Colored by base-pairing probability:", 1)[1]
        sequence, structure = grab_sequence_and_structure(body)
        mfe_match = re.search(r"MFE .{0,8}:\s*(-?\d+\.\d+)", part)
        sensors.append(
            {
                "name": name,
                "sequence": sequence,
                "structure": structure,
                "mfe_note": float(mfe_match.group(1)) if mfe_match else None,
            }
        )
    return sensors


def in_frame_uag(sequence: str) -> tuple[int, int] | None:
    """1-based inclusive span of the first in-frame UAG (ORF from nt 1)."""
    for i in range(0, len(sequence) - 2, 3):
        if sequence[i : i + 3] == "UAG":
            return i + 1, i + 3
    return None


def slug(gene: str, candidate: str) -> str:
    return f"{gene}-{candidate}".lower()


def fold_record(raw: dict) -> dict:
    label = raw["name"]
    gene_token, candidate = label.split(" ", 1)
    gene = GENE_ALIASES.get(gene_token, gene_token)
    sequence = raw["sequence"]
    structure = raw["structure"]
    if len(sequence) != len(structure):
        raise SystemExit(f"{label}: sequence/structure length mismatch")

    md = RNA.md()
    md.noLP = 1
    fc = RNA.fold_compound(sequence, md)
    mfe_structure, mfe = fc.mfe()
    fc.pf()
    bpp = fc.bpp()
    if mfe_structure != structure:
        raise SystemExit(f"{label}: ViennaRNA MFE does not match the notes")
    if raw["mfe_note"] is not None and abs(float(mfe) - raw["mfe_note"]) > 0.05:
        raise SystemExit(f"{label}: MFE {mfe} != notes {raw['mfe_note']}")

    length = len(sequence)
    pairing = []
    for i in range(1, length + 1):
        paired = 0.0
        row = bpp[i]
        for j in range(1, length + 1):
            if i != j:
                paired += float(row[j])
        pairing.append(min(1.0, max(0.0, paired)))

    partner = [0] * length
    pair_p = [0.0] * length
    stack: list[int] = []
    for i, char in enumerate(structure):
        if char == "(":
            stack.append(i)
        elif char == ")" and stack:
            j = stack.pop()
            prob = min(1.0, max(0.0, float(bpp[j + 1][i + 1])))
            pair_p[j] = pair_p[i] = prob
            partner[j] = i + 1
            partner[i] = j + 1

    state_p = []
    for i, char in enumerate(structure):
        if char in "()":
            state_p.append(pair_p[i])
        else:
            state_p.append(1.0 - pairing[i])

    codon = in_frame_uag(sequence)
    return {
        "id": slug(gene, candidate),
        "gene": gene,
        "candidate": candidate,
        "name": f"{gene} {candidate}",
        "sequence": sequence,
        "structure": structure,
        "mfe": round(float(mfe), 2),
        "length": length,
        "codonStart": codon[0] if codon else None,
        "codonEnd": codon[1] if codon else None,
        "colors": [probability_to_hex(p) for p in state_p],
        "stateP": [round(p, 4) for p in state_p],
        "partner": partner,
    }


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TEXT
    text = load_text(source)
    records = [fold_record(raw) for raw in parse_notes(text)]
    if len(records) != 24:
        raise SystemExit(f"Expected 24 sensors, parsed {len(records)}")
    payload = {"sensors": records}
    encoded = json.dumps(payload, indent=2)
    OUT.write_text(encoded + "\n", encoding="utf-8")
    OUT_JS.write_text(f"window.SENSOR_DATA = {encoded};\n", encoding="utf-8")
    print(f"wrote {len(records)} sensors to {OUT}")


if __name__ == "__main__":
    main()
