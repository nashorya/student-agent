#!/usr/bin/env python3
"""Post-run analyzer for P1 phase-2 Tier B on-arm admission gate."""
from __future__ import annotations
import json, random, sys
from collections import Counter
from pathlib import Path

def load_jsonl(path: Path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out

def main(mem: Path, results_glob: str, out_dir: Path):
    main_lessons = load_jsonl(mem / 'lessons.jsonl')
    eph = load_jsonl(mem / 'ephemeral' / 'lessons.jsonl')
    signals = load_jsonl(mem / 'signals.jsonl')
    knacks = load_jsonl(mem / 'knacks.jsonl')

    conf = Counter(x.get('confidence') for x in main_lessons)
    verified = conf.get('verified', 0)
    candidate = conf.get('candidate', 0)
    main_n = len(main_lessons)
    verified_ratio = (verified / main_n) if main_n else None

    # per-task produce metadata
    runs = []
    for p in sorted(Path('.').glob(results_glob)):
        meta = p / 'metadata.json'
        rec = p / 'records.json'
        item = {'dir': str(p)}
        if meta.exists():
            m = json.loads(meta.read_text())
            for inst in m.get('instances') or []:
                item.update({
                    'instanceId': inst.get('instanceId'),
                    'status': inst.get('status'),
                    'costUsd': inst.get('costUsd'),
                    'learning': inst.get('learning'),
                })
        if rec.exists():
            r = json.loads(rec.read_text())
            if r.get('records'):
                item['record_status'] = r['records'][0].get('status')
                item['error'] = r['records'][0].get('errorMessage') or r['records'][0].get('error')
        runs.append(item)

    report = {
        'memoryDir': str(mem),
        'mainLessons': main_n,
        'ephemeralLessons': len(eph),
        'mainConfidence': dict(conf),
        'verifiedRatioInMainLibrary': verified_ratio,
        'signals': len(signals),
        'signalKinds': dict(Counter(s.get('kind') for s in signals)),
        'knacks': len(knacks),
        'runs': runs,
        'totalCostUsd': sum((r.get('costUsd') or 0) for r in runs if isinstance(r.get('costUsd'), (int, float))),
        'admissionNote': (
            'Main library empty → gate rejected all process-error lessons; '
            'verification evidence requires successful bash test/pytest/verify command.'
            if main_n == 0 else
            'See verifiedRatioInMainLibrary against ADR-003 ≥50% bar.'
        ),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'p1-phase2-admission-report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')

    # blind review table: up to 5 from main, pad with ephemeral if needed; shuffle; hide source
    pool = []
    for x in main_lessons:
        pool.append({'source': 'main', 'quality': x.get('quality'), 'confidence': x.get('confidence'),
                     'lesson': x.get('lesson'), 'verification': bool(x.get('verification'))})
    for x in eph:
        pool.append({'source': 'ephemeral', 'quality': x.get('quality'), 'confidence': x.get('confidence'),
                     'lesson': x.get('lesson'), 'verification': bool(x.get('verification'))})
    random.seed(20260718)
    sample = pool[:]
    random.shuffle(sample)
    sample = sample[:5]
    lines = [
        '# P1 阶段 2 · 盲审表（作者填）',
        '',
        f'- memory: `{mem}`',
        f'- main lessons: {main_n} (verified={verified}, candidate={candidate})',
        f'- ephemeral: {len(eph)}',
        f'- verified 占比（主库）: {verified_ratio if verified_ratio is not None else "N/A（主库空）"}',
        f'- 验收线: 主库 verified ≥50%；盲审 ≥3/5 可用',
        '',
        '| # | lesson 摘要 | 是否可用（作者 0/1） | 备注 |',
        '|---|---|---|---|',
    ]
    for i, row in enumerate(sample, 1):
        text = (row['lesson'] or '')[:160].replace('|', '\\|').replace('\n', ' ')
        lines.append(f'| {i} | {text} |  |  |')
    lines += [
        '',
        '> 来源（main/ephemeral）与 confidence 对作者隐藏；agent 侧对照表见 `p1-phase2-blind-key.json`。',
        '',
        '## 召回命中附记（非验收）',
        '',
    ]
    recall_hits = []
    for r in runs:
        learn = r.get('learning') or {}
        used = learn.get('usedRecallIds') or []
        if used:
            recall_hits.append({'instanceId': r.get('instanceId'), 'usedRecallIds': used})
    if recall_hits:
        lines.append(json.dumps(recall_hits, ensure_ascii=False, indent=2))
    else:
        lines.append('本批 run 未观察到 usedRecallIds 非空实例（n 小如实记）。')
    (out_dir / 'p1-phase2-blind-review.md').write_text('\n'.join(lines) + '\n')
    (out_dir / 'p1-phase2-blind-key.json').write_text(json.dumps(sample, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    mem = Path(sys.argv[1] if len(sys.argv) > 1 else 'evals/results/swebench/openrouter-sonnet-tier-b-on-memory-p1gate-20260718')
    main(mem, 'evals/results/swebench/openrouter-sonnet-tier-b-on-*-p1gate-20260718', Path('evals/distillation'))
