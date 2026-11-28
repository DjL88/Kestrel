#!/usr/bin/env python3
"""Frozen-DINOv2 prototype and linear-head species classifier, evaluated leave-one-SHOOT-out (never random frames).

Inputs (outside Git): sample.jsonl + embeddings.npz from sample.py and embed.py. Output: metrics.json, report.md and
(for the shipping candidate) species-own-model.json in the same folder. Labels are the owner's UNCONFIRMED folder
names, so every number here measures agreement with those names, not with the truth.
"""
import argparse, json, os, collections
import numpy as np
from scipy.optimize import minimize

OUT = os.path.expanduser('~/code/kestrel-test-photos/species-own')
REG = 1.0  # L2 strength on the head


def unit(x):
    return x / np.linalg.norm(x, axis=1, keepdims=True)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_prototype(x, y, k, temp=30.0):
    protos = unit(np.stack([unit(x[y == c]).mean(axis=0, keepdims=True)[0] for c in range(k)]))
    return temp * protos, np.zeros(k)


def fit_linear(x, y, k, w):
    d = x.shape[1]
    onehot = np.eye(k)[y]

    def f(theta):
        W = theta[:k * d].reshape(k, d); b = theta[k * d:]
        p = softmax(x @ W.T + b)
        loss = -(w * np.log(p[np.arange(len(y)), y] + 1e-12)).sum() / w.sum() + 0.5 * REG / len(y) * (W ** 2).sum()
        g = (p - onehot) * w[:, None] / w.sum()
        gW = g.T @ x + REG / len(y) * W
        return loss, np.concatenate([gW.ravel(), g.sum(axis=0)])

    r = minimize(f, np.zeros(k * d + k), jac=True, method='L-BFGS-B', options={'maxiter': 400})
    return r.x[:k * d].reshape(k, d), r.x[k * d:]


def class_weights(y, g, k):
    """Each species counts equally, and within a species each shoot counts equally (not each frame)."""
    w = np.zeros(len(y))
    for c in range(k):
        groups = np.unique(g[y == c])
        for gg in groups:
            m = (y == c) & (g == gg)
            w[m] = 1.0 / (len(groups) * m.sum())
    return w / w.mean()


def loso(x, y, g, k, name, kfit):
    """Leave-one-group-out predictions. kfit = number of classes the model is fitted on (k, or k+1 with 'Other')."""
    probs = np.full((len(y), kfit), np.nan); sims = np.zeros(len(y))
    for held in np.unique(g):
        te = g == held; tr = ~te
        # a class with no other shoot to train on cannot be held out fairly: skip it (reported through frame counts)
        if y[te][0] not in y[tr] or len(np.unique(y[tr])) < kfit:
            continue
        W, b = fit_prototype(x[tr], y[tr], kfit) if name == 'prototype' else fit_linear(x[tr], y[tr], kfit, class_weights(y[tr], g[tr], kfit))
        probs[te] = softmax(x[te] @ W.T + b)
        sims[te] = (x[te] @ (W[:k] / np.linalg.norm(W[:k], axis=1, keepdims=True)).T).max(axis=1)
    return probs, sims


def main():
    rows = {}
    for l in open(os.path.join(OUT, 'sample.jsonl')):
        r = json.loads(l); rows[r['id']] = r
    z = np.load(os.path.join(OUT, 'embeddings.npz'))
    ids = list(z['ids']); X = unit(z['x'])
    meta = [rows[i] for i in ids]
    lab = [i for i, m in enumerate(meta) if m['set'] == 'species']
    oos = [i for i, m in enumerate(meta) if m['set'] != 'species']
    species = sorted({meta[i]['species'] for i in lab})
    k = len(species)
    y = np.array([species.index(meta[i]['species']) for i in lab])
    g = np.array([meta[i]['species'] + '|' + (meta[i]['day'] or meta[i]['folder']) for i in lab])
    x = X[lab]
    # 'Other' variant: out-of-set frames become class k, grouped by folder
    xa = np.concatenate([x, X[oos]]); ya = np.concatenate([y, np.full(len(oos), k)])
    ga = np.concatenate([g, np.array(['OTHER|' + meta[i]['folder'] for i in oos])])
    oos_group = np.array([meta[i]['species'] for i in oos])
    n_by_group = collections.Counter(g)
    report = ['# Own-species foundation: held-out results (UNCONFIRMED folder labels)', '',
              f'Frames: {len(y)} labelled over {len(np.unique(g))} shoots; {len(oos)} out-of-set frames. '
              'Frozen DINOv2 ViT-S/14 (Apache-2.0) embeddings, leave-one-shoot-out.', '']
    metrics = {}; keep = {}
    for name in ('prototype', 'linear', 'linear+other'):
        other = name.endswith('+other')
        base = name.split('+')[0]
        if other:
            pr, sm = loso(xa, ya, ga, k, base, k + 1)
            probs, sims = pr[:len(y)], sm[:len(y)]
            oprob, osim = pr[len(y):], sm[len(y):]
        else:
            probs, sims = loso(x, y, g, k, base, k)
            oprob = osim = None
        ok = ~np.isnan(probs[:, 0])
        p = probs[ok]; t = y[ok]
        top1 = p.argmax(1) == t
        top3 = np.array([t[i] in np.argsort(-p[i])[:3] for i in range(len(t))])
        abst_other = (p.argmax(1) == k) if other else np.zeros(len(t), bool)
        per = {}
        for c, sp in enumerate(species):
            m = t == c
            per[sp] = dict(n=int(m.sum()), top1=float(top1[m].mean()), top3=float(top3[m].mean()), said_other=float(abst_other[m].mean()))
        macro = float(np.mean([v['top1'] for v in per.values()]))
        conf = np.zeros((k, k + 1 if other else k), int)
        for a, b_ in zip(t, p.argmax(1)): conf[a, b_] += 1
        curve = []
        sp_conf = p[:, :k].max(1)
        for tau in (0.5, 0.6, 0.7, 0.8, 0.9):
            named = (sp_conf >= tau) & (p.argmax(1) < k)
            curve.append(dict(tau=tau, coverage=float(named.mean()), accuracy=float(top1[named].mean()) if named.any() else None))
        entry = dict(frames=int(ok.sum()), macro_top1=macro, micro_top1=float(top1.mean()), per_species=per, confusion=conf.tolist(), abstain_curve=curve)
        if other:
            ook = ~np.isnan(oprob[:, 0])
            entry['out_of_set_heldout_by_folder'] = {}
            report_oos = []
            for grp in sorted(set(oos_group)):
                m = (oos_group == grp) & ook
                named = (oprob[m].argmax(1) < k) & (oprob[m, :k].max(1) >= 0.66)
                entry['out_of_set_heldout_by_folder'][grp] = dict(frames=int(m.sum()), named=int(named.sum()))
                report_oos.append(f'| {grp} | {int(m.sum())} | {int(named.sum())} ({100 * named.mean():.1f}%) |')
        metrics[name] = entry
        keep[name] = (p, t, sims[ok], oprob, osim)
        report += [f'## {name}', f'Macro top-1 {macro:.3f}, micro top-1 {top1.mean():.3f} over {int(ok.sum())} held-out frames'
                   + (f'; said "not in list" on {100 * abst_other.mean():.1f}% of them (counted as not named).' if other else '.'), '',
                   '| Species | held-out frames | top-1 | top-3 |' + (' said not-in-list |' if other else ''), '|---|---|---|---|' + ('---|' if other else '')]
        for sp, v in per.items():
            report.append(f"| {sp} | {v['n']} | {v['top1']:.3f} | {v['top3']:.3f} |" + (f" {v['said_other']:.2f} |" if other else ''))
        report += ['', 'Confusion (rows = folder label, columns = predicted' + (', last = not in list' if other else '') + '):', '',
                   '| | ' + ' | '.join(species + (['(not in list)'] if other else [])) + ' |', '|---|' + '---|' * (k + (1 if other else 0))]
        for i, sp in enumerate(species): report.append(f'| {sp} | ' + ' | '.join(map(str, conf[i])) + ' |')
        report += ['', 'Abstain on low confidence (held-out):', '', '| min confidence | coverage (named) | accuracy when named |', '|---|---|---|']
        for c in curve: report.append(f"| {c['tau']} | {c['coverage']:.2f} | {'-' if c['accuracy'] is None else round(c['accuracy'], 3)} |")
        if other:
            report += ['', 'Out-of-set folders held out one at a time, wrongly given a species name (confidence 0.66):', '',
                       '| Out-of-set group | frames | wrongly named |', '|---|---|---|'] + report_oos
        report.append('')
    # choose the shipping head: lower false-name on out-of-set at similar macro top-1 is decided in the report; ship linear+other
    best = 'linear+other'
    p, t, sims, oprob, osim = keep[best]
    other = True
    sp_conf = p[:, :k].max(1); named_ok = p.argmax(1) < k
    taus = np.arange(0.4, 0.99, 0.01)
    tau = next((float(a) for a in taus if ((sp_conf >= a) & named_ok).any() and (p.argmax(1)[(sp_conf >= a) & named_ok] == t[(sp_conf >= a) & named_ok]).mean() >= 0.95), 0.9)
    sim_floor = float(np.percentile(sims[(p.argmax(1) == t)], 5))
    named = (sp_conf >= tau) & named_ok & (sims >= sim_floor)
    report += [f'## Shipping candidate: {best}',
               f'Abstain when the head says not-in-list, below confidence {tau:.2f}, or nearest-species cosine below {sim_floor:.3f}.', '',
               f'Held-out labelled frames named: {named.mean():.2f}; accuracy when named: {(p.argmax(1)[named] == t[named]).mean():.3f}.', '',
               '| Species (when named) | frames named | correct |', '|---|---|---|']
    for c, sp in enumerate(species):
        m = named & (p.argmax(1) == c)
        report.append(f'| {sp} | {int(m.sum())} | {int((t[m] == c).sum())} |')
    oos_stats = {}
    report += ['', 'Out-of-set, each folder held out in training, with both gates:', '', '| Group | frames | wrongly named |', '|---|---|---|']
    ook = ~np.isnan(oprob[:, 0])
    on = (oprob.argmax(1) < k) & (oprob[:, :k].max(1) >= tau) & (osim >= sim_floor) & ook
    for grp in sorted(set(oos_group)):
        m = (oos_group == grp) & ook
        oos_stats[grp] = dict(frames=int(m.sum()), named=int((on & m).sum()))
        report.append(f"| {grp} | {int(m.sum())} | {int((on & m).sum())} ({100 * (on & m).sum() / max(1, m.sum()):.1f}%) |")
    report += ['', 'Group sizes (frames per shoot): ' + ', '.join(f'{a}: {n}' for a, n in sorted(n_by_group.items())), '',
               '## Limits', '- Labels are folder names, unconfirmed: label noise is unmeasured. The "otherbirds" folders are unconfirmed too and may contain target species, so their false-name rate is an upper bound and the "not in list" class may have learned some real kingfishers or dippers as "other".',
               f'- Only {k} species the owner photographed; everything else must abstain, and look-alike birds are the hard case.',
               '- Backgrounds and places correlate with species in these shoots (puffin cliffs, kingfisher perches): part of the accuracy may be scene recognition.',
               '- The held-out unit is the shoot day; shoots of the same species at the same site are still similar.',
               '- Some shoots are tiny (see group sizes); per-species numbers on 45 to 400 frames carry wide error bars.',
               '- UK-centric, one photographer, one camera system.']
    open(os.path.join(OUT, 'report.md'), 'w').write('\n'.join(report))
    metrics['shipping'] = dict(kind=best, tau=tau, sim_floor=sim_floor, out_of_set=oos_stats, species=species,
                               named_fraction=float(named.mean()), accuracy_when_named=float((p.argmax(1)[named] == t[named]).mean()))
    json.dump(metrics, open(os.path.join(OUT, 'metrics.json'), 'w'), indent=1)
    W, b = fit_linear(xa, ya, k + 1, class_weights(ya, ga, k + 1))
    sci = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'folder-labels.json')))['species']
    model = dict(schema='kestrel-own-species-head/1', base=dict(id='dinov2-small-fp16', licence='Apache-2.0', dims=384, sha256=str(z['model_sha'])),
                 kind='linear', labels=[dict(common=s, scientific=sci[s]['scientific']) for s in species] + [dict(common='Not in list', scientific='')],
                 otherIndex=k, W=np.round(W, 4).tolist(), b=np.round(b, 4).tolist(), minConfidence=round(tau, 3), minSimilarity=round(sim_floor, 3),
                 trainedOn=dict(frames=int(len(ya)), shoots=int(len(np.unique(ga))), labelsConfirmed=False))
    json.dump(model, open(os.path.join(OUT, 'species-own-model.json'), 'w'), separators=(',', ':'))
    print('\n'.join(report))


if __name__ == '__main__':
    main()
