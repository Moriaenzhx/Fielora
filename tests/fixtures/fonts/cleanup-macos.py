"""Remove only the exact generated test font after native macOS acceptance."""
import ctypes as c
import hashlib
from pathlib import Path
import sys
p = Path(sys.argv[1]); digest = sys.argv[2]
assert p.parent == Path.home() / 'Library/Fonts'
assert p.name == f'Fielora-{digest}.ttf'
if p.exists():
    assert hashlib.sha256(p.read_bytes()).hexdigest() == digest
    cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    ct = c.CDLL('/System/Library/Frameworks/CoreText.framework/CoreText')
    cf.CFURLCreateFromFileSystemRepresentation.argtypes = [c.c_void_p, c.c_char_p, c.c_long, c.c_bool]
    cf.CFURLCreateFromFileSystemRepresentation.restype = c.c_void_p
    cf.CFRelease.argtypes = [c.c_void_p]
    ct.CTFontManagerUnregisterFontsForURL.argtypes = [c.c_void_p,c.c_uint,c.c_void_p]
    ct.CTFontManagerUnregisterFontsForURL.restype = c.c_bool
    data = str(p).encode(); url = cf.CFURLCreateFromFileSystemRepresentation(None,data,len(data),False)
    ct.CTFontManagerUnregisterFontsForURL(url,2,None); cf.CFRelease(url)
    p.unlink()
