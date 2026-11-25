#!/usr/bin/env python3
"""Regenerate the dark-mode logo artwork for the web app and every Dawaya shell.

The master dark logo paints the mark on a #1C1C1E plate and draws a thin neutral
rounded-square frame around it. Launchers need true black with no frame - the
icon should read as a plain black tile like a native app icon - so every
launcher asset is rebuilt from the mark alone on a black plate. The in-app logo
keeps a light plate because it sits on the dark top bar and footer, where a
black plate reads as a hole.

Usage: python3 Source/scripts/make-dark-icons.py
"""
import math
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEBAPP = os.path.join(ROOT, 'Source', 'webapp')
MASTER = os.path.join(WEBAPP, 'assets', 'red-crescent-rx-dark.png')
ANDROID_RES = os.path.join(ROOT, 'Source', 'android', 'app', 'src', 'main', 'res')
IOS_ICONSET = os.path.join(ROOT, 'Source', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')

MARK_THRESHOLD = 100          # anything darker belongs to the plate
NEUTRAL_SPREAD = 16           # grey/white pixels with no hue belong to plate or frame
PLATE_INK = (28, 28, 30)      # the master's plate colour
ART_RATIO = 0.60              # artwork width / adaptive-icon canvas, matches the light icon
WEB_PLATE = (255, 255, 255)   # in-app logo tile in dark mode


def png_size(path):
    with open(path, 'rb') as handle:
        header = handle.read(24)
    return struct.unpack('>II', header[16:24])


def decode(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat, ihdr, plte, trns = 8, b'', None, None, None
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            ihdr = struct.unpack('>IIBBBBB', chunk)
        elif kind == b'IDAT':
            idat += chunk
        elif kind == b'PLTE':
            plte = chunk
        elif kind == b'tRNS':
            trns = chunk
        elif kind == b'IEND':
            break
    width, height, depth, color, _comp, _filt, interlace = ihdr
    assert depth == 8 and interlace == 0, (path, depth, interlace)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(idat)
    stride = width * channels
    plane = bytearray(width * height * 4)
    previous = bytearray(stride)
    offset = 0
    for y in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        for x in range(stride):
            left = line[x - channels] if x >= channels else 0
            up = previous[x]
            upleft = previous[x - channels] if x >= channels else 0
            if filter_type == 1:
                line[x] = (line[x] + left) & 255
            elif filter_type == 2:
                line[x] = (line[x] + up) & 255
            elif filter_type == 3:
                line[x] = (line[x] + ((left + up) >> 1)) & 255
            elif filter_type == 4:
                p = left + up - upleft
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - upleft)
                predictor = left if (pa <= pb and pa <= pc) else (up if pb <= pc else upleft)
                line[x] = (line[x] + predictor) & 255
            elif filter_type != 0:
                raise ValueError('unsupported filter %d in %s' % (filter_type, path))
        previous = line
        base = y * width * 4
        for x in range(width):
            s = x * channels
            if color == 2:
                r, g, b, a = line[s], line[s + 1], line[s + 2], 255
            elif color == 6:
                r, g, b, a = line[s], line[s + 1], line[s + 2], line[s + 3]
            elif color == 0:
                r = g = b = line[s]
                a = 255
            elif color == 4:
                r = g = b = line[s]
                a = line[s + 1]
            else:
                index = line[s]
                r, g, b = plte[index * 3:index * 3 + 3]
                a = trns[index] if trns and index < len(trns) else 255
            d = base + x * 4
            plane[d] = r
            plane[d + 1] = g
            plane[d + 2] = b
            plane[d + 3] = a
    return width, height, plane


def encode(path, width, height, pixels, alpha=True):
    channels = 6 if alpha else 2
    row_bytes = width * (4 if alpha else 3)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row = pixels[y * width * 4:(y + 1) * width * 4]
        if alpha:
            raw += row
        else:
            out = bytearray(row_bytes)
            for x in range(width):
                out[x * 3:x * 3 + 3] = row[x * 4:x * 4 + 3]
            raw += out

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, channels, 0, 0, 0)
    open(path, 'wb').write(
        b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    print('  wrote %s (%dx%d)' % (os.path.relpath(path, ROOT), width, height))


def mark_box(pixels, width, height):
    """Bounding box of the saturated artwork; the frame sits outside it."""
    x0, y0, x1, y1 = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            i = row + x * 4
            if max(pixels[i], pixels[i + 1], pixels[i + 2]) - min(pixels[i], pixels[i + 1], pixels[i + 2]) > NEUTRAL_SPREAD:
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    return x0, y0, x1, y1


def strip_frame(pixels, width, height):
    """Drop the neutral rounded-square frame so only the artwork stays.

    The frame and its antialiased edges are the only achromatic pixels outside
    the mark's box; the pale half of the capsule sits inside that box and must
    keep its light tints.
    """
    x0, y0, x1, y1 = mark_box(pixels, width, height)
    out = bytearray(pixels)
    for y in range(height):
        row = y * width * 4
        inside_rows = y0 <= y <= y1
        for x in range(width):
            if inside_rows and x0 <= x <= x1:
                continue
            i = row + x * 4
            r, g, b = out[i], out[i + 1], out[i + 2]
            if max(r, g, b) - min(r, g, b) <= NEUTRAL_SPREAD:
                out[i], out[i + 1], out[i + 2] = PLATE_INK
                out[i + 3] = 255
    return out


def black_plate(pixels, width, height):
    """The plate is a flat #1C1C1E; the launcher needs a true black one."""
    out = bytearray(pixels)
    for i in range(0, width * height * 4, 4):
        if max(out[i], out[i + 1], out[i + 2]) < MARK_THRESHOLD:
            out[i] = out[i + 1] = out[i + 2] = 0
            out[i + 3] = 255
    return out


def light_plate(pixels, width, height):
    """Same artwork on the light tile the in-app logo uses in dark mode."""
    out = bytearray(pixels)
    for i in range(0, width * height * 4, 4):
        if max(out[i], out[i + 1], out[i + 2]) < MARK_THRESHOLD:
            out[i], out[i + 1], out[i + 2] = WEB_PLATE
            out[i + 3] = 255
    return out


def cutout(pixels, width, height):
    """Keep the artwork, drop the plate so a launcher can supply its own."""
    out = bytearray(pixels)
    for i in range(0, width * height * 4, 4):
        out[i + 3] = 255 if max(out[i], out[i + 1], out[i + 2]) >= MARK_THRESHOLD else 0
    return out


def content_box(pixels, width, height):
    x0, y0, x1, y1 = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if pixels[row + x * 4 + 3]:
                x0 = x if x < x0 else x0
                x1 = x if x > x1 else x1
                y0 = y if y < y0 else y0
                y1 = y if y > y1 else y1
    return x0, y0, x1 - x0 + 1, y1 - y0 + 1


def crop(pixels, width, height, x, y, cw, ch):
    out = bytearray(cw * ch * 4)
    for row in range(ch):
        s = ((y + row) * width + x) * 4
        out[row * cw * 4:(row + 1) * cw * 4] = pixels[s:s + cw * 4]
    return cw, ch, out


def resample(src, sw, sh, dw, dh):
    """Area-average resample (premultiplied) so thin strokes survive downscaling."""
    out = bytearray(dw * dh * 4)
    xr, yr = sw / dw, sh / dh
    for y in range(dh):
        iy0 = max(0, int(y * yr))
        iy1 = min(sh, int(math.ceil((y + 1) * yr)))
        for x in range(dw):
            ix0 = max(0, int(x * xr))
            ix1 = min(sw, int(math.ceil((x + 1) * xr)))
            r = g = b = a = 0
            n = 0
            for sy in range(iy0, iy1):
                row = sy * sw * 4
                for sx in range(ix0, ix1):
                    o = row + sx * 4
                    alpha = src[o + 3]
                    r += src[o] * alpha
                    g += src[o + 1] * alpha
                    b += src[o + 2] * alpha
                    a += alpha
                    n += 1
            o = (y * dw + x) * 4
            if not a:
                continue
            out[o] = min(255, int(r / a + 0.5))
            out[o + 1] = min(255, int(g / a + 0.5))
            out[o + 2] = min(255, int(b / a + 0.5))
            out[o + 3] = min(255, int(a * 255 / n + 0.5))
    return out


def scale(src, sw, sh, dw, dh):
    return resample(src, sw, sh, dw, dh)


def canvas(width, height, color=(0, 0, 0, 255)):
    row = bytes(color) * width
    out = bytearray(row * height)
    return out


def paste(base, bw, bh, src, sw, sh, cx, cy):
    """Centre src over base at (cx, cy) using source-over compositing."""
    x0 = int(cx - sw / 2 + 0.5)
    y0 = int(cy - sh / 2 + 0.5)
    for y in range(sh):
        ty = y0 + y
        if ty < 0 or ty >= bh:
            continue
        srow = y * sw * 4
        trow = ty * bw * 4
        for x in range(sw):
            tx = x0 + x
            if tx < 0 or tx >= bw:
                continue
            a = src[srow + x * 4 + 3]
            if not a:
                continue
            d = trow + tx * 4
            if a == 255:
                base[d:d + 4] = src[srow + x * 4:srow + x * 4 + 4]
                continue
            f = a / 255.0
            for c in range(3):
                base[d + c] = int(src[srow + x * 4 + c] * f + base[d + c] * (1 - f) + 0.5)
            base[d + 3] = max(base[d + 3], a)


def plate(black, source, size, circle=False):
    art = resample(black, source[0], source[1], size, size)
    if circle:
        r = size / 2
        for y in range(size):
            for x in range(size):
                if (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 > r ** 2:
                    art[(y * size + x) * 4 + 3] = 0
    return size, size, art


def foreground(art, aw, ah, size, ratio):
    side = max(1, int(size * ratio + 0.5))
    scaled = resample(art, aw, ah, side, side)
    canvas_pixels = canvas(size, size, (0, 0, 0, 0))
    paste(canvas_pixels, size, size, scaled, side, side, size / 2, size / 2)
    return size, size, canvas_pixels


def splash(art, aw, ah, width, height, fraction):
    side = max(1, int(min(width, height) * fraction + 0.5))
    scaled = resample(art, aw, ah, side, side)
    canvas_pixels = canvas(width, height, (0, 0, 0, 255))
    paste(canvas_pixels, width, height, scaled, side, side, width / 2, height / 2)
    return width, height, canvas_pixels


def light_logo_fraction(path):
    """How much of the shipped splash canvas the logo plate occupies."""
    w, h, px = decode(path)
    opaque = bytearray(px)
    for i in range(0, w * h * 4, 4):
        near_white = px[i] > 246 and px[i + 1] > 246 and px[i + 2] > 246
        opaque[i + 3] = 0 if near_white else 255
    x, y, cw, ch = content_box(opaque, w, h)
    return cw / min(w, h)


def main():
    print('master:', os.path.relpath(MASTER, ROOT))
    width, height, pixels = decode(MASTER)
    source = (width, height)
    pixels = strip_frame(pixels, width, height)
    black = black_plate(pixels, width, height)
    light = light_plate(pixels, width, height)
    art = cutout(black, width, height)
    ax, ay, aw, ah = content_box(art, width, height)
    aw, ah, art = crop(art, width, height, ax, ay, aw, ah)
    print('artwork: %dx%d of %dx%d (%.3f)' % (aw, ah, width, height, aw / width))

    print('\nweb assets')
    for size in (512, 192, 96):
        w, h, plate_px = plate(light, source, size)
        encode(os.path.join(WEBAPP, 'assets', 'red-crescent-rx-dark-%d.png' % size), w, h, plate_px, alpha=False)

    print('\niOS launcher icon')
    w, h, plate_px = plate(black, source, 1024)
    encode(os.path.join(IOS_ICONSET, 'AppIcon-dark-512@2x.png'), w, h, plate_px, alpha=False)

    print('\nAndroid night icons')
    densities = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
    legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for name, size in densities.items():
        folder = os.path.join(ANDROID_RES, 'mipmap-night-%s' % name)
        w, h, foreground_px = foreground(art, aw, ah, size, ART_RATIO)
        encode(os.path.join(folder, 'ic_launcher_foreground.png'), w, h, foreground_px)
        legacy_size = legacy[name]
        lw, lh, square = plate(black, source, legacy_size)
        encode(os.path.join(folder, 'ic_launcher.png'), lw, lh, square, alpha=False)
        rw, rh, round_ = plate(black, source, legacy_size, circle=True)
        encode(os.path.join(folder, 'ic_launcher_round.png'), rw, rh, round_)

    print('\nAndroid night splash')
    port_fraction = light_logo_fraction(os.path.join(ANDROID_RES, 'drawable-port-xxhdpi', 'splash.png')) * 0.96
    land_fraction = light_logo_fraction(os.path.join(ANDROID_RES, 'drawable-land-xxhdpi', 'splash.png')) * 0.96
    print('artwork fraction: port %.3f, land %.3f' % (port_fraction, land_fraction))
    for name in densities:
        pw, ph = png_size(os.path.join(ANDROID_RES, 'drawable-port-%s' % name, 'splash.png'))
        w, h, splash_px = splash(art, aw, ah, pw, ph, port_fraction)
        encode(os.path.join(ANDROID_RES, 'drawable-port-night-%s' % name, 'splash.png'), w, h, splash_px, alpha=False)
        lw, lh = png_size(os.path.join(ANDROID_RES, 'drawable-land-%s' % name, 'splash.png'))
        w, h, splash_px = splash(art, aw, ah, lw, lh, land_fraction)
        encode(os.path.join(ANDROID_RES, 'drawable-land-night-%s' % name, 'splash.png'), w, h, splash_px, alpha=False)

    print('\ndone')


if __name__ == '__main__':
    sys.exit(main())
