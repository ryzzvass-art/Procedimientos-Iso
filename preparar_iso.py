"""Genera el catálogo JSON de los documentos de procedimientos ISO."""

import json
import re
import sys
from pathlib import Path
from urllib.parse import quote


BASE = Path(__file__).resolve().parent
SOURCE = BASE / "procedimientos ISO"
OUTPUT = BASE / "data" / "procedimientos-iso.json"
EXTENSIONES = {".pdf", ".docx", ".xlsx"}
CODIGO = re.compile(
    r"(?<![A-Z0-9])((?:FO|PR)(?:-[A-Z]{2,})*-\d{3}|MF-\d{2}|FMDG-\d+)(?![A-Z0-9])",
    re.IGNORECASE,
)
VERSION = re.compile(r"\bV(?:ERSION)?\s*\.?\s*(\d+)\b", re.IGNORECASE)


def obtener_version(texto):
    if re.search(r"\b1ra\s+versi[oó]n\b", texto, re.IGNORECASE):
        return "1ra versión"
    encontrada = VERSION.search(texto)
    return f"V.{encontrada.group(1)}" if encontrada else "Sin versión"


def crear_documento(ruta):
    relativa = ruta.relative_to(BASE)
    carpeta = ruta.parent.relative_to(SOURCE).as_posix()
    coincidencia = CODIGO.search(ruta.stem)
    codigo = coincidencia.group(1).upper() if coincidencia else ""
    partes = codigo.split("-")
    tipo = partes[0] if partes[0] in {"FO", "PR", "MF"} else "Otros"
    area = partes[1] if tipo in {"FO", "PR"} and len(partes) > 2 else "Sin área"

    if tipo == "MF":
        area = "Manual de funciones"
    elif area == "IA":
        area = "ADM"

    return {
        "nombre": ruta.name,
        "carpeta": carpeta,
        "codigo": codigo,
        "tipo": tipo,
        "area": area,
        "version": obtener_version(f"{carpeta} {ruta.stem}"),
        "formato": ruta.suffix.lower(),
        "ruta": quote(relativa.as_posix(), safe="/"),
    }


def main():
    if not SOURCE.is_dir():
        print(f"No se encontró la carpeta de documentos: {SOURCE}", file=sys.stderr)
        return 1

    documentos = sorted(
        (
            crear_documento(ruta)
            for ruta in SOURCE.rglob("*")
            if ruta.is_file() and ruta.suffix.lower() in EXTENSIONES
        ),
        key=lambda documento: (
            documento["carpeta"].casefold(),
            documento["nombre"].casefold(),
        ),
    )
    if not documentos:
        print(f"No se encontraron archivos PDF, DOCX o XLSX en {SOURCE}", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(documentos, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Catálogo generado: {OUTPUT.relative_to(BASE)} ({len(documentos)} documentos)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
