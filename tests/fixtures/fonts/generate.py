"""Generate our own tiny font fixture; no third-party font data. Requires fonttools."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
font = FontBuilder(1000, isTTF=True)
chars = list(range(32, 127))
names = ['.notdef'] + [f'g{c}' for c in chars]
font.setupGlyphOrder(names)
font.setupCharacterMap({c: f'g{c}' for c in chars})
glyphs = {}
for i, name in enumerate(names):
    pen = TTGlyphPen(None)
    if name != 'g32':
        pen.moveTo((90, 0)); pen.lineTo((490, 0)); pen.lineTo((290, 700)); pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (600, 90) for name in names})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupNameTable({'familyName': 'Fielora Font Fixture', 'styleName': 'Regular', 'uniqueFontIdentifier': 'FieloraFontFixture-1', 'fullName': 'Fielora Font Fixture Regular', 'psName': 'FieloraFontFixture-Regular', 'version': 'Version 1.0'})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost(isFixedPitch=1)
font.setupMaxp()
font.font['head'].created = font.font['head'].modified = 3800000000
font.save(Path(__file__).with_name('FieloraFontFixture.ttf'))
