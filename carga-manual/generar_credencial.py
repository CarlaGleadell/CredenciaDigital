"""Generador manual de credenciales digitales.

Solicita los datos por consola, los valida y genera un PNG de alta resolución
usando la plantilla institucional ubicada en la raíz del repositorio.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


CARPETA_PROGRAMA = Path(__file__).resolve().parent
PLANTILLA = CARPETA_PROGRAMA.parent / "credencial-base.png"
CARPETA_SALIDA = CARPETA_PROGRAMA / "credenciales-generadas"

# Coordenadas sobre la plantilla original de 1755 × 975 px.
CAJA_CARGO = (50, 45, 520, 190)
CAJA_NOMBRE = (500, 300, 1190, 445)
# Caja inmediatamente posterior al rótulo "DNI:".
CAJA_DNI = (180, 515, 650, 615)
CAJA_VENCIMIENTO = (470, 755, 770, 855)

COLOR_TEXTO = (8, 18, 28)
COLOR_CARGO = (0, 0, 0)


def buscar_fuente(negrita: bool = True) -> str:
    """Busca una fuente TrueType nítida en Windows, macOS o Linux."""
    nombres = (
        [
            Path(r"C:\Windows\Fonts\arialbd.ttf"),
            Path(r"C:\Windows\Fonts\calibrib.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ]
        if negrita
        else [
            Path(r"C:\Windows\Fonts\arial.ttf"),
            Path(r"C:\Windows\Fonts\calibri.ttf"),
            Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
    )

    for ruta in nombres:
        if ruta.exists():
            return str(ruta)

    raise FileNotFoundError(
        "No se encontró una fuente compatible. Instalá Arial o DejaVu Sans."
    )


FUENTE_NEGRITA = buscar_fuente(negrita=True)


def normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFD", texto.strip().lower())
    return "".join(caracter for caracter in texto if unicodedata.category(caracter) != "Mn")


def pedir_nombre() -> str:
    while True:
        nombre = " ".join(input("Nombre y apellido: ").strip().split())
        if 3 <= len(nombre) <= 90:
            return nombre
        print("Ingresá un nombre y apellido de entre 3 y 90 caracteres.")


def formatear_dni(valor: str) -> str:
    digitos = re.sub(r"\D", "", valor)
    if not 6 <= len(digitos) <= 9:
        raise ValueError("El DNI debe contener entre 6 y 9 números.")

    grupos: list[str] = []
    while digitos:
        grupos.append(digitos[-3:])
        digitos = digitos[:-3]
    return ".".join(reversed(grupos))


def pedir_dni() -> str:
    while True:
        try:
            return formatear_dni(input("DNI: "))
        except ValueError as error:
            print(error)


def pedir_fecha() -> str:
    while True:
        valor = input("Fecha de vencimiento (DD/MM/AAAA): ").strip()
        valor = re.sub(r"[-.]", "/", valor)
        try:
            fecha = datetime.strptime(valor, "%d/%m/%Y")
            return fecha.strftime("%d / %m / %Y")
        except ValueError:
            print("La fecha no es válida. Ejemplo: 31/03/2027.")


def pedir_cargo() -> str:
    equivalencias = {
        "1": "ESTUDIANTE",
        "estudiante": "ESTUDIANTE",
        "2": "DOCENTE",
        "docente": "DOCENTE",
        "3": "NODOCENTE",
        "nodocente": "NODOCENTE",
        "no docente": "NODOCENTE",
        "no-docente": "NODOCENTE",
    }

    while True:
        print("\nCargo:")
        print("  1. Estudiante")
        print("  2. Docente")
        print("  3. Nodocente")
        respuesta = normalizar(input("Elegí una opción: "))
        if respuesta in equivalencias:
            return equivalencias[respuesta]
        print("Elegí 1, 2 o 3.")


def dimensiones_texto(
    dibujo: ImageDraw.ImageDraw,
    texto: str,
    fuente: ImageFont.FreeTypeFont,
    espaciado: int = 4,
) -> tuple[int, int]:
    caja = dibujo.multiline_textbbox(
        (0, 0), texto, font=fuente, spacing=espaciado, align="center"
    )
    return caja[2] - caja[0], caja[3] - caja[1]


def opciones_lineas(texto: str, max_lineas: int) -> list[str]:
    opciones = [texto]
    palabras = texto.split()
    if max_lineas >= 2 and len(palabras) >= 3:
        for corte in range(1, len(palabras)):
            opciones.append(" ".join(palabras[:corte]) + "\n" + " ".join(palabras[corte:]))
    return opciones


def ajustar_texto(
    dibujo: ImageDraw.ImageDraw,
    texto: str,
    caja: tuple[int, int, int, int],
    tamano_maximo: int,
    tamano_minimo: int,
    max_lineas: int = 1,
) -> tuple[str, ImageFont.FreeTypeFont, int, int]:
    """Elige automáticamente líneas y tamaño para que el texto no se corte."""
    ancho_disponible = caja[2] - caja[0]
    alto_disponible = caja[3] - caja[1]
    mejor: tuple[str, ImageFont.FreeTypeFont, int, int] | None = None

    for candidato in opciones_lineas(texto, max_lineas):
        for tamano in range(tamano_maximo, tamano_minimo - 1, -1):
            fuente = ImageFont.truetype(FUENTE_NEGRITA, tamano)
            ancho, alto = dimensiones_texto(dibujo, candidato, fuente)
            if ancho <= ancho_disponible and alto <= alto_disponible:
                if mejor is None or tamano > mejor[1].size:
                    mejor = (candidato, fuente, ancho, alto)
                break

    if mejor is None:
        raise ValueError(f'El texto "{texto}" es demasiado largo para la credencial.')
    return mejor


def dibujar_centrado(
    dibujo: ImageDraw.ImageDraw,
    texto: str,
    caja: tuple[int, int, int, int],
    tamano_maximo: int,
    tamano_minimo: int,
    color: tuple[int, int, int],
    max_lineas: int = 1,
) -> None:
    texto_final, fuente, ancho, alto = ajustar_texto(
        dibujo, texto, caja, tamano_maximo, tamano_minimo, max_lineas
    )
    x = caja[0] + ((caja[2] - caja[0] - ancho) / 2)
    y = caja[1] + ((caja[3] - caja[1] - alto) / 2)

    dibujo.multiline_text(
        (x, y),
        texto_final,
        font=fuente,
        fill=color,
        spacing=4,
        align="center",
        stroke_width=0,
    )


def dibujar_nombre_alineado(
    dibujo: ImageDraw.ImageDraw,
    nombre: str,
) -> None:
    """Alinea la primera línea del nombre con el rótulo de la plantilla."""
    texto, fuente, _, _ = ajustar_texto(
        dibujo,
        nombre,
        CAJA_NOMBRE,
        tamano_maximo=58,
        tamano_minimo=28,
        max_lineas=2,
    )
    bbox = dibujo.multiline_textbbox(
        (0, 0), texto, font=fuente, spacing=4, align="left"
    )

    # El texto impreso "Nombre y apellido:" comienza visualmente en y=319.
    x = CAJA_NOMBRE[0] - bbox[0]
    y = 319 - bbox[1]
    dibujo.multiline_text(
        (x, y),
        texto,
        font=fuente,
        fill=COLOR_TEXTO,
        spacing=4,
        align="left",
    )


def dibujar_dni_alineado(
    dibujo: ImageDraw.ImageDraw,
    dni: str,
) -> None:
    """Ubica el DNI junto al rótulo y centra ambos sobre el mismo renglón."""
    texto, fuente, _, alto = ajustar_texto(
        dibujo,
        dni,
        CAJA_DNI,
        tamano_maximo=55,
        tamano_minimo=42,
    )
    bbox = dibujo.textbbox((0, 0), texto, font=fuente)

    # Centro vertical del rótulo DNI: entre y=546 e y=590.
    x = 185 - bbox[0]
    y = 568 - (alto / 2) - bbox[1]
    dibujo.text((x, y), texto, font=fuente, fill=COLOR_TEXTO)


def nombre_archivo_seguro(nombre: str, dni: str) -> str:
    base = normalizar(nombre)
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    dni_sin_puntos = dni.replace(".", "")
    return f"credencial-{base}-{dni_sin_puntos}.png"


def generar_credencial(
    nombre: str,
    dni: str,
    vencimiento: str,
    cargo: str,
) -> Path:
    if not PLANTILLA.exists():
        raise FileNotFoundError(
            f"No se encontró la plantilla esperada:\n{PLANTILLA}"
        )

    with Image.open(PLANTILLA) as original:
        imagen = original.convert("RGB")

    if imagen.size != (1755, 975):
        raise ValueError(
            "La plantilla debe medir 1755 × 975 píxeles. "
            f"Actualmente mide {imagen.width} × {imagen.height}."
        )

    dibujo = ImageDraw.Draw(imagen)
    dibujar_centrado(dibujo, cargo, CAJA_CARGO, 78, 44, COLOR_CARGO)
    dibujar_nombre_alineado(dibujo, nombre)
    dibujar_dni_alineado(dibujo, dni)
    dibujar_centrado(
        dibujo, vencimiento, CAJA_VENCIMIENTO, 43, 30, COLOR_TEXTO
    )

    CARPETA_SALIDA.mkdir(parents=True, exist_ok=True)
    destino = CARPETA_SALIDA / nombre_archivo_seguro(nombre, dni)
    imagen.save(destino, "PNG", optimize=True, dpi=(300, 300))
    return destino


def main() -> None:
    print("=" * 52)
    print("GENERADOR MANUAL DE CREDENCIALES DIGITALES")
    print("=" * 52)
    print("Ingresá los datos solicitados.\n")

    nombre = pedir_nombre()
    dni = pedir_dni()
    vencimiento = pedir_fecha()
    cargo = pedir_cargo()

    try:
        destino = generar_credencial(nombre, dni, vencimiento, cargo)
    except (FileNotFoundError, ValueError, OSError) as error:
        print(f"\nNo se pudo generar la credencial: {error}")
        raise SystemExit(1) from error

    print("\nCredencial generada correctamente:")
    print(destino)


if __name__ == "__main__":
    main()
