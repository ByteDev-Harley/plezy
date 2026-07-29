#!/usr/bin/env python3
"""Render TV_INSTALL.md as a polished, paginated PDF manual."""

from __future__ import annotations

import html
import re
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "TV_INSTALL.md"
OUTPUT = ROOT / "TV_INSTALL.pdf"
LOGO = ROOT / "assets" / "plezy.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 19 * mm
RIGHT = 19 * mm
TOP = 20 * mm
BOTTOM = 18 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT

NAVY = colors.HexColor("#151B2D")
PURPLE = colors.HexColor("#7557E8")
PURPLE_DARK = colors.HexColor("#5940BF")
INK = colors.HexColor("#202438")
MUTED = colors.HexColor("#626A7D")
PALE = colors.HexColor("#F3F1FC")
RULE = colors.HexColor("#D7DAE4")
CODE_BG = colors.HexColor("#F5F6F9")
WHITE = colors.white


def normalize_punctuation(text: str) -> str:
    """Use PDF-safe punctuation and ASCII hyphens for every dash variant."""
    return text.translate(
        str.maketrans(
            {
                "\u2010": "-",
                "\u2011": "-",
                "\u2012": "-",
                "\u2013": "-",
                "\u2014": "-",
                "\u2212": "-",
                "\u2018": "'",
                "\u2019": "'",
                "\u201c": '"',
                "\u201d": '"',
                "\u2026": "...",
                "\u00a0": " ",
            }
        )
    )


def slugify(text: str) -> str:
    text = normalize_punctuation(text).strip().lower()
    text = re.sub(r"[^a-z0-9 _-]", "", text)
    return re.sub(r"\s", "-", text)


def inline_markup(text: str) -> str:
    value = html.escape(normalize_punctuation(text), quote=True)

    def link_replacement(match: re.Match[str]) -> str:
        label, target = match.group(1), match.group(2)
        if target.startswith("#") or target.startswith("https://") or target.startswith("http://"):
            return f'<link href="{target}" color="#5940BF"><u>{label}</u></link>'
        return f'<font color="#5940BF">{label}</font> <font color="#626A7D">({target})</font>'

    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_replacement, value)
    value = re.sub(r"`([^`]+)`", r'<font name="Courier" color="#3C3270">\1</font>', value)
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    return value


class InstallDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=LEFT,
            rightMargin=RIGHT,
            topMargin=TOP,
            bottomMargin=BOTTOM,
            title="Plezy TV Installation Manual",
            author="Plezy TV project",
            subject="Installation instructions for Android TV, Fire OS, Vega OS, Samsung Tizen, and Roku",
        )
        frame = Frame(
            LEFT,
            BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - TOP - BOTTOM,
            id="body",
            leftPadding=0,
            rightPadding=0,
            topPadding=7 * mm,
            bottomPadding=5 * mm,
        )
        self.addPageTemplates(PageTemplate(id="manual", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setStrokeColor(RULE)
            canvas.setLineWidth(0.5)
            canvas.line(LEFT, PAGE_HEIGHT - 12 * mm, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 12 * mm)
            canvas.setFont("Helvetica-Bold", 8.5)
            canvas.setFillColor(NAVY)
            canvas.drawString(LEFT, PAGE_HEIGHT - 9.3 * mm, "PLEZY TV INSTALLATION MANUAL")
            canvas.setFont("Helvetica", 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawRightString(PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 9.3 * mm, "TV_INSTALL.md")

        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT, 11.5 * mm, PAGE_WIDTH - RIGHT, 11.5 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(LEFT, 7.8 * mm, "Plezy 2.10.0 - device installation guide")
        canvas.drawRightString(PAGE_WIDTH - RIGHT, 7.8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    def afterFlowable(self, flowable: Flowable):
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "toc_level", None)
        bookmark = getattr(flowable, "bookmark", None)
        if level is None or bookmark is None:
            return
        text = flowable.getPlainText()
        self.canv.bookmarkPage(bookmark)
        self.canv.addOutlineEntry(text, bookmark, level=level, closed=level > 0)
        self.notify("TOCEntry", (level, text, self.page, bookmark))


def build_styles():
    base = getSampleStyleSheet()
    styles = {
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.4,
            leading=13.2,
            textColor=INK,
            spaceAfter=3.2 * mm,
            allowWidows=0,
            allowOrphans=0,
        ),
        "lead": ParagraphStyle(
            "Lead",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=11,
            leading=15.5,
            textColor=INK,
            spaceAfter=5 * mm,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=21,
            textColor=NAVY,
            spaceBefore=5 * mm,
            spaceAfter=4 * mm,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Heading3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=15.5,
            textColor=PURPLE_DARK,
            spaceBefore=4 * mm,
            spaceAfter=2.5 * mm,
            keepWithNext=True,
        ),
        "h4": ParagraphStyle(
            "Heading4",
            parent=base["Heading4"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=13.5,
            textColor=NAVY,
            backColor=PALE,
            borderPadding=(4, 6, 4, 6),
            spaceBefore=3 * mm,
            spaceAfter=2.5 * mm,
            keepWithNext=True,
        ),
        "list": ParagraphStyle(
            "List",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=12.8,
            textColor=INK,
            leftIndent=0,
            spaceAfter=1.2 * mm,
        ),
        "code": ParagraphStyle(
            "Code",
            parent=base["BodyText"],
            fontName="Courier",
            fontSize=7.4,
            leading=10.1,
            textColor=colors.HexColor("#29263B"),
            wordWrap="LTR",
        ),
        "table": ParagraphStyle(
            "TableCell",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.1,
            leading=8.7,
            textColor=INK,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.1,
            leading=8.7,
            textColor=WHITE,
        ),
        "toc_title": ParagraphStyle(
            "TocTitle",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=21,
            textColor=NAVY,
            spaceAfter=4 * mm,
        ),
    }
    return styles


def heading_flowable(text: str, level: int, styles) -> Paragraph:
    bookmark = slugify(text)
    style = styles[{2: "h2", 3: "h3", 4: "h4"}.get(level, "h2")]
    paragraph = Paragraph(f'<a name="{bookmark}"/>{inline_markup(text)}', style)
    paragraph.bookmark = bookmark
    paragraph.toc_level = max(0, min(level - 2, 2))
    return paragraph


def code_flowable(code: str, styles) -> Table:
    escaped = html.escape(normalize_punctuation(code.rstrip()), quote=False).replace("\n", "<br/>")
    paragraph = Paragraph(escaped or " ", styles["code"])
    table = Table([[paragraph]], colWidths=[CONTENT_WIDTH], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def table_widths(rows: list[list[str]]) -> list[float]:
    count = max(len(row) for row in rows)
    maxima = []
    for column in range(count):
        longest = max((len(row[column]) if column < len(row) else 0) for row in rows)
        maxima.append(max(8, min(longest, 42)))
    total = sum(maxima)
    return [CONTENT_WIDTH * value / total for value in maxima]


def markdown_table_flowable(rows: list[list[str]], styles) -> Table:
    width_count = max(len(row) for row in rows)
    normalized = [row + [""] * (width_count - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        style = styles["table_header"] if row_index == 0 else styles["table"]
        data.append([Paragraph(inline_markup(cell.strip()), style) for cell in row])
    table = Table(data, colWidths=table_widths(normalized), repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.45, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    for row_index in range(1, len(data)):
        if row_index % 2 == 0:
            commands.append(("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#F8F8FB")))
    table.setStyle(TableStyle(commands))
    return table


def list_flowable(items: list[str], ordered: bool, styles) -> ListFlowable:
    flowables = [
        ListItem(Paragraph(inline_markup(item), styles["list"]), leftIndent=4 * mm)
        for item in items
    ]
    list_arguments = {
        "bulletType": "1" if ordered else "bullet",
        "leftIndent": 7 * mm,
        "bulletFontName": "Helvetica-Bold",
        "bulletFontSize": 8,
        "bulletColor": PURPLE_DARK,
        "spaceAfter": 3 * mm,
    }
    if ordered:
        list_arguments["start"] = "1"
    return ListFlowable(flowables, **list_arguments)


def parse_table(lines: list[str], index: int) -> tuple[list[list[str]], int] | None:
    if index + 1 >= len(lines) or "|" not in lines[index]:
        return None
    separator = lines[index + 1].strip()
    if not re.fullmatch(r"\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?", separator):
        return None
    rows = []
    cursor = index
    while cursor < len(lines) and "|" in lines[cursor] and lines[cursor].strip():
        if cursor != index + 1:
            rows.append([cell.strip() for cell in lines[cursor].strip().strip("|").split("|")])
        cursor += 1
    return rows, cursor


def build_story(source_text: str, styles):
    story: list[Flowable] = []

    story.append(Spacer(1, 22 * mm))
    if LOGO.is_file():
        logo = Image(str(LOGO), width=28 * mm, height=28 * mm)
        logo.hAlign = "CENTER"
        story.append(logo)
        story.append(Spacer(1, 7 * mm))
    story.append(
        Paragraph(
            "PLEZY TV",
            ParagraphStyle(
                "CoverBrand",
                fontName="Helvetica-Bold",
                fontSize=12,
                leading=14,
                textColor=PURPLE,
                alignment=TA_CENTER,
                spaceAfter=4 * mm,
            ),
        )
    )
    story.append(
        Paragraph(
            "Installation Manual",
            ParagraphStyle(
                "CoverTitle",
                fontName="Helvetica-Bold",
                fontSize=30,
                leading=34,
                textColor=NAVY,
                alignment=TA_CENTER,
                spaceAfter=5 * mm,
            ),
        )
    )
    story.append(
        Paragraph(
            "Android TV / Google TV<br/>Amazon Fire TV (Fire OS and Vega OS)<br/>Samsung Tizen TV<br/>Roku TV and Roku players",
            ParagraphStyle(
                "CoverSubtitle",
                fontName="Helvetica",
                fontSize=13,
                leading=19,
                textColor=INK,
                alignment=TA_CENTER,
                spaceAfter=10 * mm,
            ),
        )
    )
    story.append(
        Table(
            [[Paragraph("Plezy 2.10.0", styles["body"]), Paragraph(f"Generated {date.today().isoformat()}", styles["body"])]],
            colWidths=[CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), PALE),
                    ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#CFC8F4")),
                    ("ALIGN", (0, 0), (0, 0), "LEFT"),
                    ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            ),
        )
    )
    story.append(Spacer(1, 10 * mm))
    story.append(
        Paragraph(
            "Choose the model family that matches the operating system shown in your device settings. Package formats are not interchangeable.",
            ParagraphStyle(
                "CoverNote",
                parent=styles["lead"],
                alignment=TA_CENTER,
                textColor=MUTED,
            ),
        )
    )
    story.append(PageBreak())

    lines = source_text.splitlines()
    index = 0
    paragraph_lines: list[str] = []
    first_body_paragraph = True

    def flush_paragraph():
        nonlocal paragraph_lines, first_body_paragraph
        if not paragraph_lines:
            return
        text = " ".join(part.strip() for part in paragraph_lines)
        story.append(Paragraph(inline_markup(text), styles["lead"] if first_body_paragraph else styles["body"]))
        first_body_paragraph = False
        paragraph_lines = []

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if stripped.startswith("# "):
            index += 1
            continue

        if stripped == "## Sections":
            flush_paragraph()
            story.append(Paragraph("Contents", styles["toc_title"]))
            toc = TableOfContents()
            toc.levelStyles = [
                ParagraphStyle("TOC0", fontName="Helvetica-Bold", fontSize=9, leading=11.5, textColor=NAVY, leftIndent=0, firstLineIndent=0, spaceBefore=1.5),
                ParagraphStyle("TOC1", fontName="Helvetica", fontSize=7.5, leading=9.2, textColor=INK, leftIndent=8 * mm, firstLineIndent=0, spaceBefore=0),
                ParagraphStyle("TOC2", fontName="Helvetica", fontSize=7, leading=8.5, textColor=MUTED, leftIndent=15 * mm, firstLineIndent=0, spaceBefore=0),
            ]
            story.append(toc)
            index += 1
            while index < len(lines) and not lines[index].startswith("## "):
                index += 1
            story.append(PageBreak())
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            index += 1
            code_lines = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            story.append(code_flowable("\n".join(code_lines), styles))
            story.append(Spacer(1, 3 * mm))
            index += 1
            continue

        parsed_table = parse_table(lines, index)
        if parsed_table:
            flush_paragraph()
            rows, index = parsed_table
            story.append(markdown_table_flowable(rows, styles))
            story.append(Spacer(1, 4 * mm))
            continue

        heading_match = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if heading_match:
            flush_paragraph()
            level = len(heading_match.group(1))
            heading = heading_match.group(2)
            if level == 2 and heading.startswith("Model family"):
                story.append(PageBreak())
            story.append(heading_flowable(heading, level, styles))
            index += 1
            continue

        ordered_match = re.match(r"^\d+\.\s+(.+)$", stripped)
        bullet_match = re.match(r"^-\s+(.+)$", stripped)
        if ordered_match or bullet_match:
            flush_paragraph()
            ordered = bool(ordered_match)
            items = []
            while index < len(lines):
                candidate = lines[index].strip()
                match = re.match(r"^\d+\.\s+(.+)$", candidate) if ordered else re.match(r"^-\s+(.+)$", candidate)
                if not match:
                    break
                items.append(match.group(1))
                index += 1
            story.append(list_flowable(items, ordered, styles))
            continue

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        paragraph_lines.append(stripped)
        index += 1

    flush_paragraph()
    return story


def main() -> int:
    source = normalize_punctuation(SOURCE.read_text(encoding="utf-8"))
    styles = build_styles()
    story = build_story(source, styles)
    document = InstallDocTemplate(str(OUTPUT))
    document.multiBuild(story)
    print(f"Created {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
