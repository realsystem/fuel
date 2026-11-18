"""Train the tiny glyph classifier used by the odometer reader.

Offline, synthetic only: renders characters from system fonts with random
blur/noise/threshold/shear, trains a small MLP, validates on HELD-OUT FONTS,
and writes web/src/processor/odometer/glyphModel.ts.
No photos are used for training.
"""
import glob, json, random, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from sklearn.neural_network import MLPClassifier

W, H = 12, 16
DIGITS = "0123456789"
CLASSES = list(DIGITS) + ["D", "m", "k", "other"]
OTHER = list("ACEFHJLMNPRTUVWXYadefhnrtuvwxy%/:()-+=*#&@$?!")  # letters that look like digits (Z S B G I l o q) are left out on purpose: context rules reject words, and digits must not be lost to them
random.seed(1); np.random.seed(1)

def fonts():
    pats = ["/usr/share/fonts/truetype/dejavu/DejaVuSans*.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono*.ttf",
            "/usr/share/fonts/truetype/liberation/Liberation*.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans*.ttf",
            "/usr/share/fonts/truetype/freefont/FreeMono*.ttf",
            "/usr/share/fonts/truetype/crosextra/Carlito-*.ttf",
            "/usr/share/fonts/opentype/inter/Inter-*.otf",
            "/usr/share/fonts/truetype/*/Poppins-*.ttf",
            "/usr/share/texmf/fonts/opentype/public/lm/lmsans*.otf",
            "/usr/share/texmf/fonts/opentype/public/lm/lmmono10-*.otf",
            "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreheros*.otf",
            "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-*.ttf",
            "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyreadventor-*.otf",
            "/usr/share/fonts/**/Loma*.ttf"]
    out = []
    for p in pats: out += glob.glob(p, recursive=True)
    out = sorted(set(f for f in out if "Oblique" not in f and "Italic" not in f and "Slanted" not in f))
    return out

def family(f):
    b = os.path.basename(f).lower()
    for key in ["dejavusansmono","dejavusans","liberationsansnarrow","liberationsans","liberationmono","freesans","freemono","carlito","inter","poppins","lmsans","lmmono","texgyreheros","texgyreadventor","loma"]:
        if b.startswith(key): return key
    return b

def to_feat(mask):
    """mask: 2-D bool ink array -> (feature vector) or None."""
    ys, xs = np.where(mask)
    if len(ys) < 6: return None
    y0, y1, x0, x1 = ys.min(), ys.max()+1, xs.min(), xs.max()+1
    crop = mask[y0:y1, x0:x1].astype(np.float32)
    h, w = crop.shape
    im = Image.fromarray((crop*255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    v = np.asarray(im, dtype=np.float32).ravel()/255.0
    aspect = min(w/h, 2.0)/2.0
    return np.concatenate([v, [aspect, crop.mean()]])

def render(fpath, ch, size):
    f = ImageFont.truetype(fpath, size)
    img = Image.new("L", (size*2, size*2), 0)
    d = ImageDraw.Draw(img); d.text((size//2, size//4), ch, fill=255, font=f)
    shear = random.uniform(-0.35, 0.35)
    if abs(shear) > 0.02:
        img = img.transform(img.size, Image.AFFINE, (1, shear, -shear*size, 0, 1, 0), Image.BILINEAR)
    # random stroke weight change
    r = random.random()
    if r < 0.2: img = img.filter(ImageFilter.MaxFilter(3))
    elif r < 0.35: img = img.filter(ImageFilter.MaxFilter(5))     # very bold LCD fonts
    elif r < 0.5: img = img.filter(ImageFilter.MinFilter(3))
    # downscale to a realistic on-photo glyph height
    th = random.randint(14, 70)
    s = th/ size
    img = img.resize((max(4,int(img.width*s*random.choice([random.uniform(.85,1.15), random.uniform(.55,.9)]))), max(4,int(img.height*s))), Image.BILINEAR)
    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0, 1.3)))
    a = np.asarray(img, dtype=np.float32)/255.0
    a = a*random.uniform(.5,1) + np.random.normal(0, random.uniform(0,.12), a.shape)
    return a > random.uniform(.3, .6)


# Classic 5x7 dot-matrix glyphs (instrument clusters, small LCD panels). Digits plus the letters we need.
DM = {
 "0": ["01110","10001","10011","10101","11001","10001","01110"],
 "1": ["00100","01100","00100","00100","00100","00100","01110"],
 "2": ["01110","10001","00001","00010","00100","01000","11111"],
 "3": ["11110","00001","00001","01110","00001","00001","11110"],
 "4": ["00010","00110","01010","10010","11111","00010","00010"],
 "5": ["11111","10000","11110","00001","00001","10001","01110"],
 "6": ["00110","01000","10000","11110","10001","10001","01110"],
 "7": ["11111","00001","00010","00100","01000","01000","01000"],
 "8": ["01110","10001","10001","01110","10001","10001","01110"],
 "9": ["01110","10001","10001","01111","00001","00010","01100"],
 "D": ["11110","10001","10001","10001","10001","10001","11110"],
 "m": ["00000","00000","11010","10101","10101","10101","10101"],
 "k": ["10000","10000","10010","10100","11000","10100","10010"],
 "A": ["01110","10001","10001","11111","10001","10001","10001"],
 "E": ["11111","10000","10000","11110","10000","10000","11111"],
 "P": ["11110","10001","10001","11110","10000","10000","10000"],
 "S": ["01111","10000","10000","01110","00001","00001","11110"],
 "T": ["11111","00100","00100","00100","00100","00100","00100"],
 "R": ["11110","10001","10001","11110","10100","10010","10001"],
 "M": ["10001","11011","10101","10101","10001","10001","10001"],
 "G": ["01110","10001","10000","10111","10001","10001","01111"],
 "H": ["10001","10001","10001","11111","10001","10001","10001"],
 "F": ["11111","10000","10000","11110","10000","10000","10000"],
 "L": ["10000","10000","10000","10000","10000","10000","11111"],
 "N": ["10001","11001","10101","10011","10001","10001","10001"],
 "U": ["10001","10001","10001","10001","10001","10001","01110"],
 "C": ["01110","10001","10000","10000","10000","10001","01110"],
}
ZERO_VARIANTS = [DM["0"], ["01110","10001","10001","10001","10001","10001","01110"], ["01110","10001","10001","10101","10001","10001","01110"]]

def render_dm(ch):
    rows = random.choice(ZERO_VARIANTS) if ch in "0O" else DM.get(ch)
    if rows is None: return None
    px = random.randint(3, 9)
    dot = random.choice([1.0, 0.8, 0.65])          # lit area inside each pixel cell
    img = Image.new("L", (5*px + 2*px, 7*px + 2*px), 0)
    d = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c == "1":
                m = px*(1-dot)/2
                d.rectangle([px + x*px + m, px + y*px + m, px + (x+1)*px - m - 1, px + (y+1)*px - m - 1], fill=255)
    img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.3, 1.8)))
    th = random.randint(14, 70); sc = th/img.height
    img = img.resize((max(4, int(img.width*sc)), th), Image.BILINEAR)
    a = np.asarray(img, dtype=np.float32)/255.0
    a = a*random.uniform(.5,1) + np.random.normal(0, random.uniform(0,.1), a.shape)
    return a > random.uniform(.3, .55)

def make(flist, per_font):
    X, y = [], []
    for fp in flist:
        try: ImageFont.truetype(fp, 20)
        except Exception: continue
        for ci, c in enumerate(CLASSES):
            chars = [c] if c != "other" else OTHER
            n = per_font if c != "other" else per_font*2
            for _ in range(n):
                ch = random.choice(chars)
                if c == "0" and random.random() < .45: ch = "O"   # O is treated as zero
                if c == "1" and random.random() < .1: ch = "l"
                try: m = render(fp, ch, 64)
                except Exception: continue
                f = to_feat(m)
                if f is not None: X.append(f); y.append(ci)
    # dot-matrix / LCD style samples (not tied to any font file)
    for _ in range(per_font * 12):
        ci = random.randrange(len(CLASSES) - 1)
        c = CLASSES[ci]
        m = render_dm(c)
        if m is None: continue
        f = to_feat(m)
        if f is not None: X.append(f); y.append(ci)
    for _ in range(per_font * 6):
        ch = random.choice("AEPSTRMGHFLNUC")
        m = render_dm(ch)
        f = to_feat(m) if m is not None else None
        if f is not None: X.append(f); y.append(CLASSES.index("other"))
    # junk: random blobs/bars/rings -> other
    for _ in range(len(flist)*per_font):
        m = np.zeros((40, 40), bool)
        kind = random.randint(0, 4)
        if kind == 0: m[random.randint(0,20):random.randint(21,39), random.randint(10,25):random.randint(26,30)] = True
        elif kind == 1: m[random.randint(0,20):random.randint(21,39), :] = True
        elif kind == 2:
            yy, xx = np.ogrid[:40,:40]; r=np.hypot(yy-20,xx-20); m = (r<18)&(r>random.randint(8,15))
        elif kind == 3: m = np.random.rand(40,40) > .5
        else: m[:, random.randint(0,20):random.randint(21,39)] = True; m[random.randint(0,20):random.randint(21,39),:]=True
        f = to_feat(m)
        if f is not None: X.append(f); y.append(CLASSES.index("other"))
    return np.array(X), np.array(y)

if __name__ == "__main__":
    fl = fonts()
    fams = sorted(set(family(f) for f in fl))
    print(len(fl), "font files,", len(fams), "families:", fams)
    hold = set(random.sample(fams, 3))
    tr = [f for f in fl if family(f) not in hold]; va = [f for f in fl if family(f) in hold]
    print("held-out families:", hold)
    Xtr, ytr = make(tr, 70); Xva, yva = make(va, 70)
    print(Xtr.shape, Xva.shape)
    clf = MLPClassifier(hidden_layer_sizes=(64,), alpha=1e-3, max_iter=600, random_state=0).fit(Xtr, ytr)
    print("held-out-font accuracy: %.3f" % clf.score(Xva, yva))
    pred = clf.predict(Xva)
    from sklearn.metrics import confusion_matrix
    cm = confusion_matrix(yva, pred)
    for i, c in enumerate(CLASSES):
        wrong = [(CLASSES[j], int(cm[i, j])) for j in range(len(CLASSES)) if j != i and cm[i, j] > 3]
        print(c, "recall %.2f" % (cm[i, i]/max(1, cm[i].sum())), wrong)
    if "--export" in sys.argv:
        Xa = np.vstack([Xtr, Xva]); ya = np.concatenate([ytr, yva])
        clf = MLPClassifier(hidden_layer_sizes=(64,), alpha=1e-3, max_iter=600, random_state=0).fit(Xa, ya)
        r = lambda a: [round(float(x), 4) for x in a.ravel()]
        out = "// GENERATED by web/tools/train_glyphs.py - do not edit. Synthetic fonts only, no photos.\n"
        out += "export const GLYPH_CLASSES = %s as const;\n" % json.dumps(CLASSES)
        out += "export const GLYPH_W = %d;\nexport const GLYPH_H = %d;\n" % (W, H)
        out += "export const W1 = %s;\nexport const B1 = %s;\n" % (json.dumps(r(clf.coefs_[0])), json.dumps(r(clf.intercepts_[0])))
        out += "export const W2 = %s;\nexport const B2 = %s;\n" % (json.dumps(r(clf.coefs_[1])), json.dumps(r(clf.intercepts_[1])))
        out += "export const GLYPH_IN = %d;\nexport const GLYPH_HIDDEN = %d;\n" % (Xa.shape[1], 64)
        os.makedirs("src/processor/odometer", exist_ok=True)
        open("src/processor/odometer/glyphModel.ts", "w").write(out)
        print("exported", len(out)//1024, "KB")
