"""Build lensfun.txt, Kestrel's compact copy of the lensfun lens database (CC BY-SA 3.0).

Usage: python generate.py <folder of lensfun data/db/*.xml> > lensfun.txt

Keeps rectilinear interchangeable lenses with at least one calibration, and the cameras' crop factors. Vignetting keeps only the
farthest focus distance measured for each focal length and aperture (photos rarely record the subject distance, and
the farthest is what most photographs are focused at). Output lines, '|' separated:
  C|maker|model[~alias...]|crop
  L|maker|model[~alias...]|crop|aspect
  D|focal|ptlens|a|b|c   D|focal|poly3|k1   D|focal|poly5|k1|k2
  T|focal|linear|kr|kb   T|focal|poly3|vr|vb|cr|cb|br|bb
  V|focal|aperture|k1|k2|k3
D, T and V lines belong to the L line above them.
"""
import glob
import os
import sys
import xml.etree.ElementTree as ET


def names(node, tag):
    out = []
    for el in node.findall(tag):
        if el.get('lang') not in (None, 'en'):
            continue
        text = (el.text or '').strip()
        if text and text not in out and '|' not in text and '~' not in text:
            out.append(text)
    return out


def num(value):
    return format(float(value), '.7g')


def aspect(text):
    if not text:
        return 1.5
    if ':' in text:
        a, b = text.split(':')
        return max(float(a), float(b)) / min(float(a), float(b))
    return float(text)


def main(folder):
    print('# lensfun lens database, https://github.com/lensfun/lensfun (data/db), CC BY-SA 3.0.')
    print('# Adapted (compacted) for Kestrel by generate.py; this file is under the same licence. See README.md.')
    for path in sorted(glob.glob(os.path.join(folder, '*.xml'))):
        root = ET.parse(path).getroot()
        for cam in root.findall('camera'):
            makers, models = names(cam, 'maker'), names(cam, 'model')
            crop = cam.findtext('cropfactor')
            if makers and models and crop:
                print('C|%s|%s|%s' % (makers[0], '~'.join(models), num(crop)))
        for lens in root.findall('lens'):
            kind = (lens.findtext('type') or 'rectilinear').strip()
            cal = lens.find('calibration')
            makers, models = names(lens, 'maker'), names(lens, 'model')
            crop = lens.findtext('cropfactor')
            if kind != 'rectilinear' or cal is None or not models or not crop:
                continue
            # Compact cameras' built-in lenses are named after the camera, not the lens; they are left out.
            if any('fixed lens' in m.lower() or 'compatibles' in m.lower() for m in models):
                continue
            lines = []
            for d in cal.findall('distortion'):
                model, f = d.get('model'), num(d.get('focal'))
                if model == 'ptlens':
                    lines.append('D|%s|ptlens|%s|%s|%s' % (f, num(d.get('a', 0)), num(d.get('b', 0)), num(d.get('c', 0))))
                elif model == 'poly3':
                    lines.append('D|%s|poly3|%s' % (f, num(d.get('k1', 0))))
                elif model == 'poly5':
                    lines.append('D|%s|poly5|%s|%s' % (f, num(d.get('k1', 0)), num(d.get('k2', 0))))
            for t in cal.findall('tca'):
                model, f = t.get('model'), num(t.get('focal'))
                if model == 'linear':
                    lines.append('T|%s|linear|%s|%s' % (f, num(t.get('kr', 1)), num(t.get('kb', 1))))
                elif model == 'poly3':
                    lines.append('T|%s|poly3|%s' % (f, '|'.join(num(t.get(k, d)) for k, d in
                                 [('vr', 1), ('vb', 1), ('cr', 0), ('cb', 0), ('br', 0), ('bb', 0)])))
            farthest = {}
            for v in cal.findall('vignetting'):
                if v.get('model') != 'pa':
                    continue
                key = (float(v.get('focal')), float(v.get('aperture')))
                dist = float(v.get('distance', 1000))
                if key not in farthest or dist > farthest[key][0]:
                    farthest[key] = (dist, v)
            for (f, a), (_, v) in sorted(farthest.items()):
                lines.append('V|%s|%s|%s|%s|%s' % (num(f), num(a), num(v.get('k1', 0)), num(v.get('k2', 0)), num(v.get('k3', 0))))
            if lines:
                print('L|%s|%s|%s|%s' % (makers[0] if makers else '', '~'.join(models), num(crop), num(aspect(lens.findtext('aspect-ratio')))))
                print('\n'.join(lines))


if __name__ == '__main__':
    main(sys.argv[1])
