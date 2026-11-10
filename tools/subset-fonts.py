#!/usr/bin/env python3
"""Make the small font files in assets/fonts from the original open-licensed fonts.

    pip install fonttools brotli
    npm install --prefix /tmp/fonts @fontsource/uncut-sans @fontsource/geist-mono
    python3 tools/subset-fonts.py /tmp/fonts/node_modules/@fontsource

Each file keeps only the characters and OpenType features the page uses, and is
renamed (Field Sans, Field Mono) because a modified font should not carry the
original's name. Both originals are under the SIL Open Font License; their licence
texts are in assets/licenses/.
"""
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'fonts')
TEXT = [chr(c) for c in range(0x20, 0x7F)] + list(' ©·×°±–—‘’“”…™→←↑↓≠−≈•')
MONO = [chr(c) for c in range(0x20, 0x7F)] + list(' ·×°–—’…−•')
JOBS = [
    ('uncut-sans/files/uncut-sans-latin-400-normal.woff2', 'sans-400.woff2', 'Field Sans', 'Regular', TEXT),
    ('uncut-sans/files/uncut-sans-latin-500-normal.woff2', 'sans-500.woff2', 'Field Sans', 'Medium', TEXT),
    ('uncut-sans/files/uncut-sans-latin-700-normal.woff2', 'sans-700.woff2', 'Field Sans', 'Bold', TEXT),
    ('geist-mono/files/geist-mono-latin-400-normal.woff2', 'mono-400.woff2', 'Field Mono', 'Regular', MONO),
    ('geist-mono/files/geist-mono-latin-500-normal.woff2', 'mono-500.woff2', 'Field Mono', 'Medium', MONO),
]

for source, target, family, style, chars in JOBS:
    font = TTFont(os.path.join(SRC, source))
    original = font['name'].getDebugName(4)
    options = subset.Options()
    options.layout_features = ['kern', 'tnum', 'case', 'liga', 'calt', 'ccmp', 'locl', 'zero']
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = [0, 1, 2, 4, 6, 13, 14]
    options.notdef_outline = True
    options.flavor = 'woff2'
    worker = subset.Subsetter(options)
    worker.populate(text=''.join(chars))
    worker.subset(font)
    for record in font['name'].names:
        if record.nameID == 1:
            record.string = family
        elif record.nameID == 2:
            record.string = style
        elif record.nameID == 4:
            record.string = f'{family} {style}'
        elif record.nameID == 6:
            record.string = f"{family.replace(' ', '')}-{style}"
    font['name'].setName(f'A subset of {original}, renamed.', 10, 3, 1, 0x409)
    font.flavor = 'woff2'
    path = os.path.join(OUT, target)
    font.save(path)
    print(f'{target:16} {os.path.getsize(path):6} bytes  from {original}')
