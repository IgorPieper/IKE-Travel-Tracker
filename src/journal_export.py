"""Offline keepsake journal exports. Renderers never change the player's data."""
import io
import os
import re
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from .branding import APP_NAME


PDF_LOCK = threading.Lock()
MONTHS = {
    "pl": "stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia".split(),
    "en": "January February March April May June July August September October November December".split(),
}
WORDS = {
    "title": ("Dziennik podróży", "Travel journal"),
    "subtitle": ("Odwiedzone miejsca i wspomnienia z podróży", "Places visited and memories from my travels"),
    "undated": ("Bez daty", "Undated"),
    "trip": ("Wycieczka", "Trip"),
    "trips": ("Wycieczki", "Trips"),
    "visits": ("Wizyty", "Visits"),
    "countries": ("Państwa", "Countries"),
    "from": ("Od", "From"),
    "until": ("Do", "Until"),
    "rating": ("Ocena", "Rating"),
    "empty": ("Twój dziennik czeka na pierwsze wspomnienia.", "Your journal is waiting for its first memories."),
}


def clean(value):
    return re.sub(r"[^\x09\x0a\x0d\x20-\ud7ff\ue000-\ufffd\U00010000-\U0010ffff]", "", str(value or ""))


def words(model, key):
    return WORDS[key][model["language"] == "en"]


def day_label(value, language, uncertain=False):
    if not value:
        return ""
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return clean(value)
    month = MONTHS[language][day.month - 1]
    return ("~" if uncertain else "") + f"{day.day} {month} {day.year}"


def date_label(entry, model):
    first, last = entry.get("date", ""), entry.get("end", "")
    if first and last and entry.get("uncertain") and entry.get("end_uncertain"):
        return words(model, "undated")
    first_label = day_label(first, model["language"], entry.get("uncertain", False)) if first else ""
    last_label = day_label(last, model["language"], entry.get("end_uncertain", False)) if last else ""
    if first and last:
        return first_label + (" - " + last_label if last_label != first_label else "")
    if first:
        return (words(model, "from") + " " if entry.get("kind") == "trip" else "") + day_label(first, model["language"], entry.get("uncertain", False))
    if last:
        return words(model, "until") + " " + last_label
    return words(model, "undated")


def visit_metadata(entry, model):
    fields = [date_label(entry, model)]
    if entry.get("country"):
        fields.append(entry["country"])
    if entry.get("rating"):
        rating = str(entry["rating"])
        if model["language"] == "pl":
            rating = rating.replace(".", ",")
        fields.append(words(model, "rating") + " " + rating + " / 10")
    return "  ·  ".join(fields)


def cover_map(model, shapes):
    """A local map illustration; no tiles, remote images or geocoding."""
    from PIL import Image, ImageDraw
    width, height, margin = 1600, 780, 35
    image = Image.new("RGB", (width, height), "#ffffff")
    draw = ImageDraw.Draw(image)
    for _, country, rings in shapes:
        if not rings or max(point[1] for point in rings[0]) < -60:
            continue
        polygon = [(margin + (lon + 180) / 360 * (width - 2 * margin),
                    margin + (85 - min(85, max(-60, lat))) / 145 * (height - 2 * margin)) for lon, lat in rings[0]]
        fill = "#ad96c9" if country in model["country_ids"] else "#eeebf2"
        draw.polygon(polygon, fill=fill, outline="#ffffff", width=2)
        for hole in rings[1:]:
            points = [(margin + (lon+180)/360*(width-2*margin), margin+(85-min(85,max(-60,lat)))/145*(height-2*margin)) for lon,lat in hole]
            if len(points) > 2:
                draw.polygon(points, fill="#ffffff")
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def journal_photos(entry):
    from .photos import photo_path
    from PIL import Image
    for photo in entry.get("photos", []):
        try:
            path = photo_path(photo["id"])
            with Image.open(path) as image:
                width, height = image.size
            yield path, width, height, photo.get("caption", "")
        except (OSError, ValueError, KeyError):
            continue


def export_docx(model, illustration):
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Inches(8.2677), Inches(11.6929)
    section.top_margin, section.bottom_margin = Inches(.85), Inches(.8)
    section.left_margin = section.right_margin = Inches(.85)
    section.footer_distance = Inches(.35)
    section.different_first_page_header_footer = True
    styles = document.styles
    for name, font, size in (("Normal", "Georgia", 10.5), ("Title", "Georgia", 36),
                             ("Subtitle", "Segoe UI", 12), ("Heading 1", "Segoe UI", 26),
                             ("Heading 2", "Georgia", 20), ("Heading 3", "Georgia", 13)):
        style = styles[name]
        style.font.name, style.font.size = font, Pt(size)
        style.font.color.rgb = RGBColor.from_string("000000")
        style.font.bold = name.startswith("Heading")
        style.font.italic = False
        style.font.underline = False
        properties = style.element.get_or_add_rPr()
        font_properties = properties.find(qn("w:rFonts"))
        if font_properties is not None:
            for attribute in tuple(font_properties.attrib):
                if "theme" in attribute.lower():
                    del font_properties.attrib[attribute]
            for script in ("ascii", "hAnsi", "cs"):
                font_properties.set(qn("w:" + script), font)
        for tag in ("w:spacing", "w:kern", "w:iCs"):
            for item in properties.findall(qn(tag)):
                properties.remove(item)
        borders = style.element.find(".//" + qn("w:pBdr"))
        if borders is not None:
            borders.getparent().remove(borders)
        style.paragraph_format.space_after = Pt(8)
        style.paragraph_format.line_spacing = 1.25
        style.paragraph_format.widow_control = True
        if name != "Normal":
            style.paragraph_format.keep_with_next = True
    styles["Normal"].paragraph_format.space_after = Pt(10)
    styles["Heading 2"].paragraph_format.space_before = Pt(19)
    styles["Heading 3"].paragraph_format.space_before = Pt(12)
    # Keep source language and font fallback explicit in Word-compatible readers.
    lang = OxmlElement("w:lang")
    lang.set(qn("w:val"), "pl-PL" if model["language"] == "pl" else "en-GB")
    styles["Normal"].element.get_or_add_rPr().append(lang)
    document.core_properties.title = model["title"]
    document.core_properties.author = model.get("author", "")
    document.core_properties.last_modified_by = ""
    document.core_properties.created = datetime.now(timezone.utc)
    document.core_properties.modified = document.core_properties.created
    document.core_properties.subject = words(model, "subtitle")
    document.core_properties.comments = ""
    document.core_properties.keywords = ""

    def paragraph(text, style="Normal", *, size=None, color=None, before=None, after=None):
        item = document.add_paragraph(clean(text), style)
        if size:
            for run in item.runs:
                run.font.name, run.font.size = "Segoe UI", Pt(size)
        if color:
            for run in item.runs:
                run.font.color.rgb = RGBColor.from_string(color)
        if before is not None:
            item.paragraph_format.space_before = Pt(before)
        if after is not None:
            item.paragraph_format.space_after = Pt(after)
        return item

    paragraph(APP_NAME, size=9, color="76628D", before=36, after=25)
    title = paragraph(model["title"], "Title", after=14)
    if len(model["title"]) > 50:
        for run in title.runs:
            run.font.size = Pt(28)
    paragraph(words(model, "subtitle"), "Subtitle", after=18)
    if model.get("author"):
        paragraph(model["author"], size=12, color="655E6D", after=14)
    if model["range"]:
        paragraph(model["range"], size=11, color="655E6D", after=24)
    image = document.add_paragraph()
    image.paragraph_format.space_before = Pt(15)
    image.paragraph_format.space_after = Pt(26)
    image.add_run().add_picture(io.BytesIO(illustration), width=Inches(6.5))
    paragraph("   ·   ".join(f'{words(model, key)}  {model[key]}' for key in ("trips", "visits", "countries")), size=10, color="655E6D")
    document.add_page_break()

    def photos(entry):
        for path, width, height, caption in journal_photos(entry):
            scale = min(6.5 / width, 4.2 / height)
            item = document.add_paragraph()
            item.paragraph_format.keep_with_next = bool(caption)
            item.add_run().add_picture(str(path), width=Inches(width * scale), height=Inches(height * scale))
            if caption:
                paragraph(caption, size=9, color="655E6D", after=14)

    def visit(entry):
        paragraph(entry["title"], "Heading 3")
        if entry.get("reading"):
            paragraph(entry["reading"], size=9, color="76628D", after=3)
        metadata = paragraph(visit_metadata(entry, model), size=9, color="655E6D", after=7)
        metadata.paragraph_format.keep_with_next = bool(entry.get("note"))
        if entry.get("note"):
            paragraph(entry["note"])
        photos(entry)

    for index, (year, entries) in enumerate(model["years"]):
        paragraph(year or words(model, "undated"), "Heading 1", before=28 if index else 0, after=18)
        for entry in entries:
            if entry["kind"] == "trip":
                paragraph(words(model, "trip").upper(), size=9, color="76628D", before=18, after=3).paragraph_format.keep_with_next = True
                paragraph(entry["title"], "Heading 2", before=0)
                paragraph(date_label(entry, model), size=9, color="655E6D").paragraph_format.keep_with_next = bool(entry["note"] or entry["members"])
                if entry["note"]:
                    paragraph(entry["note"])
                photos(entry)
                for member in entry["members"]:
                    visit(member)
            else:
                visit(entry)
    if not model["years"]:
        paragraph(words(model, "empty"))
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = footer.add_run(APP_NAME + "   ·   ")
    run.font.name, run.font.size = "Segoe UI", Pt(8)
    run.font.color.rgb = RGBColor.from_string("76628D")
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer._p.append(field)
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()


def export_pdf(model, illustration):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, CondPageBreak

    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    # Windows fonts are used locally and embedded as PDF subsets. No font download.
    for name, filename in (("JournalBody", "georgia.ttf"), ("JournalHeading", "georgiab.ttf"), ("JournalMeta", "segoeui.ttf")):
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))
    fallback_files = ("msyh.ttc", "malgun.ttf", "leelawui.ttf", "Nirmala.ttf", "seguisym.ttf")
    fallback_fonts = []

    def text(value, primary="JournalBody"):
        """Use a compatible local font per run, including Chinese and Japanese names."""
        result, run, selected = [], "", primary
        for character in clean(value):
            font = primary
            if ord(character) not in pdfmetrics.getFont(primary).face.charToGlyph and not character.isspace():
                for index, filename in enumerate(fallback_files):
                    name = f"JournalFallback{index}"
                    if name not in fallback_fonts:
                        if not (fonts / filename).exists():
                            continue
                        try:
                            if name not in pdfmetrics.getRegisteredFontNames():
                                pdfmetrics.registerFont(TTFont(name, str(fonts / filename), subfontIndex=0))
                        except Exception:
                            continue
                        fallback_fonts.append(name)
                    if ord(character) in pdfmetrics.getFont(name).face.charToGlyph:
                        font = name
                        break
            if font != selected:
                if run:
                    result.append(f'<font name="{selected}">{escape(run).replace(chr(10), "<br/>")}</font>')
                run, selected = "", font
            run += character
        if run:
            result.append(f'<font name="{selected}">{escape(run).replace(chr(10), "<br/>")}</font>')
        return "".join(result)

    def style(name, font, size, leading, **kwargs):
        return ParagraphStyle(name, fontName=font, fontSize=size, leading=leading, textColor=colors.HexColor("#000000"),
                              alignment=TA_LEFT, splitLongWords=True, **kwargs)

    body = style("body", "JournalBody", 10.5, 16, spaceAfter=10, allowWidows=0, allowOrphans=0)
    title = style("title", "JournalBody", 36 if len(model["title"]) <= 50 else 28, 43, spaceAfter=16)
    subtitle = style("subtitle", "JournalMeta", 12, 18, spaceAfter=16)
    year_style = style("year", "JournalMeta", 26, 33, spaceBefore=24, spaceAfter=18, keepWithNext=True)
    trip_style = style("trip", "JournalHeading", 20, 26, spaceAfter=8, keepWithNext=True)
    visit_style = style("visit", "JournalHeading", 13, 18, spaceBefore=12, spaceAfter=5, keepWithNext=True)
    meta = style("meta", "JournalMeta", 9, 14, spaceAfter=8)
    meta.textColor = colors.HexColor("#655E6D")
    kicker = style("kicker", "JournalMeta", 9, 13, spaceBefore=18, spaceAfter=4, keepWithNext=True)
    kicker.textColor = colors.HexColor("#76628D")
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, leftMargin=61, rightMargin=61, topMargin=61, bottomMargin=58,
                                 title=model["title"], author=model.get("author", ""), subject=words(model, "subtitle"))
    story = [Spacer(1, 35), Paragraph(APP_NAME, kicker), Spacer(1, 22),
             Paragraph(text(model["title"]), title), Paragraph(text(words(model, "subtitle"), "JournalMeta"), subtitle)]
    if model.get("author"):
        story.append(Paragraph(text(model["author"], "JournalMeta"), meta))
    if model["range"]:
        story.append(Paragraph(text(model["range"], "JournalMeta"), meta))
    story.extend([Spacer(1, 25), Image(io.BytesIO(illustration), width=473, height=230.6), Spacer(1, 25),
                  Paragraph(text("   ·   ".join(f'{words(model, key)}  {model[key]}' for key in ("trips", "visits", "countries")), "JournalMeta"), meta), PageBreak()])

    def photos(entry):
        for path, width, height, caption in journal_photos(entry):
            scale = min(473 / width, 300 / height)
            picture = Image(str(path), width=width * scale, height=height * scale)
            picture.hAlign = "LEFT"
            picture.keepWithNext = bool(caption)
            story.extend([Spacer(1, 8), picture, Spacer(1, 5)])
            if caption:
                story.append(Paragraph(text(caption, "JournalMeta"), meta))

    def visit(entry):
        story.append(CondPageBreak(80))
        story.append(Paragraph(text(entry["title"], "JournalHeading"), visit_style))
        if entry.get("reading"):
            story.append(Paragraph(text(entry["reading"], "JournalMeta"), meta))
        story.append(Paragraph(text(visit_metadata(entry, model), "JournalMeta"), meta))
        if entry.get("note"):
            story.append(Paragraph(text(entry["note"]), body))
        photos(entry)

    for index, (year, entries) in enumerate(model["years"]):
        if index:
            story.append(CondPageBreak(115))
        story.append(Paragraph(text(year or words(model, "undated"), "JournalMeta"), year_style))
        for entry in entries:
            if entry["kind"] == "trip":
                story.extend([CondPageBreak(130), Paragraph(text(words(model, "trip").upper(), "JournalMeta"), kicker),
                              Paragraph(text(entry["title"], "JournalHeading"), trip_style),
                              Paragraph(text(date_label(entry, model), "JournalMeta"), meta)])
                if entry["note"]:
                    story.append(Paragraph(text(entry["note"]), body))
                photos(entry)
                for member in entry["members"]:
                    visit(member)
            else:
                visit(entry)
    if not model["years"]:
        story.append(Paragraph(text(words(model, "empty")), body))

    def footer(canvas, doc):
        if doc.page <= 1:
            return
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#76628D"))
        canvas.setFont("JournalMeta", 8)
        canvas.drawString(61, 30, APP_NAME)
        canvas.drawRightString(A4[0] - 61, 30, str(doc.page))
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def build_journal(model, shapes, format):
    illustration = cover_map(model, shapes)
    if format == "docx":
        return export_docx(model, illustration)
    if format == "pdf":
        with PDF_LOCK:
            return export_pdf(model, illustration)
    raise ValueError("Unsupported journal format")
